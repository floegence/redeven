import { describe, expect, it } from 'vitest';

import type {
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerChatMessage,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { projectFlowerLiveProgress } from './flowerLiveProgress';

function message(overrides: Partial<FlowerChatMessage> = {}): FlowerChatMessage {
  return {
    id: 'assistant-live', turn_id: 'turn-live', role: 'assistant', content: '', status: 'complete', created_at_ms: 2,
    ...overrides,
  };
}

function activity(status: FlowerActivityItem['status']): FlowerActivityTimelineBlock {
  return {
    type: 'activity-timeline', schema_version: 1, thread_id: 'thread-live', run_id: 'turn-live', turn_id: 'turn-live',
    summary: { status, severity: 'normal', needs_attention: false, total_items: 1, counts: { [status]: 1 } },
    items: [{
      item_id: 'tool-live', tool_name: 'file.write', kind: 'tool', status, severity: 'normal',
      needs_attention: false, requires_approval: false, renderer: 'file',
      payload: { operation: 'write', display_name: 'app.ts' },
    }],
  };
}

function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-live', title: 'Live task', title_status: 'ready', model_id: 'model', working_dir: '/',
    settings_revision: 1, created_at_ms: 1, updated_at_ms: 2, status: 'running', active_run_id: 'turn-live',
    source_label: 'local', target_labels: [],
    messages: [{ id: 'user-live', turn_id: 'turn-live', role: 'user', content: 'continue', status: 'complete', created_at_ms: 1 }],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 1, last_message_at_unix_ms: 1, activity_signature: 'live' },
      read_state: { last_seen_activity_revision: 1, last_read_message_at_unix_ms: 1, last_seen_activity_signature: 'live' },
    },
    ...overrides,
  };
}

describe('projectFlowerLiveProgress', () => {
  it('shows an initial wait until the active turn has real assistant activity', () => {
    expect(projectFlowerLiveProgress(thread())).toMatchObject({
      kind: 'waiting', runID: 'turn-live', initialWait: true,
    });
    expect(projectFlowerLiveProgress(thread({
      messages: [thread().messages[0], message({ live: true, status: 'streaming' })],
    }))).toMatchObject({ kind: 'waiting', runID: 'turn-live', initialWait: true });
  });

  it('uses live thinking as the only thinking authority without exposing its text', () => {
    const progress = projectFlowerLiveProgress(thread({
      messages: [
        thread().messages[0],
        message({ live: true, status: 'streaming', blocks: [{ type: 'thinking', content: 'private reasoning' }] }),
      ],
    }));
    expect(progress).toMatchObject({ kind: 'thinking', initialWait: false });
    expect(progress).not.toHaveProperty('text');
  });

  it('returns to waiting after a sealed thinking segment', () => {
    expect(projectFlowerLiveProgress(thread({
      messages: [thread().messages[0], message({ blocks: [{ type: 'thinking', content: 'sealed reasoning' }] })],
    }))).toMatchObject({ kind: 'waiting', initialWait: false });
  });

  it.each(['pending', 'running', 'waiting'] as const)('projects an active %s tool', (status) => {
    expect(projectFlowerLiveProgress(thread({
      messages: [thread().messages[0], message({ blocks: [activity(status)] })],
    }))).toMatchObject({ kind: 'tool', initialWait: false, tool: { itemIndex: 0 } });
  });

  it('returns to waiting after a tool reaches a terminal status', () => {
    expect(projectFlowerLiveProgress(thread({
      messages: [thread().messages[0], message({ blocks: [activity('success')] })],
    }))).toMatchObject({ kind: 'waiting', initialWait: false });
  });

  it('keeps an earlier concurrent tool visible when a later item is already terminal', () => {
    const timeline = activity('running');
    const completed: FlowerActivityItem = {
      ...timeline.items[0],
      item_id: 'tool-complete',
      status: 'success',
    };
    expect(projectFlowerLiveProgress(thread({
      messages: [thread().messages[0], message({ blocks: [{ ...timeline, items: [...timeline.items, completed] }] })],
    }))).toMatchObject({ kind: 'tool', tool: { itemIndex: 0 } });
  });

  it('projects only live assistant output and keeps its stable item identity as text grows', () => {
    const first = projectFlowerLiveProgress(thread({ messages: [thread().messages[0], message({ live: true, content: 'hel' })] }));
    const next = projectFlowerLiveProgress(thread({ messages: [thread().messages[0], message({ live: true, content: 'hello' })] }));
    expect(first).toMatchObject({ kind: 'output', text: 'hel' });
    expect(next).toMatchObject({ kind: 'output', text: 'hello' });
    expect(next?.identity).toBe(first?.identity);
  });

  it('ignores stale activity from the stopped turn after a new turn becomes active', () => {
    expect(projectFlowerLiveProgress(thread({
      active_run_id: 'turn-new',
      messages: [
        message({ id: 'old-output', turn_id: 'turn-old', live: true, content: 'stale output' }),
        { id: 'user-new', turn_id: 'turn-new', role: 'user', content: 'continue', status: 'complete', created_at_ms: 3 },
      ],
    }))).toMatchObject({ kind: 'waiting', runID: 'turn-new', initialWait: true });
  });

  it('has no progress for a terminal or user-interaction-owned thread', () => {
    expect(projectFlowerLiveProgress(thread({ status: 'canceled', active_run_id: undefined }))).toBeNull();
    expect(projectFlowerLiveProgress(thread({ status: 'waiting_approval' }))).toBeNull();
  });
});
