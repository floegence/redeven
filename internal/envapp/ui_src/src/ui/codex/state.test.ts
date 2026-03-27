// @vitest-environment jsdom

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
    runtime_config: {
      cwd: '/workspace',
      model: 'gpt-5.4',
      sandbox_mode: 'workspace-write',
      approval_policy: 'on-request',
      reasoning_effort: 'medium',
    },
    token_usage: {
      total: {
        total_tokens: 3200,
        input_tokens: 2000,
        cached_input_tokens: 400,
        output_tokens: 700,
        reasoning_output_tokens: 100,
      },
      last: {
        total_tokens: 900,
        input_tokens: 500,
        cached_input_tokens: 100,
        output_tokens: 250,
        reasoning_output_tokens: 50,
      },
      model_context_window: 128000,
    },
    last_applied_seq: 4,
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
    expect(session.last_applied_seq).toBe(4);
    expect(session.token_usage?.total.total_tokens).toBe(3200);
    expect(session.active_status_flags).toEqual(['busy']);
    expect(session.runtime_config.cwd).toBe('/workspace');
    expect(session.runtime_config.model).toBe('gpt-5.4');
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

  it('projects thread metadata, token usage, and reasoning deltas', () => {
    const initial = buildCodexThreadSession(sampleDetail());

    const renamed = applyCodexEvent(initial, {
      seq: 5,
      type: 'thread_name_updated',
      thread_id: 'thread_1',
      thread_name: 'Live renamed thread',
    });
    expect(renamed?.thread.name).toBe('Live renamed thread');

    const usageUpdated = applyCodexEvent(renamed ?? null, {
      seq: 6,
      type: 'thread_token_usage_updated',
      thread_id: 'thread_1',
      token_usage: {
        total: {
          total_tokens: 6400,
          input_tokens: 4200,
          cached_input_tokens: 600,
          output_tokens: 1100,
          reasoning_output_tokens: 300,
        },
        last: {
          total_tokens: 1200,
          input_tokens: 800,
          cached_input_tokens: 200,
          output_tokens: 150,
          reasoning_output_tokens: 50,
        },
        model_context_window: 128000,
      },
    });
    expect(usageUpdated?.token_usage?.total.total_tokens).toBe(6400);

    const withSummary = applyCodexEvent(usageUpdated ?? null, {
      seq: 7,
      type: 'reasoning_summary_delta',
      thread_id: 'thread_1',
      item_id: 'item_reasoning_live',
      summary_index: 0,
      delta: 'scan codebase',
    });
    expect(withSummary?.items_by_id.item_reasoning_live.summary).toEqual(['scan codebase']);

    const withContent = applyCodexEvent(withSummary ?? null, {
      seq: 8,
      type: 'reasoning_delta',
      thread_id: 'thread_1',
      item_id: 'item_reasoning_live',
      content_index: 0,
      delta: 'Inspecting the event replay path.',
    });
    expect(withContent?.items_by_id.item_reasoning_live.text).toContain('Inspecting the event replay path.');
    expect(withContent?.last_applied_seq).toBe(8);
  });

  it('keeps working state when Codex reports a retryable error', () => {
    const initial = buildCodexThreadSession(sampleDetail());

    const next = applyCodexEvent(initial, {
      seq: 5,
      type: 'error',
      thread_id: 'thread_1',
      error: 'temporary network failure',
      will_retry: true,
    });

    expect(next?.active_status).toBe('running');
    expect(next?.thread.status).toBe('running');
    expect(next?.last_applied_seq).toBe(5);
  });

  it('projects completed web search items from bridge-normalized events', () => {
    const initial = buildCodexThreadSession(sampleDetail());

    const next = applyCodexEvent(initial, {
      seq: 5,
      type: 'item_completed',
      thread_id: 'thread_1',
      item: {
        id: 'item_web_search',
        type: 'webSearch',
        query: 'site:nmc.cn changsha weather',
        action: {
          type: 'search',
          queries: [
            'site:nmc.cn changsha weather',
            'site:weather.com changsha weather',
          ],
        },
        status: 'completed',
      },
    });

    expect(next?.items_by_id.item_web_search.type).toBe('webSearch');
    expect(next?.items_by_id.item_web_search.query).toBe('site:nmc.cn changsha weather');
    expect(next?.items_by_id.item_web_search.action?.type).toBe('search');
    expect(next?.last_applied_seq).toBe(5);
  });
});
