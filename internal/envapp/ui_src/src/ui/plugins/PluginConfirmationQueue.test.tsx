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
  vi.useRealTimers();
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

function activeEntryID(queue: ReturnType<typeof createPluginConfirmationQueue>): number {
  const entryID = queue.active()?.id;
  if (entryID === undefined) throw new Error('confirmation queue has no active entry');
  return entryID;
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
    queue.approveActive(activeEntryID(queue));
    await expect(first).resolves.toEqual({ confirmed: true });
    expect(queue.active()?.intent.requestId).toBe('second');
    expect(queue.pendingCount?.()).toBe(1);

    queue.rejectActive(activeEntryID(queue));
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
    queue.approveActive(activeEntryID(queue));
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

    queue.approveActive(activeEntryID(queue));
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
    queue.approveActive(activeEntryID(queue));
    await expect(pending).resolves.toEqual({ confirmed: false });
  });

  it('ignores decisions that do not match the displayed active entry', async () => {
    const queue = createPluginConfirmationQueue();
    const requestOwner = owner('entry-binding');
    const firstController = new AbortController();
    const first = Promise.resolve(queue.createHandler(requestOwner)(intent('first', firstController.signal)));
    const second = Promise.resolve(queue.createHandler(requestOwner)(intent('second', new AbortController().signal)));
    const firstID = activeEntryID(queue);

    queue.approveActive(firstID + 1);
    expect(queue.active()?.intent.requestId).toBe('first');

    firstController.abort('surface request cancelled');
    await expect(first).resolves.toEqual({ confirmed: false });
    expect(queue.active()?.intent.requestId).toBe('second');

    queue.approveActive(firstID);
    expect(queue.active()?.intent.requestId).toBe('second');
    queue.cancelAll();
    await expect(second).resolves.toEqual({ confirmed: false });
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
    expect(document.querySelector('[data-plugin-confirmation-destructive]')?.textContent?.trim()).toBe('destructive');
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

    vi.useFakeTimers();
    approve.click();
    await expect(first).resolves.toEqual({ confirmed: true });
    expect(queue.active()?.intent.requestId).toBe('second');

    const nextApprove = document.querySelector<HTMLButtonElement>('[data-plugin-confirmation-approve]')!;
    expect(nextApprove).not.toBe(approve);
    expect(nextApprove.disabled).toBe(true);
    nextApprove.click();
    nextApprove.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(queue.active()?.intent.requestId).toBe('second');

    vi.advanceTimersByTime(750);
    await Promise.resolve();
    expect(document.querySelector<HTMLButtonElement>('[data-plugin-confirmation-approve]')?.disabled).toBe(false);
    queue.cancelAll();
    await expect(second).resolves.toEqual({ confirmed: false });
  });

  it('renders the complete contract-validated Containers domain plan as high risk', async () => {
    const queue = createPluginConfirmationQueue();
    const requestOwner = owner('containers');
    const domainPlan = {
      method: 'containers.start',
      request: {
        engine: 'docker',
        container_id: 'container-api-id',
      },
      target: {
        engine: 'docker',
        container_id: 'container-api-id',
        container_name: 'redeven-containers-acceptance',
        target_hash: 'sha256:container-target',
      },
      image: {
        reference: 'alpine:3.22',
        digest_pinned: false,
      },
      runtime: {
        privileged: true,
        network_mode: 'bridge',
      },
      risk_level: 'critical',
      risk_flags: [{
        id: 'container_privileged',
        severity: 'critical',
        title: 'Privileged container',
        detail: 'The container can access host-level resources.',
        admin_required: true,
      }],
      requires_admin: true,
      summary: [
        'Start the selected container?',
        'This action launches the existing container with its configured runtime access.',
      ],
    };
    const controller = new AbortController();
    const requestIntent = {
      ...intent('domain-plan', controller.signal, domainPlan),
      method: 'containers.start',
    };
    const pending = Promise.resolve(queue.createHandler(requestOwner)(requestIntent));
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => <PluginConfirmationDialog queue={queue} />, mount);
    await Promise.resolve();

    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Start the selected container?');
    expect(document.querySelector('[data-plugin-confirmation-summary]')?.textContent).toContain('configured runtime access');
    expect(document.querySelector('[data-plugin-confirmation-target]')?.textContent).toContain('redeven-containers-acceptance');
    expect(document.querySelector('[data-plugin-confirmation-target-identity]')?.textContent?.trim()).toBe('container-api-id');
    expect(document.querySelector('[data-plugin-confirmation-risk-level]')?.textContent?.trim()).toBe('critical');
    expect(document.querySelector('[data-plugin-confirmation-admin-required]')?.textContent).toContain('Admin required');
    expect(document.querySelector('[data-plugin-confirmation-privileged]')?.textContent?.trim()).toBe('runtime.privileged');
    expect(document.querySelector('[data-plugin-confirmation-impact]')?.textContent).toContain('Privileged container');
    expect(document.querySelector('[data-plugin-confirmation-impact]')?.textContent).toContain('host-level resources');
    expect(document.querySelector('[data-plugin-confirmation-approve]')?.className).toContain('bg-destructive');

    queue.cancelAll();
    await expect(pending).resolves.toEqual({ confirmed: false });
  });

  it('shows top-level data-loss risk without relying on color or risk flags', async () => {
    const queue = createPluginConfirmationQueue();
    const pending = Promise.resolve(queue.createHandler(owner('data-loss'))(intent(
      'data-loss',
      new AbortController().signal,
      { summary: 'Replace data?', data_loss: true, data_loss_risk: true, risk_flags: [] },
    )));
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => <PluginConfirmationDialog queue={queue} />, mount);

    expect(document.querySelector('[data-plugin-confirmation-data-loss]')?.textContent?.trim()).toBe('data_loss');
    expect(document.querySelector('[data-plugin-confirmation-data-loss-risk]')?.textContent?.trim()).toBe('data_loss_risk');
    expect(document.querySelector('[data-plugin-confirmation-approve]')?.className).toContain('bg-destructive');
    queue.cancelAll();
    await expect(pending).resolves.toEqual({ confirmed: false });
  });

  it('does not let a detached stale decision settle the next confirmation', async () => {
    const queue = createPluginConfirmationQueue();
    const requestOwner = owner('stale-dialog');
    const firstController = new AbortController();
    const first = Promise.resolve(queue.createHandler(requestOwner)(intent('first', firstController.signal)));
    const second = Promise.resolve(queue.createHandler(requestOwner)(intent('second', new AbortController().signal)));
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => <PluginConfirmationDialog queue={queue} />, mount);
    const staleApprove = document.querySelector<HTMLButtonElement>('[data-plugin-confirmation-approve]')!;
    firstController.abort('surface request cancelled');
    await expect(first).resolves.toEqual({ confirmed: false });
    expect(queue.active()?.intent.requestId).toBe('second');

    staleApprove.click();
    expect(queue.active()?.intent.requestId).toBe('second');
    queue.cancelAll();
    await expect(second).resolves.toEqual({ confirmed: false });
  });

  it('keeps replacement approval inert across a brief empty queue gap', async () => {
    vi.useFakeTimers();
    const queue = createPluginConfirmationQueue();
    const requestOwner = owner('empty-gap');
    const first = Promise.resolve(queue.createHandler(requestOwner)(intent('first', new AbortController().signal)));
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => <PluginConfirmationDialog queue={queue} />, mount);
    document.querySelector<HTMLButtonElement>('[data-plugin-confirmation-approve]')!.click();
    await expect(first).resolves.toEqual({ confirmed: true });
    expect(queue.active()).toBeUndefined();

    const second = Promise.resolve(queue.createHandler(requestOwner)(intent('second', new AbortController().signal)));
    const replacementApprove = document.querySelector<HTMLButtonElement>('[data-plugin-confirmation-approve]')!;
    expect(replacementApprove.disabled).toBe(true);
    replacementApprove.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(queue.active()?.intent.requestId).toBe('second');

    vi.advanceTimersByTime(750);
    await Promise.resolve();
    expect(replacementApprove.disabled).toBe(false);
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
