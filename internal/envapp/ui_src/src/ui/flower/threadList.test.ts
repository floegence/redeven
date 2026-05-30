import { describe, expect, it } from 'vitest';
import type { ThreadView } from '../pages/AIChatContext';
import { filterFlowerThreadListItems, projectFlowerThreadListItem } from './threadList';

function thread(overrides: Partial<ThreadView> = {}): ThreadView {
  return {
    thread_id: 'th_1',
    title: 'Deploy review',
    created_at_unix_ms: 100,
    updated_at_unix_ms: 200,
    last_message_at_unix_ms: 300,
    last_message_preview: 'Review the deployment output',
    ...overrides,
  };
}

describe('Flower thread list projection', () => {
  it('projects chat and task rows from the existing thread store view', () => {
    const chat = projectFlowerThreadListItem(thread({ working_dir: '' }), {
      hostId: 'flower-host:1',
      hostKind: 'global',
      currentEnvPublicId: 'env_a',
    });
    const task = projectFlowerThreadListItem(thread({ thread_id: 'th_2', working_dir: '/workspace/app' }), {
      currentEnvPublicId: 'env_a',
    });

    expect(chat).toMatchObject({
      kind: 'chat',
      home_host_id: 'flower-host:1',
      home_host_kind: 'global',
      access_state: 'available_here',
      primary_action: {
        kind: 'open_thread',
      },
    });
    expect(task.kind).toBe('task');
    expect(task.summary).toBe('/workspace/app');
    expect(task.target_labels).toEqual(['env_a']);
  });

  it('marks host-offline rows read-only without exposing execution actions', () => {
    const row = projectFlowerThreadListItem(thread(), { hostAvailable: false });

    expect(row.access_state).toBe('read_only');
    expect(row.primary_action.kind).toBe('view_thread');
    expect(row.secondary_actions.map((action) => action.kind)).toEqual(['continue_here']);
  });

  it('filters history rows by chat task and current environment', () => {
    const rows = [
      projectFlowerThreadListItem(thread({ thread_id: 'chat', working_dir: '' }), { currentEnvPublicId: 'env_a' }),
      projectFlowerThreadListItem(thread({ thread_id: 'task', working_dir: '/workspace/app' }), { currentEnvPublicId: 'env_b' }),
    ];

    expect(filterFlowerThreadListItems(rows, 'chat').map((item) => item.thread_id)).toEqual(['chat']);
    expect(filterFlowerThreadListItems(rows, 'task').map((item) => item.thread_id)).toEqual(['task']);
    expect(filterFlowerThreadListItems(rows, 'current_env', 'env_b').map((item) => item.thread_id)).toEqual(['task']);
  });
});
