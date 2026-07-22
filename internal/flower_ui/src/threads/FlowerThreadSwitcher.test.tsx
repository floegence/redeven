// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FlowerThreadListCopy } from '../copy';
import type { FlowerThreadListItem, FlowerThreadReadStatus, FlowerThreadStatus } from '../contracts/flowerSurfaceContracts';
import type { FlowerCompanionThreadListItem } from '../flowerCompanionPresence';
import {
  FlowerThreadSwitcher,
  groupFlowerThreadSwitcherItems,
  type FlowerThreadSwitcherCopy,
} from './FlowerThreadSwitcher';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Plus: (props: { class?: string }) => <span data-icon="plus" class={props.class} />,
  Search: (props: { class?: string }) => <span data-icon="search" class={props.class} />,
}));

const disposers: Array<() => void> = [];

afterEach(() => {
  while (disposers.length > 0) disposers.pop()?.();
  document.body.replaceChildren();
  vi.useRealTimers();
});

function readStatus(isUnread = false): FlowerThreadReadStatus {
  return {
    is_unread: isUnread,
    snapshot: {
      activity_revision: isUnread ? 2 : 1,
      last_message_at_unix_ms: 1,
      activity_signature: isUnread ? 'status:success\u001factivity:2' : 'status:idle\u001factivity:1',
    },
    read_state: {
      last_seen_activity_revision: 1,
      last_read_message_at_unix_ms: 1,
      last_seen_activity_signature: 'status:idle\u001factivity:1',
    },
  };
}

function thread(overrides: Partial<FlowerCompanionThreadListItem> = {}): FlowerCompanionThreadListItem {
  const item: FlowerThreadListItem = {
    thread_id: 'thread-1',
    title: 'Thread',
    title_status: 'ready',
    model_id: 'default/model',
    working_dir: '/workspace/redeven',
    pinned: false,
    created_at_ms: Date.now(),
    updated_at_ms: Date.now(),
    preview: '',
    status: 'idle',
    source_label: 'this host',
    target_labels: [],
    read_status: readStatus(),
  };
  return { ...item, ...overrides };
}

const statuses: Record<FlowerThreadStatus, string> = {
  idle: 'Quiet',
  running: 'Busy',
  waiting_user: 'Reply needed',
  waiting_approval: 'Approval needed',
  failed: 'Failed',
  success: 'Done',
  canceled: 'Stopped',
  read_only: 'Read only',
};

const threadListCopy: FlowerThreadListCopy = {
  title: 'Conversations',
  description: 'Conversation history',
  warmupDescription: 'Loading conversations',
  refreshLabel: 'Refresh',
  searchPlaceholder: 'Search history',
  empty: 'No conversations',
  untitled: 'Untitled',
  working: 'Working',
  unread: 'Unread',
  deleteLabel: (title) => `Delete ${title}`,
  contextMenuLabel: (title) => `Actions for ${title}`,
  copyThreadID: 'Copy ID',
  copyWorkingDirectory: 'Copy directory',
  threadIDLabel: 'Thread ID',
  workingDirectoryLabel: 'Working directory',
  copied: (label) => `Copied ${label}`,
  fork: 'Fork',
  pin: 'Pin',
  unpin: 'Unpin',
  pinnedGroup: 'Pinned',
  pinnedBadge: 'Pinned item',
  rename: 'Rename',
  renameTitle: 'Rename conversation',
  renameNameLabel: 'Name',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving',
  now: 'Just now',
  minutes: (count) => `${count} minutes`,
  hours: (count) => `${count} hours`,
  days: (count) => `${count} days`,
  statuses,
  groups: {
    today: 'Today',
    yesterday: 'Yesterday',
    this_week: 'This week',
    older: 'Older',
  },
};

const copy: FlowerThreadSwitcherCopy = {
  label: 'Conversation picker',
  searchPlaceholder: 'Find a conversation',
  newConversation: 'Start fresh',
  empty: 'Nothing matches',
  queued: 'Queued work',
  groups: {
    attention: 'Needs response',
    working: 'In progress',
    pinned: 'Saved',
    recent: 'Latest',
  },
  threadList: threadListCopy,
};

function renderSwitcher(items: readonly FlowerCompanionThreadListItem[]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onSelect = vi.fn();
  const onNewConversation = vi.fn();
  const onEscape = vi.fn();
  const [query, setQuery] = createSignal('');
  disposers.push(render(() => (
    <FlowerThreadSwitcher
      items={items}
      activeThreadID="recent"
      query={query()}
      copy={copy}
      onQueryChange={setQuery}
      onNewConversation={onNewConversation}
      onSelect={onSelect}
      onEscape={onEscape}
    />
  ), host));
  return { host, onSelect, onNewConversation, onEscape, setQuery };
}

describe('groupFlowerThreadSwitcherItems', () => {
  it('uses one highest-value group per thread and keeps the compact group order', () => {
    const duplicateAttention = thread({ thread_id: 'attention', title: 'Approval', status: 'waiting_approval', pinned: true });
    const groups = groupFlowerThreadSwitcherItems([
      thread({ thread_id: 'recent', title: 'Recent' }),
      thread({ thread_id: 'pinned', title: 'Pinned', pinned: true }),
      thread({ thread_id: 'queued', title: 'Queued', queued_turn_count: 1, pinned: true }),
      thread({ thread_id: 'running', title: 'Running', status: 'running' }),
      duplicateAttention,
      duplicateAttention,
    ], '', threadListCopy);

    expect(groups.map((group) => group.kind)).toEqual(['attention', 'working', 'pinned', 'recent']);
    expect(groups.map((group) => group.threads.map((item) => item.thread_id))).toEqual([
      ['attention'],
      ['queued', 'running'],
      ['pinned'],
      ['recent'],
    ]);
  });

  it('reuses canonical title, preview, and target-label filtering', () => {
    const groups = groupFlowerThreadSwitcherItems([
      thread({ thread_id: 'preview', title: 'One', preview: 'Needle in preview' }),
      thread({ thread_id: 'target', title: 'Two', target_labels: ['Needle target'] }),
      thread({ thread_id: 'hidden', title: 'Other' }),
    ], 'needle', threadListCopy);

    expect(groups.flatMap((group) => group.threads.map((item) => item.thread_id))).toEqual(['preview', 'target']);
  });
});

describe('FlowerThreadSwitcher', () => {
  const items = [
    thread({ thread_id: 'attention', title: 'Approval', status: 'waiting_user' }),
    thread({ thread_id: 'running', title: 'Build', status: 'running' }),
    thread({ thread_id: 'pinned', title: 'Release', pinned: true }),
    thread({ thread_id: 'recent', title: 'Ports' }),
  ];

  it('renders localized search, new conversation, unique groups, and compact rows', () => {
    const { host } = renderSwitcher(items);

    expect(host.querySelector('input')?.getAttribute('placeholder')).toBe(copy.searchPlaceholder);
    expect(host.querySelector('[data-flower-thread-switcher-new]')?.textContent).toContain(copy.newConversation);
    expect(Array.from(host.querySelectorAll('h3')).map((heading) => heading.textContent?.trim())).toEqual([
      copy.groups.attention,
      copy.groups.working,
      copy.groups.pinned,
      copy.groups.recent,
    ]);
    expect(host.querySelectorAll('[data-flower-thread-switcher-thread]')).toHaveLength(4);
    expect(host.querySelector('[data-flower-thread-switcher-thread="attention"]')?.textContent).toContain(statuses.waiting_user);
    expect(host.querySelector('[data-flower-thread-switcher-thread="running"]')?.textContent).toContain(statuses.running);
    expect(host.querySelector('[data-flower-thread-switcher-thread="pinned"]')?.textContent).toContain(threadListCopy.pinnedBadge);
    expect(host.querySelector('button')?.className).toContain('cursor-pointer');
  });

  it('filters reactively and exposes the localized empty state', async () => {
    const { host } = renderSwitcher(items);
    const input = host.querySelector('input') as HTMLInputElement;

    input.value = 'Release';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await Promise.resolve();
    expect(host.querySelectorAll('[data-flower-thread-switcher-thread]')).toHaveLength(1);
    expect(host.querySelector('[data-flower-thread-switcher-thread="pinned"]')).toBeTruthy();

    input.value = 'missing';
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await Promise.resolve();
    expect(host.textContent).toContain(copy.empty);
  });

  it('uses Arrow keys and Enter to select without moving focus out of search', async () => {
    const { host, onSelect } = renderSwitcher(items);
    await Promise.resolve();
    const input = host.querySelector('input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await Promise.resolve();
    expect(host.querySelector('[data-flower-thread-switcher-thread="attention"]')?.getAttribute('data-highlighted')).toBe('true');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith('attention');
    expect(document.activeElement).toBe(input);
  });

  it('wraps ArrowUp to the last thread and delegates Escape to the owner', async () => {
    const { host, onSelect, onEscape } = renderSwitcher(items);
    await Promise.resolve();
    const input = host.querySelector('input') as HTMLInputElement;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith('recent');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('delegates the explicit new-conversation action', () => {
    const { host, onNewConversation } = renderSwitcher(items);
    (host.querySelector('[data-flower-thread-switcher-new]') as HTMLButtonElement).click();
    expect(onNewConversation).toHaveBeenCalledTimes(1);
  });
});
