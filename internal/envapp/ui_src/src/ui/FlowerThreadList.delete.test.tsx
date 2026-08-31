// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
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
    snapshot: { activity_revision: 1 },
    read_state: { last_seen_activity_revision: 1 },
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

async function settleMenuFocus(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await Promise.resolve();
}

function renderList(showDeleteAction = true, initialItems: readonly FlowerThreadListItem[] = [thread()]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const onMenuAction = vi.fn();
  const [items, setItems] = createSignal(initialItems);
  const [query, setQuery] = createSignal('');
  const [activeThreadID, setActiveThreadID] = createSignal('thread-delete');
  disposers.push(render(() => (
    <FlowerThreadList
      items={items()}
      activeThreadID={activeThreadID()}
      query={query()}
      onQueryChange={setQuery}
      onSelect={() => undefined}
      onRefresh={() => undefined}
      onMenuAction={onMenuAction}
      canFork
      canRename
      canPin
      showDeleteAction={showDeleteAction}
    />
  ), host));
  return { host, onMenuAction, setItems, setQuery, setActiveThreadID };
}

describe('FlowerThreadList deletion entry', () => {
  it('offers exactly one destructive Delete action through the context menu', async () => {
    const { host, onMenuAction } = renderList();
    const menuTrigger = host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement;

    menuTrigger.click();
    await settleMenuFocus();

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
    await settleMenuFocus();

    expect(host.querySelector('[role="menuitem"][data-destructive="true"]')).toBeNull();
    expect(host.querySelector('[data-icon="trash"]')).toBeNull();
  });

  it('keeps an open menu on the latest thread metadata', async () => {
    const { host, onMenuAction, setItems } = renderList();
    (host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement).click();
    await settleMenuFocus();

    setItems([{ ...thread(), title: 'Updated release review', working_dir: '/workspace/latest', pinned: true }]);
    await Promise.resolve();

    const menu = host.querySelector('[role="menu"]');
    expect(menu?.getAttribute('aria-label')).toContain('Updated release review');
    expect(menu?.textContent).toContain('Unpin');
    const copyWorkdir = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((item) => item.textContent?.includes('Copy working directory'));
    copyWorkdir?.click();
    expect(onMenuAction).toHaveBeenCalledWith(
      'copy_workdir',
      expect.objectContaining({ title: 'Updated release review', working_dir: '/workspace/latest', pinned: true }),
      expect.any(HTMLElement),
    );
    const restore = onMenuAction.mock.calls[0]?.[2] as HTMLElement | undefined;
    expect(restore?.isConnected).toBe(true);
    expect(restore?.classList.contains('flower-thread-card-menu-button')).toBe(true);
  });

  it('keeps an open menu while its thread remains present but leaves the filtered rows', async () => {
    const { host, setItems } = renderList();
    (host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement).click();
    await settleMenuFocus();

    setItems([{ ...thread(), title: '' }]);
    await Promise.resolve();

    expect(host.querySelector('[role="menu"]')).toBeTruthy();
    expect(host.querySelector('[data-flower-thread-card]')).toBeNull();
  });

  it('does not close when focus returns to the menu trigger during opening', async () => {
    const { host } = renderList();
    const menuTrigger = host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement;
    menuTrigger.click();
    await settleMenuFocus();
    expect(host.querySelector('[role="menu"]')).toBeTruthy();

    menuTrigger.focus();
    await Promise.resolve();

    expect(host.querySelector('[role="menu"]')).toBeTruthy();
  });

  it('closes on search, selection, outside pointer or focus, and Escape', async () => {
    const { host, setQuery, setActiveThreadID } = renderList();
    const open = async () => {
      (host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement).click();
      await settleMenuFocus();
      expect(host.querySelector('[role="menu"]')).toBeTruthy();
    };

    await open();
    setQuery('release');
    await Promise.resolve();
    expect(host.querySelector('[role="menu"]')).toBeNull();

    setQuery('');
    await Promise.resolve();
    await open();
    setActiveThreadID('another-thread');
    await Promise.resolve();
    expect(host.querySelector('[role="menu"]')).toBeNull();

    setActiveThreadID('thread-delete');
    await Promise.resolve();
    await open();
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await Promise.resolve();
    expect(host.querySelector('[role="menu"]')).toBeNull();

    await open();
    outside.focus();
    await Promise.resolve();
    expect(host.querySelector('[role="menu"]')).toBeNull();

    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(host.querySelector('[role="menu"]')).toBeNull();

    await open();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(host.querySelector('[role="menu"]')).toBeNull();

    await open();
    window.dispatchEvent(new Event('scroll'));
    await Promise.resolve();
    expect(host.querySelector('[role="menu"]')).toBeTruthy();

    (host.querySelector('.flower-scroll') as HTMLElement).dispatchEvent(new Event('scroll'));
    await Promise.resolve();
    expect(host.querySelector('[role="menu"]')).toBeNull();

    await open();
    window.dispatchEvent(new Event('resize'));
    await Promise.resolve();
    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it('restores focus to the current trigger after metadata moves a thread between groups', async () => {
    const { host, setItems } = renderList();
    const originalTrigger = host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement;
    originalTrigger.click();
    await settleMenuFocus();

    setItems([{ ...thread(), pinned: true }]);
    await Promise.resolve();
    expect(originalTrigger.isConnected).toBe(false);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await Promise.resolve();

    const currentTrigger = host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement;
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(currentTrigger);
  });

  it('closes an open menu when a same-length refresh replaces its thread', async () => {
    const { host, setItems } = renderList();
    (host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement).click();
    await settleMenuFocus();
    expect(host.querySelector('[role="menu"]')).toBeTruthy();

    setItems([{ ...thread(), thread_id: 'thread-replacement', title: 'Replacement' }]);
    await Promise.resolve();

    expect(host.querySelector('[role="menu"]')).toBeNull();
  });

  it('opens the same menu from the keyboard and exposes its trigger while focused', async () => {
    const { host } = renderList();
    const selectButton = host.querySelector('.flower-thread-card-select-button') as HTMLButtonElement;
    const menuTrigger = host.querySelector('.flower-thread-card-menu-button') as HTMLButtonElement;

    selectButton.focus();
    selectButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
    await settleMenuFocus();

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
