// @vitest-environment jsdom

import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';

import { createCodexThreadController } from './threadController';
import type { CodexThreadDetail } from './types';

function sampleDetail(args: {
  threadID: string;
  name?: string;
  preview?: string;
  cwd?: string;
  activeStatus?: string;
  activeStatusFlags?: string[];
  itemCount?: number;
  lastAppliedSeq?: number;
}): CodexThreadDetail {
  const itemCount = Math.max(0, args.itemCount ?? 0);
  return {
    thread: {
      id: args.threadID,
      name: args.name ?? args.threadID,
      preview: args.preview ?? args.threadID,
      ephemeral: false,
      model_provider: 'gpt-5.4',
      created_at_unix_s: 1,
      updated_at_unix_s: 2,
      status: args.activeStatus ?? 'running',
      cwd: args.cwd ?? '/workspace',
      turns: itemCount > 0 ? [{
        id: `${args.threadID}_turn_1`,
        status: 'completed',
        items: Array.from({ length: itemCount }, (_, index) => ({
          id: `${args.threadID}_item_${index + 1}`,
          type: index === 0 ? 'userMessage' : 'agentMessage',
          text: `${args.threadID} item ${index + 1}`,
        })),
      }] : [],
    },
    runtime_config: {
      cwd: args.cwd ?? '/workspace',
      model: 'gpt-5.4',
      approval_policy: 'on-request',
      sandbox_mode: 'workspace-write',
      reasoning_effort: 'medium',
    },
    pending_requests: [],
    last_applied_seq: args.lastAppliedSeq ?? 0,
    active_status: args.activeStatus ?? 'running',
    active_status_flags: [...(args.activeStatusFlags ?? [])],
  };
}

function withThreadController<T>(callback: (controller: ReturnType<typeof createCodexThreadController>) => T): T {
  let result!: T;
  createRoot((dispose) => {
    try {
      result = callback(createCodexThreadController());
    } finally {
      dispose();
    }
  });
  return result;
}

describe('createCodexThreadController', () => {
  it('shows a loading state instead of keeping the previous thread displayed when selecting an uncached thread', () => {
    withThreadController((controller) => {
      controller.adoptThreadDetail(sampleDetail({
        threadID: 'thread_1',
        name: 'Loaded thread',
        itemCount: 1,
      }));

      controller.selectThread('thread_2');

      expect(controller.selectedThreadID()).toBe('thread_2');
      expect(controller.displayedThreadID()).toBeNull();
      expect(controller.threadLoading()).toBe(true);
    });
  });

  it('ignores stale bootstrap results when the user switches from one thread to another', () => {
    withThreadController((controller) => {
      controller.selectThread('thread_2');
      const tokenB = controller.beginThreadBootstrap('thread_2');
      controller.selectThread('thread_3');
      const tokenC = controller.beginThreadBootstrap('thread_3');

      expect(tokenB).not.toBeNull();
      expect(tokenC).not.toBeNull();
      expect(controller.resolveThreadBootstrap(tokenB!, sampleDetail({
        threadID: 'thread_2',
        name: 'Thread B',
        itemCount: 1,
      }))).toBe(false);

      expect(controller.displayedThreadID()).toBeNull();
      expect(controller.resolveThreadBootstrap(tokenC!, sampleDetail({
        threadID: 'thread_3',
        name: 'Thread C',
        itemCount: 1,
      }))).toBe(true);
      expect(controller.displayedThreadID()).toBe('thread_3');
      expect(controller.sessionForThread('thread_2')).toBeNull();
      expect(controller.sessionForThread('thread_3')?.thread.name).toBe('Thread C');
    });
  });

  it('preserves the richer working session when a stale bootstrap snapshot arrives later', () => {
    withThreadController((controller) => {
      controller.adoptThreadDetail(sampleDetail({
        threadID: 'thread_1',
        name: 'Working thread',
        activeStatus: 'running',
        activeStatusFlags: ['finalizing'],
        itemCount: 2,
        lastAppliedSeq: 8,
      }));

      const token = controller.beginThreadBootstrap('thread_1');
      expect(token).not.toBeNull();

      expect(controller.resolveThreadBootstrap(token!, sampleDetail({
        threadID: 'thread_1',
        name: 'Working thread',
        activeStatus: 'completed',
        activeStatusFlags: [],
        itemCount: 0,
        lastAppliedSeq: 8,
      }))).toBe(true);

      const session = controller.sessionForThread('thread_1');
      expect(session?.active_status).toBe('running');
      expect(session?.active_status_flags).toEqual(['finalizing']);
      expect(session?.item_order.length).toBe(2);
    });
  });

  it('keeps a cached thread visible when a refresh bootstrap fails', () => {
    withThreadController((controller) => {
      controller.adoptThreadDetail(sampleDetail({
        threadID: 'thread_1',
        name: 'Cached thread',
        itemCount: 1,
      }));

      const token = controller.beginThreadBootstrap('thread_1');
      expect(token).not.toBeNull();
      expect(controller.failThreadBootstrap(token!, 'request failed')).toBe(true);
      expect(controller.displayedThreadID()).toBe('thread_1');
      expect(controller.activeThreadError()).toBe('request failed');
    });
  });
});
