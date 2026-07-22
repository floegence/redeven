import '../../index.css';

import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { Copy, FileText } from '@floegence/floe-webapp-core/icons';
import { InfiniteCanvas } from '@floegence/floe-webapp-core/ui';

import {
  GitEntityContextMenu,
  createGitEntityContextMenuController,
  type GitContextMenuActionItem,
} from './GitEntityContextMenu';
import { FLOATING_CONTEXT_MENU_WIDTH_PX } from './FloatingContextMenu';
import { PreviewWindow } from './PreviewWindow';

const renderDisposers: Array<() => void> = [];

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => window.setTimeout(resolve, 120));
}

function Harness() {
  const controller = createGitEntityContextMenuController<{ id: string }>();
  const [selection, setSelection] = createSignal('none');
  const [viewport, setViewport] = createSignal({ x: 36, y: 24, scale: 1.15 });
  const items = (target: { id: string }): GitContextMenuActionItem[] => [
    {
      id: 'inspect',
      kind: 'action',
      group: 'inspect',
      rank: 10,
      label: `Inspect ${target.id}`,
      icon: FileText,
      onSelect: () => setSelection(`inspect:${target.id}`),
    },
    {
      id: 'disabled-copy',
      kind: 'action',
      group: 'inspect',
      rank: 20,
      label: 'Datei aus aktuellem Arbeitsbaum in Vorschau anzeigen',
      icon: Copy,
      disabled: true,
      disabledReason: 'The current file is unavailable.',
      onSelect: () => setSelection('disabled-action-ran'),
    },
    {
      id: 'open-terminal', kind: 'action', group: 'navigate', rank: 10,
      label: 'Open Terminal', icon: FileText,
      onSelect: () => setSelection(`terminal:${target.id}`),
    },
    {
      id: 'browse-files', kind: 'action', group: 'navigate', rank: 20,
      label: 'Browse Files', icon: FileText,
      onSelect: () => setSelection(`files:${target.id}`),
    },
    {
      id: 'checkout', kind: 'action', group: 'modify', rank: 10,
      label: 'Checkout Branch', icon: FileText,
      onSelect: () => setSelection(`checkout:${target.id}`),
    },
    {
      id: 'copy-name', kind: 'action', group: 'clipboard', rank: 20,
      label: 'Copy Branch Name', icon: Copy,
      onSelect: () => setSelection(`copy:${target.id}`),
    },
    {
      id: 'copy-path', kind: 'action', group: 'clipboard', rank: 30,
      label: 'Copy Worktree Path', icon: Copy,
      onSelect: () => setSelection(`copy-path:${target.id}`),
    },
    {
      id: 'delete', kind: 'action', group: 'destructive', rank: 10,
      label: 'Delete Branch', icon: Copy, destructive: true,
      onSelect: () => setSelection(`delete:${target.id}`),
    },
  ];

  return (
    <FloeConfigProvider>
      <LayoutProvider>
        <InfiniteCanvas viewport={viewport()} onViewportChange={setViewport} ariaLabel="Git menu canvas">
          <div
            data-testid="surface-host"
            data-floe-dialog-surface-host="true"
            style={{ position: 'relative', width: '440px', height: '300px' }}
          >
            <button type="button" data-testid="focus-before-git-target">Before branch</button>
            <button
              type="button"
              data-testid="git-target"
              style={{ position: 'absolute', right: '8px', bottom: '8px' }}
              onContextMenu={(event) => controller.openFromContextMenu(event, { id: 'branch-main' })}
              onKeyDown={(event) => controller.openFromKeyboard(event, { id: 'branch-main' })}
            >
              Branch main
            </button>
            <button type="button" data-testid="focus-after-git-target">After branch</button>
            <output data-testid="selection">{selection()}</output>
            <GitEntityContextMenu controller={controller} items={items} />
          </div>
        </InfiniteCanvas>
      </LayoutProvider>
    </FloeConfigProvider>
  );
}

function PreviewWindowHarness() {
  const controller = createGitEntityContextMenuController<{ id: string }>();
  const items = (target: { id: string }): GitContextMenuActionItem[] => [
    { id: 'ask', kind: 'action', group: 'assistant', rank: 10, label: `Ask Flower about ${target.id}`, icon: FileText, onSelect: () => undefined },
    { id: 'diff', kind: 'action', group: 'inspect', rank: 10, label: 'View Diff', icon: FileText, onSelect: () => undefined },
    { id: 'preview', kind: 'action', group: 'inspect', rank: 20, label: 'Preview Current File', icon: FileText, onSelect: () => undefined },
    { id: 'terminal', kind: 'action', group: 'navigate', rank: 10, label: 'Open Terminal', icon: FileText, onSelect: () => undefined },
    { id: 'files', kind: 'action', group: 'navigate', rank: 20, label: 'Browse Files', icon: FileText, onSelect: () => undefined },
    { id: 'apply', kind: 'action', group: 'modify', rank: 10, label: 'Apply Stash', icon: FileText, onSelect: () => undefined },
    { id: 'copy', kind: 'action', group: 'clipboard', rank: 10, label: 'Copy Absolute Path', icon: Copy, onSelect: () => undefined },
    { id: 'delete', kind: 'action', group: 'destructive', rank: 10, label: 'Delete Stash', icon: Copy, destructive: true, onSelect: () => undefined },
  ];

  return (
    <FloeConfigProvider>
      <LayoutProvider>
        <PreviewWindow
          open
          onOpenChange={() => undefined}
          title="Stash details"
          persistenceKey="git-context-menu-preview-window-browser-test"
          defaultSize={{ width: 380, height: 300 }}
          minSize={{ width: 320, height: 260 }}
          maxSize={{ width: 380, height: 300 }}
        >
          <div class="relative h-full min-h-0 bg-background">
            <button
              type="button"
              data-testid="preview-git-target"
              class="absolute bottom-2 right-2"
              onContextMenu={(event) => controller.openFromContextMenu(event, { id: 'stash@{0}' })}
            >
              Stash file
            </button>
            <GitEntityContextMenu controller={controller} items={items} />
          </div>
        </PreviewWindow>
      </LayoutProvider>
    </FloeConfigProvider>
  );
}

beforeEach(async () => {
  await page.viewport(900, 620);
});

afterEach(() => {
  for (const dispose of renderDisposers.splice(0)) dispose();
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('GitEntityContextMenu browser behavior', () => {
  it('projects and clamps inside Workbench while preserving keyboard focus ownership', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);
    renderDisposers.push(render(() => <Harness />, host));
    await settle();

    const trigger = document.querySelector('[data-testid="git-target"]') as HTMLButtonElement;
    const triggerRect = trigger.getBoundingClientRect();
    trigger.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: triggerRect.right - 2,
      clientY: triggerRect.bottom - 2,
    }));
    await settle();

    const menu = document.querySelector('[role="menu"]') as HTMLElement | null;
    const surface = document.querySelector('[data-testid="surface-host"]') as HTMLElement | null;
    expect(menu).toBeTruthy();
    expect(surface).toBeTruthy();
    const menuRect = menu!.getBoundingClientRect();
    const surfaceRect = surface!.getBoundingClientRect();
    expect(menuRect.left).toBeGreaterThanOrEqual(surfaceRect.left - 1);
    expect(menuRect.top).toBeGreaterThanOrEqual(surfaceRect.top - 1);
    expect(menuRect.right).toBeLessThanOrEqual(surfaceRect.right + 1);
    expect(menuRect.bottom).toBeLessThanOrEqual(surfaceRect.bottom + 2);

    const menuItems = Array.from(menu!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    expect(menu!.classList.contains('min-w-[180px]')).toBe(true);
    expect(menuRect.width).toBeGreaterThanOrEqual(FLOATING_CONTEXT_MENU_WIDTH_PX - 2);
    expect(menuRect.width).toBeLessThanOrEqual(FLOATING_CONTEXT_MENU_WIDTH_PX + 2);
    expect(menu!.scrollWidth).toBeLessThanOrEqual(menu!.clientWidth);
    expect(menuItems[0]!.classList.contains('items-center')).toBe(true);
    expect(menuItems[0]!.classList.contains('py-1.5')).toBe(true);
    expect(menuItems[0]!.classList.contains('min-h-9')).toBe(false);
    expect(menuItems[0]!.getBoundingClientRect().height).toBeLessThanOrEqual(32);
    expect(menu!.scrollHeight).toBeLessThanOrEqual(menu!.clientHeight);
    expect(document.activeElement).toBe(menuItems[0]);
    menuItems[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(menuItems[1]);
    menuItems[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.querySelector('[data-testid="selection"]')?.textContent).toBe('none');

    menuItems[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);

    trigger.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'F10',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));
    await settle();
    const keyboardMenu = document.querySelector('[role="menu"]') as HTMLElement | null;
    expect(keyboardMenu).toBeTruthy();
    keyboardMenu!.querySelector<HTMLButtonElement>('[role="menuitem"]')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
    );
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores the Git trigger when the menu closes on Tab or Shift+Tab', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);
    renderDisposers.push(render(() => <Harness />, host));
    await settle();

    const trigger = document.querySelector('[data-testid="git-target"]') as HTMLButtonElement;
    const before = document.querySelector('[data-testid="focus-before-git-target"]') as HTMLButtonElement;
    const after = document.querySelector('[data-testid="focus-after-git-target"]') as HTMLButtonElement;
    const openMenu = async () => {
      trigger.focus();
      trigger.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'F10',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
      await settle();
      expect(document.querySelector('[role="menu"]')).toBeTruthy();
    };

    await openMenu();
    await userEvent.tab();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(after);

    await openMenu();
    await userEvent.tab({ shift: true });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.activeElement).not.toBe(before);
  });

  it('projects a full Git action menu inside an actual PreviewWindow overlay', async () => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    document.body.appendChild(host);
    renderDisposers.push(render(() => <PreviewWindowHarness />, host));
    await settle();

    const trigger = document.querySelector('[data-testid="preview-git-target"]') as HTMLButtonElement | null;
    const floatingRoot = trigger?.closest('[data-floe-geometry-surface="floating-window"]') as HTMLElement | null;
    const surface = trigger?.closest('[data-floe-dialog-surface-host="true"]') as HTMLElement | null;
    expect(trigger).toBeTruthy();
    expect(floatingRoot).toBeTruthy();
    expect(surface).toBeTruthy();

    const triggerRect = trigger!.getBoundingClientRect();
    trigger!.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: triggerRect.right - 1,
      clientY: triggerRect.bottom - 1,
    }));
    await settle();

    const menu = document.querySelector('[role="menu"]') as HTMLElement | null;
    expect(menu).toBeTruthy();
    expect(menu!.querySelectorAll('[role="menuitem"]')).toHaveLength(8);
    expect(surface!.contains(menu)).toBe(true);
    expect(menu!.closest('[data-floe-surface-portal-layer]')).toBeTruthy();
    const menuRect = menu!.getBoundingClientRect();
    const boundaryRect = floatingRoot!.getBoundingClientRect();
    expect(menuRect.left).toBeGreaterThanOrEqual(boundaryRect.left - 1);
    expect(menuRect.top).toBeGreaterThanOrEqual(boundaryRect.top - 1);
    expect(menuRect.right).toBeLessThanOrEqual(boundaryRect.right + 1);
    expect(menuRect.bottom).toBeLessThanOrEqual(boundaryRect.bottom + 1);
    expect(menu!.scrollHeight).toBeLessThanOrEqual(menu!.clientHeight);

    const firstAction = menu!.querySelector<HTMLButtonElement>('[role="menuitem"]')!;
    firstAction.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }));
    await settle();
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.querySelector('[data-floe-geometry-surface="floating-window"]')).toBe(floatingRoot);
    expect(document.activeElement).toBe(trigger);
  });
});
