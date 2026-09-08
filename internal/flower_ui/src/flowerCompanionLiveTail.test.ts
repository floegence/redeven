import { describe, expect, it } from 'vitest';

import type {
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { projectFlowerCompanionLiveTail } from './flowerCompanionLiveTail';
import type { FlowerLiveProgressKind } from './flowerLiveProgress';

const labels: Record<FlowerLiveProgressKind, string> = {
  preparing: 'Preparing...',
  waiting_response: 'Waiting for model response...',
  streaming: 'Thinking...',
  retrying: 'Retrying...',
  finalizing: 'Finalizing...',
  tool_execution: 'Using a tool',
};

function message(overrides: Partial<FlowerChatMessage> = {}): FlowerChatMessage {
  return {
    id: 'assistant-live',
    turn_id: 'turn-live',
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
    title_status: 'ready', title_generation: 1,
    model_id: 'default/model',
    working_dir: '/workspace/redeven',
    settings_revision: 1,
    created_at_ms: 1,
    updated_at_ms: 2,
    status: 'running',
    active_run_id: 'run-live',
    run_progress: { phase: 'waiting_response', run_id: 'run-live', turn_id: 'turn-live' },
    source_label: 'this host',
    target_labels: [],
    messages: [],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 1 },
      read_state: { last_seen_activity_revision: 1 },
    },
    ...overrides,
  };
}

const label = (kind: FlowerLiveProgressKind) => labels[kind];

describe('projectFlowerCompanionLiveTail', () => {
  it('shows the waiting state instead of stale active-run output before a response arrives', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      messages: [message({ content: 'Previous model step' })],
    }), label)).toMatchObject({ kind: 'status', text: 'Waiting for model response...' });
  });

  it('shows waiting while an active turn has not produced a live item', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      messages: [message()],
    }), label)).toMatchObject({ kind: 'status', text: 'Waiting for model response...' });
  });

  it('does not expose raw thinking content', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      run_progress: { phase: 'streaming', run_id: 'run-live', turn_id: 'turn-live' },
      messages: [message({ live: true, blocks: [{ type: 'thinking', content: 'Private chain of thought' }] })],
    }), label)).toMatchObject({ kind: 'status', text: 'Thinking...' });
  });

  it('projects the latest single-line assistant output from the active run', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      messages: [message({
        live: true,
        blocks: [{ type: 'markdown', content: 'Inspecting the layout.\n\nThe latest content stays visible.' }],
      })],
    }), label)).toMatchObject({
      kind: 'output',
      text: 'Inspecting the layout. The latest content stays visible.',
    });
  });

  it('accepts typed-current assistant output owned by the active turn', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      messages: [message({
        run_id: undefined,
        turn_id: 'turn-live',
        live: true,
        content: 'Typed current output remains visible.',
      })],
    }), label)).toMatchObject({
      kind: 'output',
      text: 'Typed current output remains visible.',
    });
  });

  it('projects the latest tool presentation instead of an internal tool name', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      messages: [message({ blocks: [activityBlock([activityItem()])] })],
    }), label)).toMatchObject({ kind: 'tool', text: 'Run command' });
  });

  it('keeps the beginning of a long tool summary for ordinary end ellipsis', () => {
    const prefix = 'Inspect files from the workspace root: ';
    const projected = projectFlowerCompanionLiveTail(thread({
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
      messages: [
        message({ id: 'assistant-old', turn_id: 'run-old', live: true, content: 'Old answer', status: 'streaming' }),
        message({ id: 'user-live', role: 'user', turn_id: 'turn-live', content: 'User request' }),
      ],
    }), label)).toMatchObject({ kind: 'status', text: 'Waiting for model response...' });
  });

  it('rejects runless streaming output instead of guessing its run ownership', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      messages: [message({ run_id: undefined, turn_id: undefined, live: true, active_cursor: true, content: 'Unbound output' })],
    }), label)).toMatchObject({ kind: 'status', text: 'Waiting for model response...' });
  });

  it('uses the upstream phase when content has not started', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      run_progress: { phase: 'finalizing', run_id: 'run-live', turn_id: 'turn-live' },
    }), label)).toMatchObject({ kind: 'status', text: 'Finalizing...' });
  });

  it('does not claim sealed output is still streaming', () => {
    expect(projectFlowerCompanionLiveTail(thread({
      messages: [message({ content: 'The checks are complete.' })],
    }), label)).toMatchObject({ kind: 'status', text: 'Waiting for model response...' });
  });

  it('bounds layout work while preserving the newest Unicode output tail', () => {
    const projected = projectFlowerCompanionLiveTail(thread({
      messages: [message({ live: true, content: `${'discard-me '.repeat(100)}${'new '.repeat(100)}latest response ending` })],
    }), label);

    expect(Array.from(projected?.text ?? '')).toHaveLength(320);
    expect(projected?.text).not.toContain('discard-me');
    expect(projected?.text.endsWith('latest response ending')).toBe(true);
  });

  it('keeps output identity stable across rolling-window updates and changes it at block boundaries', () => {
    const first = projectFlowerCompanionLiveTail(thread({
      messages: [message({ id: 'message-live', live: true, content: 'a'.repeat(400) })],
    }), label);
    const next = projectFlowerCompanionLiveTail(thread({
      messages: [message({ id: 'message-live', live: true, content: `${'a'.repeat(400)}b` })],
    }), label);
    const nextBlock = projectFlowerCompanionLiveTail(thread({
      messages: [message({
        id: 'message-live',
        live: true,
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
