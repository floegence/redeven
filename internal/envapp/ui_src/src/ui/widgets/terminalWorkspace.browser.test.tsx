import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { presetSplitWorkspace, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
import { createTerminalWorkspace } from './terminalWorkspace';
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  localStorage.removeItem('terminal-workspace-test');
  localStorage.removeItem('terminal-workspace-test:active-view');
  localStorage.removeItem('terminal-workspace-other:active-view');
  localStorage.removeItem('terminal-workspace-other');
});
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));
it('waits for hydration, browses unplaced sessions without rewriting splits, and preserves membership on close', async () => {
  let n = 0;
  const saved = presetSplitWorkspace('grid', ['a','b','c','d'], () => 'split-' + ++n)!;
  localStorage.setItem('terminal-workspace-test', JSON.stringify(saved));
  const [hydrated, setHydrated] = createSignal(false);
  const [ids, setIds] = createSignal<readonly string[]>([]);
  const [active, setActive] = createSignal<string | null>('b');
  let controller!: ReturnType<typeof createTerminalWorkspace>;
  dispose = render(() => {
    controller = createTerminalWorkspace({ storageKey: () => 'terminal-workspace-test', sessionIds: ids, hydrated, activeId: active, select: setActive });
    return <div />;
  }, document.body);
  await tick();
  expect(controller.paneIds()).toEqual(['a','c','b','d']);
  setIds(['a','b','c','d','e']); setHydrated(true); await tick();
  expect(controller.layout()).toEqual(saved);
  setActive('e'); await tick();
  expect(controller.layout()).toEqual(saved);
  expect(JSON.parse(localStorage.getItem('terminal-workspace-test')!)).toEqual(saved);
  setActive('b'); await tick();
  expect(controller.layout()).toEqual(saved);
  controller.closePane('b'); await tick();
  expect(controller.paneIds()).toEqual(['a','c','d']);
  expect(ids()).toContain('e');
  expect(active()).toBe('a');
  setIds(['c','d','e']); await tick();
  expect(controller.paneIds()).toEqual(['c','d']);
  const stored = JSON.parse(localStorage.getItem('terminal-workspace-test')!) as SplitWorkspaceLayout;
  expect(stored).toEqual(controller.layout());
});
it('rejects malformed saved layouts without affecting available sessions', async () => {
  localStorage.setItem('terminal-workspace-test', '{"type":"split","ratio":5}');
  let controller!: ReturnType<typeof createTerminalWorkspace>;
  dispose = render(() => {
    controller = createTerminalWorkspace({ storageKey: () => 'terminal-workspace-test', sessionIds: () => ['a'], hydrated: () => true, activeId: () => 'a', select: () => undefined });
    return <div />;
  }, document.body);
  await tick();
  expect(controller.paneIds()).toEqual(['a']);
});
it('defers selection placement during creation and isolates environment storage', async () => {
  let n = 0;
  const saved = presetSplitWorkspace('columns', ['a', 'b'], () => 'split-' + ++n)!;
  localStorage.setItem('terminal-workspace-test', JSON.stringify(saved));
  localStorage.setItem('terminal-workspace-other', JSON.stringify({ type: 'pane', id: 'z' }));
  const [key, setKey] = createSignal('terminal-workspace-test');
  const [ids, setIds] = createSignal<readonly string[]>(['a', 'b', 'c']);
  const [active, setActive] = createSignal<string | null>('a');
  const [busy, setBusy] = createSignal(false);
  let controller!: ReturnType<typeof createTerminalWorkspace>;
  dispose = render(() => {
    controller = createTerminalWorkspace({
      storageKey: key, sessionIds: ids, hydrated: () => true,
      activeId: active, select: setActive, deferSelectionPlacement: busy,
    });
    return <div />;
  }, document.body);
  await tick();
  setBusy(true); setActive('c'); await tick();
  expect(controller.layout()).toEqual(saved);
  controller.commit(presetSplitWorkspace('three-columns', ids(), () => 'split-' + ++n));
  setBusy(false); await tick();
  expect(controller.paneIds()).toEqual(['a', 'b', 'c']);
  const previous = localStorage.getItem('terminal-workspace-test');
  batch(() => { setKey('terminal-workspace-other'); setIds(['z']); setActive('z'); });
  await tick();
  expect(controller.paneIds()).toEqual(['z']);
  expect(localStorage.getItem('terminal-workspace-test')).toBe(previous);
});

it('selects the owning view when browsing a member from another view', async () => {
  const { createTerminalViewCatalog } = await import('../services/terminalViewCatalog');
  const views = [
    { id: 'view-ab', name: 'AB', layout: presetSplitWorkspace('columns', ['a', 'b'], () => 'split-ab')!, revision: 2, createdAtMs: 1, updatedAtMs: 1 },
    { id: 'view-cd', name: 'CD', layout: presetSplitWorkspace('rows', ['c', 'd'], () => 'split-cd')!, revision: 3, createdAtMs: 2, updatedAtMs: 2 },
  ];
  const [active, setActive] = createSignal<string | null>('a');
  let workspace!: ReturnType<typeof createTerminalWorkspace>;
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => {
    catalog = createTerminalViewCatalog({ scope: () => 'env', connected: () => true, rpc: {
      listViews: async () => ({ revision: 3, views }), updateViews: async () => ({ revision: 3, views }), onViewsChanged: () => () => undefined,
    } });
    workspace = createTerminalWorkspace({ catalog, storageKey: () => 'terminal-workspace-test', sessionIds: () => ['a', 'b', 'c', 'd', 'e'], hydrated: () => true, activeId: active, select: setActive });
    return <div />;
  }, document.body);
  await expect.poll(catalog.ready).toBe(true);
  expect(workspace.activeViewId()).toBe('view-ab');
  workspace.activateView('view-cd');
  batch(() => { workspace.browseSession('b'); setActive('b'); });
  expect(workspace.activeViewId()).toBe('view-ab');
  expect(workspace.displayedPaneIds()).toEqual(['a', 'b']);
  expect(active()).toBe('b');
  batch(() => { workspace.browseSession('e'); setActive('e'); });
  expect(workspace.activeViewId()).toBeNull();
  expect(workspace.displayedPaneIds()).toEqual(['e']);
  batch(() => { workspace.browseSession('b'); setActive('b'); });
  workspace.closePane('b');
  expect(catalog.ownerOf('b')).toBeUndefined();
  expect(catalog.ownerOf('a')?.id).toBe('view-ab');
  expect(active()).toBe('a');
  workspace.closePane('a');
  expect(catalog.ownerOf('a')).toBeUndefined();
  expect(workspace.activeViewId()).toBeNull();
  expect(workspace.displayedPaneIds()).toEqual(['a']);
});
