// @vitest-environment jsdom

import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';

import { createCodexFollowupController } from './followupController';
import type { CodexQueuedFollowup } from './types';

const desktopStorageState = new Map<string, string>();

if (typeof window !== 'undefined') {
  window.redevenDesktopStateStorage = {
    getItem: (key) => desktopStorageState.get(String(key ?? '')) ?? null,
    setItem: (key, value) => {
      desktopStorageState.set(String(key ?? ''), String(value ?? ''));
    },
    removeItem: (key) => {
      desktopStorageState.delete(String(key ?? ''));
    },
    keys: () => Array.from(desktopStorageState.keys()).sort((left, right) => left.localeCompare(right)),
  };
}

function createFollowup(overrides?: Partial<CodexQueuedFollowup>): CodexQueuedFollowup {
  return {
    id: 'followup_1',
    thread_id: 'thread_1',
    text: 'Review the failing tests next.',
    attachments: [],
    mentions: [],
    runtime_config: {
      cwd: '/workspace',
      model: 'gpt-5.4',
      effort: 'medium',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
      approvals_reviewer: '',
    },
    created_at_unix_ms: 100,
    source: 'queued',
    ...overrides,
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  desktopStorageState.clear();
});

describe('createCodexFollowupController', () => {
  it('queues followups per thread and persists them', async () => {
    await createRoot(async (dispose) => {
      const controller = createCodexFollowupController();

      controller.queueFollowup(createFollowup());
      controller.queueFollowup(createFollowup({
        id: 'followup_2',
        text: 'Queue another turn.',
      }));
      await flushAsync();

      expect(controller.queuedForThread('thread_1').map((item) => item.id)).toEqual(['followup_1', 'followup_2']);
      expect(desktopStorageState.get('redeven:codex:queued-followups:v1')).toContain('followup_1');
      expect(desktopStorageState.get('redeven:codex:queued-followups:v1')).toContain('followup_2');

      dispose();
    });
  });

  it('moves, restores, and shifts queued followups in order', async () => {
    await createRoot(async (dispose) => {
      const controller = createCodexFollowupController();
      controller.queueFollowup(createFollowup({ id: 'followup_1' }));
      controller.queueFollowup(createFollowup({ id: 'followup_2', created_at_unix_ms: 200 }));
      controller.queueFollowup(createFollowup({ id: 'followup_3', created_at_unix_ms: 300 }));
      await flushAsync();

      controller.moveFollowup('thread_1', 'followup_3', -1);
      expect(controller.queuedForThread('thread_1').map((item) => item.id)).toEqual(['followup_1', 'followup_3', 'followup_2']);

      const restored = controller.pullFollowup('thread_1', 'followup_3');
      expect(restored?.id).toBe('followup_3');
      expect(controller.queuedForThread('thread_1').map((item) => item.id)).toEqual(['followup_1', 'followup_2']);

      const shifted = controller.shiftNextFollowup('thread_1');
      expect(shifted?.id).toBe('followup_1');
      expect(controller.queuedForThread('thread_1').map((item) => item.id)).toEqual(['followup_2']);

      controller.prependFollowup(createFollowup({ id: 'followup_0', source: 'auto_send' }));
      expect(controller.queuedForThread('thread_1').map((item) => item.id)).toEqual(['followup_0', 'followup_2']);

      dispose();
    });
  });

  it('restores persisted followups on a fresh controller', async () => {
    desktopStorageState.set('redeven:codex:queued-followups:v1', JSON.stringify({
      thread_1: [createFollowup({ id: 'persisted_1' })],
    }));

    await createRoot(async (dispose) => {
      const controller = createCodexFollowupController();
      await flushAsync();

      expect(controller.queuedForThread('thread_1').map((item) => item.id)).toEqual(['persisted_1']);
      expect(controller.queuedForThread('thread_1')[0]?.source).toBe('queued');

      dispose();
    });
  });

  it('preserves queued source metadata for rejected steer and auto-send recovery items', async () => {
    desktopStorageState.set('redeven:codex:queued-followups:v1', JSON.stringify({
      thread_1: [
        createFollowup({ id: 'rejected_1', source: 'rejected_steer' }),
        createFollowup({ id: 'auto_send_1', source: 'auto_send' }),
      ],
    }));

    await createRoot(async (dispose) => {
      const controller = createCodexFollowupController();
      await flushAsync();

      expect(controller.queuedForThread('thread_1').map((item) => item.source)).toEqual([
        'rejected_steer',
        'auto_send',
      ]);

      dispose();
    });
  });
});
