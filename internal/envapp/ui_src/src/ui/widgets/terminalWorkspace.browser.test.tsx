import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { presetSplitWorkspace, dockSplitWorkspaceItem, measureSplitWorkspace, splitWorkspaceItems, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
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
  setIds(['a', 'c', 'd', 'e']); await tick();
  expect(controller.paneIds()).toEqual(['a','c','d']);
  expect(ids()).toContain('e');
  setActive('a');
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
  workspace.releaseSession('b');
  expect(catalog.ownerOf('b')).toBeUndefined();
  expect(catalog.ownerOf('a')?.id).toBe('view-ab');
  expect(active()).toBe('a');
  workspace.releaseSession('a');
  expect(catalog.ownerOf('a')).toBeUndefined();
  expect(workspace.activeViewId()).toBe('view-ab');
  expect(workspace.displayedPaneIds()).toEqual([]);
  expect(workspace.vacantPaneIds()).toHaveLength(2);
});


it.each([2, 3, 4, 5, 8, 16, 32])('preserves every saved member and focus when arranging a view with %s sessions', async count => {
  const { createTerminalViewCatalog } = await import('../services/terminalViewCatalog');
  const ids = ['a', 'b', ...Array.from({ length: count - 2 }, (_, index) => 'missing-' + index)];
  let layout: SplitWorkspaceLayout = { type: 'pane', id: ids[0] };
  for (const id of ids.slice(1)) layout = dockSplitWorkspaceItem(layout, id, ids[0], 'right', 'split-' + id)!;
  const views = [
    { id: 'current', name: 'Current', layout, revision: 2, createdAtMs: 1, updatedAtMs: 1 },
    { id: 'other', name: 'Other', layout: { type: 'pane' as const, id: 'outside' }, revision: 3, createdAtMs: 1, updatedAtMs: 1 },
  ];
  const [active, setActive] = createSignal<string | null>('b');
  let workspace!: ReturnType<typeof createTerminalWorkspace>;
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => {
    catalog = createTerminalViewCatalog({ scope: () => 'env', connected: () => true, rpc: {
      listViews: async () => ({ revision: 3, views }), updateViews: async () => ({ revision: 3, views }), onViewsChanged: () => () => undefined,
    } });
    workspace = createTerminalWorkspace({ catalog, storageKey: () => 'terminal-workspace-test', sessionIds: () => ['a', 'b', 'outside', 'solo'], hydrated: () => true, activeId: active, select: setActive });
    return <div />;
  }, document.body);
  await expect.poll(catalog.ready).toBe(true);
  const presets = workspace.availableArrangements();
  expect(presets.length).toBeGreaterThanOrEqual(6);
  const before = workspace.layout();
  workspace.applyArrangement('single');
  expect(workspace.layout()).toBe(before);
  for (const preset of presets) {
    workspace.applyArrangement(preset.id);
    expect(splitWorkspaceItems(catalog.views().find(view => view.id === 'current')!.layout).sort()).toEqual([...ids].sort());
    expect(catalog.views().find(view => view.id === 'other')).toEqual(views[1]);
    expect(active()).toBe('b');
    const positions = measureSplitWorkspace(workspace.layout()).panes;
    workspace.applyArrangement(preset.id);
    expect(measureSplitWorkspace(workspace.layout()).panes).toEqual(positions);
  }
  const currentLayout = workspace.layout();
  workspace.applyArrangement('rows-1', 'other');
  expect(workspace.layout()).toBe(currentLayout);
  expect(active()).toBe('b');
  batch(() => { workspace.browseSession('solo'); setActive('solo'); });
  expect(workspace.availableArrangements()).toEqual([]);
  workspace.applyArrangement('grid');
  expect(workspace.activeViewId()).toBeNull();
  expect(workspace.displayedPaneIds()).toEqual(['solo']);
  expect(catalog.views()).toHaveLength(2);
});

it('keeps saved pane geometry when sessions disappear, including the last session', async () => {
  const { createTerminalViewCatalog } = await import('../services/terminalViewCatalog');
  const layout = presetSplitWorkspace('columns', ['a', 'b'], () => 'split-ab')!;
  const [ids, setIds] = createSignal<readonly string[]>(['a', 'b']);
  const [active, setActive] = createSignal<string | null>('a');
  let workspace!: ReturnType<typeof createTerminalWorkspace>;
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => {
    catalog = createTerminalViewCatalog({ scope: () => 'env', connected: () => true, rpc: {
      listViews: async () => ({ revision: 2, views: [{ id: 'view', name: 'View', layout, revision: 2, createdAtMs: 1, updatedAtMs: 1 }] }),
      updateViews: async () => { throw new Error('Not expected'); }, onViewsChanged: () => () => undefined,
    } });
    workspace = createTerminalWorkspace({ catalog, storageKey: () => 'terminal-workspace-test', sessionIds: ids, hydrated: () => true, activeId: active, select: setActive });
    return <div />;
  }, document.body);
  await expect.poll(catalog.ready).toBe(true);
  setIds(['b']); await tick();
  expect(measureSplitWorkspace(workspace.displayedLayout()).panes.size).toBe(2);
  setIds([]); await tick();
  expect(measureSplitWorkspace(workspace.displayedLayout()).panes.size).toBe(2);
  expect(catalog.views()).toHaveLength(1);
});

it('arranges an inactive view without changing selection and preserves its vacant slots', async () => {
  const { createTerminalViewCatalog } = await import('../services/terminalViewCatalog');
  const { emptyViewSlots, viewSessionIds } = await import('../services/terminalViewLayout');
  const initial = { type: 'split' as const, id: 'pair', axis: 'x' as const, ratio: .5,
    first: { type: 'pane' as const, id: 'outside' }, second: { type: 'pane' as const, id: 'vacant', empty: true as const } };
  const views = [
    { id: 'current', name: 'Current', layout: { type: 'pane' as const, id: 'a' }, revision: 1, createdAtMs: 1, updatedAtMs: 1 },
    { id: 'other', name: 'Other', layout: initial, revision: 1, createdAtMs: 1, updatedAtMs: 1 },
  ];
  const [active, setActive] = createSignal<string | null>('a');
  let workspace!: ReturnType<typeof createTerminalWorkspace>;
  let catalog!: ReturnType<typeof createTerminalViewCatalog>;
  dispose = render(() => {
    catalog = createTerminalViewCatalog({ scope: () => 'env', connected: () => true, rpc: {
      listViews: async () => ({ revision: 1, views }), updateViews: async () => { throw new Error('not saved in test'); }, onViewsChanged: () => () => undefined,
    } });
    workspace = createTerminalWorkspace({ catalog, storageKey: () => 'terminal-workspace-test', sessionIds: () => ['a', 'outside'], hydrated: () => true, activeId: active, select: setActive });
    return <div />;
  }, document.body);
  await expect.poll(catalog.ready).toBe(true);
  const current = workspace.layout();
  expect(workspace.availableArrangements('other').length).toBeGreaterThanOrEqual(6);
  workspace.applyArrangement('rows-2', 'other');
  const other = catalog.views().find(view => view.id === 'other')!;
  expect(other.layout).toMatchObject({ axis: 'y' });
  expect(viewSessionIds(other.layout)).toEqual(['outside']);
  expect([...emptyViewSlots(other.layout)]).toEqual(['vacant']);
  expect(workspace.layout()).toBe(current);
  expect(workspace.activeViewId()).toBe('current');
  expect(active()).toBe('a');
});
