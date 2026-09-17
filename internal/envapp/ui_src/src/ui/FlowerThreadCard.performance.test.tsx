// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FlowerThreadListItem, FlowerThreadReadStatus } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { FlowerThreadCard } from '../../../../flower_ui/src/threads/FlowerThreadList';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';

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
    snapshot: { activity_revision: 1 },
    read_state: { last_seen_activity_revision: 1 },
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

function renderCard(item: FlowerThreadListItem, active = false): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  disposers.push(render(() => (
    <FlowerThreadCard
      item={item}
      active={active}
      onSelect={() => undefined}
    />
  ), host));
  return host;
}

describe('FlowerThreadCard', () => {
  it.each(['waiting_user', 'waiting_approval'] as const)('renders the %s action label regardless of selection or read state', (status) => {
    const label = DEFAULT_FLOWER_SURFACE_COPY.threadList.statuses[status];
    for (const active of [false, true]) {
      for (const unread of [false, true]) {
        const host = renderCard({ ...thread(status), read_status: { ...readStatus(), is_unread: unread } }, active);
        expect(host.textContent).toContain(label);
        expect(host.querySelector('.flower-thread-card-select-button')?.getAttribute('aria-label')).toContain(label);
        expect(host.querySelector('[data-flower-thread-unread-dot="true"]')).toBeNull();
      }
    }
  });

  it('updates the action label without replacing the row or its focused selection button', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [item, setItem] = createSignal(thread('running'));
    disposers.push(render(() => <FlowerThreadCard item={item()} active onSelect={() => undefined} />, host));
    const row = host.querySelector('[data-flower-thread-card]');
    const button = host.querySelector<HTMLButtonElement>('.flower-thread-card-select-button')!;
    button.focus();
    for (const status of ['waiting_user', 'waiting_approval', 'running', 'success'] as const) {
      setItem({ ...item(), status });
      for (const waiting of ['waiting_user', 'waiting_approval'] as const) {
        expect(host.textContent?.includes(DEFAULT_FLOWER_SURFACE_COPY.threadList.statuses[waiting])).toBe(status === waiting);
      }
      expect(host.querySelector('[data-flower-thread-card]')).toBe(row);
      expect(document.activeElement).toBe(button);
    }
  });

  it.each(['waiting_user', 'waiting_approval'] as const)('replaces the %s label with stopping feedback during cancellation', (status) => {
    const item = thread(status);
    const host = renderCard({ ...item, cancellation: {
      thread_id: item.thread_id, turn_id: 'turn-1', run_id: 'run-1', source: 'user_stop',
      mode: 'graceful', requested_at: '2026-09-17T00:00:00Z',
    } });
    expect(host.textContent).toContain(DEFAULT_FLOWER_SURFACE_COPY.threadList.stopping);
    expect(host.textContent).not.toContain(DEFAULT_FLOWER_SURFACE_COPY.threadList.statuses[status]);
    expect(host.querySelectorAll('.flower-thread-wave-bar')).toHaveLength(4);
  });

  it('mounts animated wave bars only while the thread is running', () => {
    const idleHost = renderCard(thread('idle'));
    expect(idleHost.querySelectorAll('.flower-thread-wave-bar')).toHaveLength(0);

    const runningHost = renderCard(thread('running'));
    expect(runningHost.querySelectorAll('.flower-thread-wave-bar')).toHaveLength(4);
  });
});
