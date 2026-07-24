// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FlowerThreadListItem, FlowerThreadReadStatus } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { FlowerThreadList } from '../../../../flower_ui/src/threads/FlowerThreadList';

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
}));

vi.mock('@floegence/floe-webapp-core/icons', () => ({
  Copy: () => <span data-icon="copy" />,
  Folder: () => <span data-icon="folder" />,
  GitBranch: () => <span data-icon="fork" />,
  MoreHorizontal: () => <span data-icon="menu" />,
  Pencil: () => <span data-icon="rename" />,
  Pin: () => <span data-icon="pin" />,
  Refresh: () => <span data-icon="refresh" />,
  Search: () => <span data-icon="search" />,
  Trash: () => <span data-icon="trash" />,
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
  SurfaceFloatingLayer: (props: any) => <div data-floating-layer>{props.children}</div>,
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

function thread(): FlowerThreadListItem {
  return {
    thread_id: 'thread-delete',
    title: 'Release review',
    title_status: 'ready',
    model_id: 'default/model',
    working_dir: '/workspace/redeven',
    pinned: false,
    created_at_ms: 1,
    updated_at_ms: 1,
    preview: '',
    status: 'running',
    source_label: 'this host',
    target_labels: [],
    read_status: readStatus(),
  };
}

function renderList(showDeleteAction = true) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onMenuAction = vi.fn();
  disposers.push(render(() => (
    <FlowerThreadList
      items={[thread()]}
      activeThreadID="thread-delete"
      query=""
      onQueryChange={() => undefined}
      onSelect={() => undefined}
      onRefresh={() => undefined}
      onMenuAction={onMenuAction}
      canFork
      canRename
      canPin
      showDeleteAction={showDeleteAction}
    />
  ), host));
  return { host, onMenuAction };
}

describe('FlowerThreadList deletion entry', () => {
  it('offers exactly one destructive Delete action through the context menu', async () => {
    const { host, onMenuAction } = renderList();
    const menuTrigger = host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement;

    menuTrigger.click();
    await Promise.resolve();

    const destructiveItems = host.querySelectorAll('[role="menuitem"][data-destructive="true"]');
    expect(destructiveItems).toHaveLength(1);
    expect(destructiveItems[0]?.textContent).toContain('Delete conversation');
    expect(host.querySelectorAll('[data-icon="trash"]')).toHaveLength(1);
    expect(host.querySelector('[data-icon="x"]')).toBeNull();

    (destructiveItems[0] as HTMLButtonElement).click();
    expect(onMenuAction).toHaveBeenCalledTimes(1);
    expect(onMenuAction.mock.calls[0]?.[0]).toBe('delete');
  });

  it('does not offer deletion when the surface adapter lacks that capability', async () => {
    const { host } = renderList(false);
    (host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement).click();
    await Promise.resolve();

    expect(host.querySelector('[role="menuitem"][data-destructive="true"]')).toBeNull();
    expect(host.querySelector('[data-icon="trash"]')).toBeNull();
  });

  it('opens the same menu from the keyboard and exposes its trigger while focused', async () => {
    const { host } = renderList();
    const selectButton = host.querySelector('.flower-thread-card-select-button') as HTMLButtonElement;
    const menuTrigger = host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement;

    selectButton.focus();
    selectButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
    await Promise.resolve();

    expect(host.querySelector('[role="menu"]')).toBeTruthy();
    expect(menuTrigger.className).toContain('flower-thread-card-menu-button');
    expect(document.activeElement?.getAttribute('role')).toBe('menuitem');
  });

  it('keeps coarse-pointer menu targets at least 44px and removes the direct pin shortcut', () => {
    const cssPath = resolve(process.cwd(), '../../flower_ui/src/styles/flower.css');
    const css = readFileSync(cssPath, 'utf8');
    const coarsePointerRules = css.slice(css.indexOf('@media (hover: none), (pointer: coarse)'));

    expect(coarsePointerRules).toContain('.flower-thread-card-menu-button');
    expect(coarsePointerRules).toContain('width: 2.75rem;');
    expect(coarsePointerRules).toContain('height: 2.75rem;');
    expect(coarsePointerRules).toContain('.flower-thread-menu-item');
    expect(coarsePointerRules).toContain('min-height: 2.75rem;');
    expect(coarsePointerRules).toMatch(/\.flower-thread-card-pin-button\s*{[^}]*display:\s*none;/s);
  });
});
