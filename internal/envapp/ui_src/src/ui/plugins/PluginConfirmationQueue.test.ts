// @vitest-environment jsdom

import type { PluginConfirmationIntent } from '@floegence/redevplugin-ui';
import { describe, expect, it } from 'vitest';

import { createPluginConfirmationQueue, type PluginConfirmationOwner } from './PluginConfirmationQueue';

function owner(id: string, canConfirm: () => boolean = () => true): PluginConfirmationOwner {
  return {
    pluginID: `com.example.${id}`,
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
    queue.approveActive();
    await expect(first).resolves.toEqual({ confirmed: true });
    expect(queue.active()?.intent.requestId).toBe('second');

    queue.rejectActive();
    await expect(second).resolves.toEqual({ confirmed: false });
    expect(queue.active()).toBeUndefined();
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
});
