// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FlowerThreadListItem, FlowerThreadReadStatus } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { FlowerThreadCard } from '../../../../flower_ui/src/threads/FlowerThreadList';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  MoreHorizontal: (props: { class?: string }) => <span data-icon="more" class={props.class} />,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
  SurfaceFloatingLayer: (props: { children?: unknown }) => props.children,
}));

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
});

function readStatus(): FlowerThreadReadStatus {
  return {
    is_unread: false,
    snapshot: {
      activity_revision: 1,
      last_message_at_unix_ms: 1,
      activity_signature: 'status:idle\u001factivity:1',
    },
    read_state: {
      last_seen_activity_revision: 1,
      last_read_message_at_unix_ms: 1,
      last_seen_activity_signature: 'status:idle\u001factivity:1',
    },
  };
}

function thread(status: FlowerThreadListItem['status']): FlowerThreadListItem {
  return {
    thread_id: `thread-${status}`,
    title: status,
    title_status: 'ready',
    model_id: 'default/model',
    working_dir: '/workspace/redeven',
    pinned: false,
    created_at_ms: 1,
    updated_at_ms: 1,
    preview: '',
    status,
    source_label: 'this host',
    target_labels: [],
    read_status: readStatus(),
  };
}

function renderCard(item: FlowerThreadListItem): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  disposers.push(render(() => (
    <FlowerThreadCard
      item={item}
      active={false}
      onSelect={() => undefined}
    />
  ), host));
  return host;
}

describe('FlowerThreadCard', () => {
  it('mounts animated wave bars only while the thread is running', () => {
    const idleHost = renderCard(thread('idle'));
    expect(idleHost.querySelectorAll('.flower-thread-wave-bar')).toHaveLength(0);

    const runningHost = renderCard(thread('running'));
    expect(runningHost.querySelectorAll('.flower-thread-wave-bar')).toHaveLength(4);
  });
});
