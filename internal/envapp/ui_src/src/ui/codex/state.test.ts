import { describe, expect, it } from 'vitest';

import { applyCodexEvent, buildCodexThreadSession } from './state';
import type { CodexThreadDetail } from './types';

function sampleDetail(): CodexThreadDetail {
  return {
    thread: {
      id: 'thread_1',
      preview: 'hello world',
      ephemeral: false,
      model_provider: 'openai/gpt-5.4',
      created_at_unix_s: 1,
      updated_at_unix_s: 2,
      status: 'running',
      cwd: '/workspace',
      active_flags: ['busy'],
      turns: [
        {
          id: 'turn_1',
          status: 'completed',
          items: [
            {
              id: 'item_user',
              type: 'userMessage',
              inputs: [{ type: 'text', text: 'hello from content' }],
            },
            {
              id: 'item_reasoning',
              type: 'reasoning',
              summary: ['inspect files'],
            },
          ],
        },
      ],
    },
    pending_requests: [
      {
        id: 'request_1',
        type: 'command_approval',
        thread_id: 'thread_1',
        turn_id: 'turn_1',
        item_id: 'item_cmd',
        reason: 'needs approval',
      },
    ],
    last_event_seq: 4,
    active_status: 'running',
    active_status_flags: ['busy'],
  };
}

describe('buildCodexThreadSession', () => {
  it('hydrates transcript items and pending requests from thread detail', () => {
    const session = buildCodexThreadSession(sampleDetail());

    expect(session.item_order).toEqual(['item_user', 'item_reasoning']);
    expect(session.items_by_id.item_user.text).toBe('hello from content');
    expect(session.items_by_id.item_reasoning.summary).toEqual(['inspect files']);
    expect(session.pending_requests.request_1.reason).toBe('needs approval');
    expect(session.last_event_seq).toBe(4);
    expect(session.active_status_flags).toEqual(['busy']);
  });
});

describe('applyCodexEvent', () => {
  it('merges delta events, status changes, and request lifecycle updates', () => {
    const initial = buildCodexThreadSession(sampleDetail());

    const withMessage = applyCodexEvent(initial, {
      seq: 5,
      type: 'agent_message_delta',
      thread_id: 'thread_1',
      item_id: 'item_agent',
      delta: 'partial answer',
    });
    expect(withMessage?.items_by_id.item_agent.text).toBe('partial answer');

    const withRequest = applyCodexEvent(withMessage ?? null, {
      seq: 6,
      type: 'request_created',
      thread_id: 'thread_1',
      request: {
        id: 'request_2',
        type: 'user_input',
        thread_id: 'thread_1',
        turn_id: 'turn_1',
        item_id: 'item_agent',
      },
    });
    expect(withRequest?.pending_requests.request_2.type).toBe('user_input');

    const resolved = applyCodexEvent(withRequest ?? null, {
      seq: 7,
      type: 'request_resolved',
      thread_id: 'thread_1',
      request_id: 'request_1',
    });
    expect(resolved?.pending_requests.request_1).toBeUndefined();

    const finished = applyCodexEvent(resolved ?? null, {
      seq: 8,
      type: 'thread_status_changed',
      thread_id: 'thread_1',
      status: 'completed',
      flags: ['idle'],
    });
    expect(finished?.active_status).toBe('completed');
    expect(finished?.thread.status).toBe('completed');
    expect(finished?.active_status_flags).toEqual(['idle']);
  });
});
