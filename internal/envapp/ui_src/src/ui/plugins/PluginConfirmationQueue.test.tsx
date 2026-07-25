// @vitest-environment jsdom

import type { PluginConfirmationIntent, PluginRiskPlan } from '@floegence/redevplugin-ui';
import type { JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PluginConfirmationDialog,
  createPluginConfirmationQueue,
  type PluginConfirmationOwner,
} from './PluginConfirmationQueue';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dialog: (props: {
    open: boolean;
    title?: string | JSX.Element;
    children: JSX.Element;
    footer?: JSX.Element;
    onOpenChange: (open: boolean) => void;
  }) => props.open ? (
    <section role="dialog" aria-label={typeof props.title === 'string' ? props.title : undefined}>
      <button type="button" data-dialog-dismiss onClick={() => props.onOpenChange(false)}>Dismiss</button>
      <h1>{props.title}</h1>
      {props.children}
      <footer>{props.footer}</footer>
    </section>
  ) : null,
}));

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

function owner(id: string, canConfirm: () => boolean = () => true): PluginConfirmationOwner {
  return {
    pluginID: `com.example.${id}`,
    displayName: id === 'containers' ? 'Containers' : undefined,
    pluginInstanceID: `plugin_${id}`,
    surfaceID: `${id}.main`,
    canConfirm,
  };
}

function intent(
  requestID: string,
  signal: AbortSignal,
  plan: Record<string, unknown> = { summary: requestID },
): PluginConfirmationIntent {
  return {
    requestId: requestID,
    method: 'containers.delete',
    params: { resource_id: requestID },
    requestHash: `sha256:${requestID}`,
    planHash: `sha256:plan-${requestID}`,
    plan,
    confirmationTokenId: `confirmation_${requestID}`,
    signal,
  };
}

describe('createPluginConfirmationQueue', () => {
  it('serializes confirmations in FIFO order and settles each decision once', async () => {
    const queue = createPluginConfirmationQueue();
    const requestOwner = owner('fifo');
    const firstController = new AbortController();
    const secondController = new AbortController();
    const handler = queue.createHandler(requestOwner);

    const first = Promise.resolve(handler(intent('first', firstController.signal)));
    const second = Promise.resolve(handler(intent('second', secondController.signal)));

    expect(queue.active()?.intent.requestId).toBe('first');
    expect(queue.pendingCount?.()).toBe(2);
    queue.approveActive();
    await expect(first).resolves.toEqual({ confirmed: true });
    expect(queue.active()?.intent.requestId).toBe('second');
    expect(queue.pendingCount?.()).toBe(1);

    queue.rejectActive();
    await expect(second).resolves.toEqual({ confirmed: false });
    expect(queue.active()).toBeUndefined();
    expect(queue.pendingCount?.()).toBe(0);
  });

  it('removes an aborted active request and advances to the next confirmation', async () => {
    const queue = createPluginConfirmationQueue();
    const requestOwner = owner('abort');
    const firstController = new AbortController();
    const secondController = new AbortController();
    const handler = queue.createHandler(requestOwner);

    const first = Promise.resolve(handler(intent('first', firstController.signal)));
    const second = Promise.resolve(handler(intent('second', secondController.signal)));
    firstController.abort('surface request cancelled');

    await expect(first).resolves.toEqual({ confirmed: false });
    expect(queue.active()?.intent.requestId).toBe('second');
    queue.approveActive();
    await expect(second).resolves.toEqual({ confirmed: true });
  });

  it('deep-clones JSON request data while retaining the live abort signal', async () => {
    const queue = createPluginConfirmationQueue();
    const requestOwner = owner('clone');
    const controller = new AbortController();
    const plan = { summary: 'Delete container', details: { name: 'api' } };
    const pending = Promise.resolve(queue.createHandler(requestOwner)(intent('clone', controller.signal, plan)));

    plan.summary = 'mutated';
    plan.details.name = 'mutated';
    expect(queue.active()?.intent.plan).toEqual({
      summary: 'Delete container',
      details: { name: 'api' },
    });
    expect(queue.active()?.intent.signal).toBe(controller.signal);

    queue.cancelAll();
    await expect(pending).resolves.toEqual({ confirmed: false });
  });

  it('cancels only confirmations owned by the retired surface', async () => {
    const queue = createPluginConfirmationQueue();
    const retiredOwner = owner('retired');
    const activeOwner = owner('active');
    const first = Promise.resolve(queue.createHandler(retiredOwner)(intent('retired', new AbortController().signal)));
    const second = Promise.resolve(queue.createHandler(activeOwner)(intent('active', new AbortController().signal)));

    queue.cancelOwner(retiredOwner);
    await expect(first).resolves.toEqual({ confirmed: false });
    expect(queue.active()?.intent.requestId).toBe('active');

    queue.approveActive();
    await expect(second).resolves.toEqual({ confirmed: true });
  });

  it('rejects hidden surfaces before enqueue and before approval', async () => {
    const queue = createPluginConfirmationQueue();
    let visible = false;
    const requestOwner = owner('visibility', () => visible);
    const handler = queue.createHandler(requestOwner);

    await expect(Promise.resolve(handler(intent('hidden', new AbortController().signal))))
      .resolves.toEqual({ confirmed: false });
    expect(queue.active()).toBeUndefined();

    visible = true;
    const pending = Promise.resolve(handler(intent('visible', new AbortController().signal)));
    expect(queue.active()?.owner).toBe(requestOwner);
    visible = false;
    queue.approveActive();
    await expect(pending).resolves.toEqual({ confirmed: false });
  });

  it('cancels every queued owner without widening an earlier owner cancellation', async () => {
    const queue = createPluginConfirmationQueue();
    const firstOwner = owner('first-owner');
    const secondOwner = owner('second-owner');
    const first = Promise.resolve(queue.createHandler(firstOwner)(intent('first', new AbortController().signal)));
    const second = Promise.resolve(queue.createHandler(secondOwner)(intent('second', new AbortController().signal)));
    const third = Promise.resolve(queue.createHandler(firstOwner)(intent('third', new AbortController().signal)));

    queue.cancelOwner(firstOwner);
    await expect(first).resolves.toEqual({ confirmed: false });
    await expect(third).resolves.toEqual({ confirmed: false });
    expect(queue.active()?.intent.requestId).toBe('second');

    queue.cancelAll();
    await expect(second).resolves.toEqual({ confirmed: false });
    expect(queue.active()).toBeUndefined();
  });
});

describe('PluginConfirmationDialog', () => {
  it('leads with the trusted plan, exposes queue position, and folds technical evidence', async () => {
    const queue = createPluginConfirmationQueue();
    const requestOwner = owner('containers');
    const riskPlan: PluginRiskPlan = {
      schema_version: 'redevplugin.capability.risk_plan.v1',
      summary: 'Remove the api container?',
      action: 'Remove',
      resource_display_name: 'api',
      destructive: true,
      risk_flags: [{
        id: 'container-permanent-removal',
        severity: 'critical',
        summary: 'Permanent removal',
        description: 'The container cannot be recovered by this action.',
        destructive: true,
        data_loss_risk: true,
      }],
    };
    const first = Promise.resolve(queue.createHandler(requestOwner)(intent('first', new AbortController().signal, riskPlan)));
    const second = Promise.resolve(queue.createHandler(requestOwner)(intent('second', new AbortController().signal)));
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => <PluginConfirmationDialog queue={queue} />, mount);
    await Promise.resolve();

    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Remove the api container?');
    expect(document.querySelector('[data-plugin-confirmation-owner]')?.textContent).toBe('Containers');
    expect(document.querySelector('[data-plugin-confirmation-target]')?.textContent).toContain('api');
    expect(document.querySelector('[data-plugin-confirmation-impact]')?.textContent).toContain('Permanent removal');
    expect(document.querySelector('[data-plugin-confirmation-impact]')?.textContent).toContain('cannot be recovered');
    expect(document.querySelector('[data-plugin-confirmation-position]')?.textContent?.trim()).toBe('1 / 2');
    expect(document.querySelector<HTMLDetailsElement>('[data-plugin-confirmation-technical-details]')?.open).toBe(false);

    const technicalText = document.querySelector('[data-plugin-confirmation-technical-details]')?.textContent ?? '';
    expect(technicalText).toContain('containers.delete');
    expect(technicalText).toContain('sha256:first');
    expect(technicalText).toContain('sha256:plan-first');
    expect(technicalText).toContain('confirmation_first');
    expect(technicalText).toContain('plugin_containers');
    expect(technicalText).toContain('containers.main');

    const cancel = document.querySelector<HTMLButtonElement>('[data-plugin-confirmation-reject]')!;
    const approve = document.querySelector<HTMLButtonElement>('[data-plugin-confirmation-approve]')!;
    expect(document.activeElement).toBe(cancel);
    expect(approve.textContent?.trim()).toBe('Remove');
    expect(approve.className).toContain('bg-destructive');

    approve.click();
    await expect(first).resolves.toEqual({ confirmed: true });
    expect(queue.active()?.intent.requestId).toBe('second');
    queue.cancelAll();
    await expect(second).resolves.toEqual({ confirmed: false });
  });

  it('falls back to method and rejects through both cancel and dialog dismissal', async () => {
    const queue = createPluginConfirmationQueue();
    const requestOwner = owner('fallback');
    const first = Promise.resolve(queue.createHandler(requestOwner)(intent('first', new AbortController().signal, {
      resource_ref: 'container/api',
    })));
    const second = Promise.resolve(queue.createHandler(requestOwner)(intent('second', new AbortController().signal, {})));
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => <PluginConfirmationDialog queue={queue} />, mount);
    expect(document.querySelector('[data-plugin-confirmation-method-fallback]')?.textContent).toContain('containers.delete');

    document.querySelector<HTMLButtonElement>('[data-plugin-confirmation-reject]')!.click();
    await expect(first).resolves.toEqual({ confirmed: false });
    expect(queue.active()?.intent.requestId).toBe('second');

    document.querySelector<HTMLButtonElement>('[data-dialog-dismiss]')!.click();
    await expect(second).resolves.toEqual({ confirmed: false });
    expect(queue.active()).toBeUndefined();
  });
});
