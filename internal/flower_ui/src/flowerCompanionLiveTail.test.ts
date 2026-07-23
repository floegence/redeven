import { describe, expect, it } from 'vitest';

import type {
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerModelIOPhase,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { projectFlowerCompanionLiveTail } from './flowerCompanionLiveTail';

const labels: Record<FlowerModelIOPhase, string> = {
  preparing: 'Preparing model request...',
  waiting_response: 'Waiting for model response...',
  streaming: 'Thinking...',
  retrying: 'Retrying model request...',
  finalizing: 'Finalizing response...',
};

function message(overrides: Partial<FlowerChatMessage> = {}): FlowerChatMessage {
  return {
    id: 'assistant-live',
    run_id: 'run-live',
    role: 'assistant',
    content: '',
    status: 'streaming',
    created_at_ms: 2,
    blocks: [],
    ...overrides,
  };
}

function activityItem(overrides: Partial<FlowerActivityItem> = {}): FlowerActivityItem {
  return {
    item_id: 'tool-live',
    tool_name: 'terminal.exec',
    kind: 'tool',
    status: 'running',
    severity: 'normal',
    needs_attention: false,
    requires_approval: false,
    renderer: 'terminal',
    payload: { command: 'pnpm test --filter flower' },
    ...overrides,
  };
}

function activityBlock(items: readonly FlowerActivityItem[]): FlowerActivityTimelineBlock {
  return {
    type: 'activity-timeline',
    schema_version: 1,
    run_id: 'run-live',
    summary: {
      status: 'running',
      severity: 'normal',
      needs_attention: false,
      total_items: items.length,
      counts: { running: items.length },
    },
    items,
  };
}

function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-live',
    title: 'Live task',
    title_status: 'ready',
    model_id: 'default/model',
    working_dir: '/workspace/redeven',
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'running',
    active_run_id: 'run-live',
    source_label: 'this host',
    target_labels: [],
    messages: [],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 1, last_message_at_unix_ms: 1, activity_signature: 'live' },
      read_state: { last_seen_activity_revision: 1, last_read_message_at_unix_ms: 1, last_seen_activity_signature: 'live' },
    },
    ...overrides,
  };
}

const label = (phase: FlowerModelIOPhase) => labels[phase];

describe('projectFlowerCompanionLiveTail', () => {
  it('shows the waiting state instead of stale active-run output before a response arrives', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      model_io_status: { phase: 'waiting_response', run_id: 'run-live', updated_at_ms: 3 },
      messages: [message({ content: 'Previous model step' })],
    }), label)).toMatchObject({ kind: 'status', text: 'Waiting for model response...' });
  });

  it('shows thinking while streaming has not produced a visible block', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      model_io_status: { phase: 'streaming', run_id: 'run-live', updated_at_ms: 3 },
      messages: [message()],
    }), label)).toMatchObject({ kind: 'status', text: 'Thinking...' });
  });

  it('does not expose raw thinking content', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      model_io_status: { phase: 'streaming', run_id: 'run-live', updated_at_ms: 3 },
      messages: [message({ blocks: [{ type: 'thinking', content: 'Private chain of thought' }] })],
    }), label)).toMatchObject({ kind: 'status', text: 'Thinking...' });
  });

  it('projects the latest single-line assistant output from the active run', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      model_io_status: { phase: 'streaming', run_id: 'run-live', updated_at_ms: 3 },
      messages: [message({
        blocks: [{ type: 'markdown', content: 'Inspecting the layout.\n\nThe latest content stays visible.' }],
      })],
    }), label)).toMatchObject({
      kind: 'output',
      text: 'Inspecting the layout. The latest content stays visible.',
    });
  });

  it('projects the latest tool presentation instead of an internal tool name', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      model_io_status: { phase: 'streaming', run_id: 'run-live', updated_at_ms: 3 },
      messages: [message({ blocks: [activityBlock([activityItem()])] })],
    }), label)).toMatchObject({ kind: 'tool', text: 'pnpm test --filter flower' });
  });

  it('keeps the beginning of a long tool summary for ordinary end ellipsis', () => {
    const prefix = 'Inspect files from the workspace root: ';
    const projected = projectFlowerCompanionLiveTail(thread({
      model_io_status: { phase: 'streaming', run_id: 'run-live', updated_at_ms: 3 },
      messages: [message({ blocks: [activityBlock([activityItem({
        tool_name: 'custom.tool',
        renderer: 'structured',
        payload: {},
        label: `${prefix}${'nested/path/'.repeat(40)}tail`,
      })])] })],
    }), label);

    expect(Array.from(projected?.text ?? '')).toHaveLength(320);
    expect(projected?.text.startsWith(prefix)).toBe(true);
    expect(projected?.text.endsWith('tail')).toBe(false);
  });

  it('ignores user content and assistant output from an earlier run', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      model_io_status: { phase: 'streaming', run_id: 'run-live', updated_at_ms: 3 },
      messages: [
        message({ id: 'assistant-old', run_id: 'run-old', content: 'Old answer', status: 'complete' }),
        message({ id: 'user-live', role: 'user', run_id: 'run-live', content: 'User request' }),
      ],
    }), label)).toMatchObject({ kind: 'status', text: 'Thinking...' });
  });

  it('rejects runless streaming output instead of guessing its run ownership', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      model_io_status: { phase: 'streaming', run_id: 'run-live', updated_at_ms: 3 },
      messages: [message({ run_id: undefined, live: true, active_cursor: true, content: 'Unbound output' })],
    }), label)).toMatchObject({ kind: 'status', text: 'Thinking...' });
  });

  it('ignores a stale model status from another run', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      model_io_status: { phase: 'waiting_response', run_id: 'run-old', updated_at_ms: 3 },
      messages: [message({ content: 'Current run output' })],
    }), label)).toMatchObject({ kind: 'output', text: 'Current run output' });
  });

  it('keeps the final output visible while the response is finalizing', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      model_io_status: { phase: 'finalizing', run_id: 'run-live', updated_at_ms: 3 },
      messages: [message({ content: 'The checks are complete.' })],
    }), label)).toMatchObject({ kind: 'output', text: 'The checks are complete.' });
  });

  it('bounds layout work while preserving the newest Unicode output tail', () => {
    const projected = projectFlowerCompanionLiveTail(thread({
      model_io_status: { phase: 'streaming', run_id: 'run-live', updated_at_ms: 3 },
      messages: [message({ content: `${'discard-me '.repeat(100)}${'new '.repeat(100)}latest response ending` })],
    }), label);

    expect(Array.from(projected?.text ?? '')).toHaveLength(320);
    expect(projected?.text).not.toContain('discard-me');
    expect(projected?.text.endsWith('latest response ending')).toBe(true);
  });

  it('keeps output identity stable across rolling-window updates and changes it at block boundaries', () => {
    const first = projectFlowerCompanionLiveTail(thread({
      messages: [message({ id: 'message-live', content: 'a'.repeat(400) })],
    }), label);
    const next = projectFlowerCompanionLiveTail(thread({
      messages: [message({ id: 'message-live', content: `${'a'.repeat(400)}b` })],
    }), label);
    const nextBlock = projectFlowerCompanionLiveTail(thread({
      messages: [message({
        id: 'message-live',
        blocks: [
          { type: 'markdown', content: 'first' },
          { type: 'markdown', content: 'second' },
        ],
      })],
    }), label);

    expect(first?.identity).toBe(next?.identity);
    expect(nextBlock?.identity).not.toBe(first?.identity);
    expect(nextBlock?.identity).toContain('message-live');
  });
});
