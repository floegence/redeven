// @vitest-environment jsdom

import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCodexStreamCoordinator } from './streamCoordinator';
import type { CodexEvent } from './types';

function flushMicrotasks(): Promise<void> {
  return Promise.resolve();
}

function withStreamCoordinator<T>(
  callback: (controller: ReturnType<typeof createCodexStreamCoordinator>) => Promise<T> | T,
  options?: {
    connectStream?: (args: {
      threadID: string;
      afterSeq?: number;
      signal: AbortSignal;
      onEvent: (event: CodexEvent) => void;
    }) => Promise<void>;
  },
): Promise<T> {
  return new Promise((resolve, reject) => {
    createRoot((dispose) => {
      Promise.resolve(callback(createCodexStreamCoordinator(options)))
        .then((value) => {
          dispose();
          resolve(value);
        })
        .catch((error) => {
          dispose();
          reject(error);
        });
    });
  });
}

describe('createCodexStreamCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reconnects after an unexpected stream close and resumes from the latest applied sequence', async () => {
    vi.useFakeTimers();
    const appliedSeq = { value: 3 };
    const connectStream = vi.fn()
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async (args: {
        afterSeq?: number;
        onEvent: (event: CodexEvent) => void;
      }) => {
        args.onEvent({
          seq: 4,
          type: 'thread_status_changed',
          thread_id: 'thread_1',
          status: 'running',
          stream: {
            last_applied_seq: 4,
            oldest_retained_seq: 1,
            stream_epoch: 2,
            last_event_at_unix_ms: 42,
          },
        });
        return new Promise<void>(() => {});
      });

    await withStreamCoordinator(async (controller) => {
      controller.attach({
        threadID: 'thread_1',
        afterSeq: 3,
        resolveAfterSeq: () => appliedSeq.value,
        onEvent: (event) => {
          appliedSeq.value = Math.max(appliedSeq.value, Number(event.seq ?? 0) || 0);
        },
        onDesynced: async () => undefined,
      });

      await flushMicrotasks();
      expect(connectStream).toHaveBeenCalledTimes(1);
      expect(controller.transportState().phase).toBe('reconnecting');

      await vi.advanceTimersByTimeAsync(250);
      await flushMicrotasks();

      expect(connectStream).toHaveBeenCalledTimes(2);
      expect(connectStream.mock.calls[1]?.[0]?.afterSeq).toBe(3);
      expect(controller.transportState().phase).toBe('live');
      expect(controller.transportState().stream_epoch).toBe(2);
      expect(appliedSeq.value).toBe(4);
      controller.close();
    }, {
      connectStream,
    });
  });

  it('reboots the thread session after a desync marker and reconnects from the refreshed sequence', async () => {
    const appliedSeq = { value: 4 };
    const onDesynced = vi.fn(async () => {
      appliedSeq.value = 9;
    });
    const connectStream = vi.fn()
      .mockImplementationOnce(async (args: {
        onEvent: (event: CodexEvent) => void;
      }) => {
        args.onEvent({
          seq: 4,
          type: 'stream_desynced',
          thread_id: 'thread_1',
          stream: {
            last_applied_seq: 9,
            oldest_retained_seq: 6,
            stream_epoch: 3,
            last_event_at_unix_ms: 99,
          },
          transport: {
            state: 'desynced',
            reason: 'requested sequence is older than the retained event window',
            reset_required: true,
          },
        });
      })
      .mockImplementationOnce(async (args: {
        afterSeq?: number;
        onEvent: (event: CodexEvent) => void;
      }) => {
        expect(args.afterSeq).toBe(9);
        args.onEvent({
          seq: 9,
          type: 'thread_status_changed',
          thread_id: 'thread_1',
          status: 'running',
          stream: {
            last_applied_seq: 9,
            oldest_retained_seq: 6,
            stream_epoch: 3,
            last_event_at_unix_ms: 100,
          },
        });
        return new Promise<void>(() => {});
      });

    await withStreamCoordinator(async (controller) => {
      controller.attach({
        threadID: 'thread_1',
        afterSeq: 4,
        resolveAfterSeq: () => appliedSeq.value,
        onEvent: (event) => {
          appliedSeq.value = Math.max(appliedSeq.value, Number(event.seq ?? 0) || 0);
        },
        onDesynced,
      });

      await flushMicrotasks();
      await flushMicrotasks();

      expect(onDesynced).toHaveBeenCalledTimes(1);
      expect(connectStream).toHaveBeenCalledTimes(2);
      expect(controller.transportState().phase).toBe('live');
      expect(controller.transportState().stream_epoch).toBe(3);
      controller.close();
    }, {
      connectStream,
    });
  });
});
