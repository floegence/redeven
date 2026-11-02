import { batch, createEffect, createMemo, createSignal, on, untrack, type Accessor } from 'solid-js';
import { isSplitWorkspaceLayout, reconcileSplitWorkspace, removeSplitWorkspaceItem, splitWorkspaceItems, splitWorkspacePane, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
import type { TerminalViewCatalog } from '../services/terminalViewCatalog';
import { readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';

/** Product storage and selection adapter; placement mechanics remain upstream. */
export function createTerminalWorkspace(options: {
  storageKey: Accessor<string>;
  catalog?: TerminalViewCatalog;
  viewName?: (index: number) => string;
  sessionIds: Accessor<readonly string[]>;
  hydrated: Accessor<boolean>;
  deferSelectionPlacement?: Accessor<boolean>;
  activeId: Accessor<string | null>;
  select: (id: string) => void;
}) {
  const catalog = options.catalog;
  const [activeViewId, setActiveViewId] = createSignal<string | null>(null);
  const [layout, setLayout] = createSignal<SplitWorkspaceLayout | null>(null);
  const [maximized, setMaximized] = createSignal(false);
  let loadedKey = '';
  let legacyImportConsidered = false;
  createEffect(on(options.storageKey, key => {
    loadedKey = key;
    legacyImportConsidered = false;
    const saved = readUIStorageJSON<unknown>(key, null);
    setLayout(isSplitWorkspaceLayout(saved) ? saved : null);
    setActiveViewId(readUIStorageJSON<string | null>(key + ':active-view', null));
    setMaximized(false);
  }));
  const nextViewName = () => {
    const names = new Set(catalog?.views().map(view => view.name));
    let index = 1;
    while (names.has(options.viewName?.(index) ?? String(index))) index++;
    return options.viewName?.(index) ?? String(index);
  };
  const selectViewId = (id: string | null) => {
    setActiveViewId(id);
    writeUIStorageJSON(options.storageKey() + ':active-view', id);
  };
  const commit = (next: SplitWorkspaceLayout | null) => {
    if (catalog && !catalog.ready() && (activeViewId() || splitWorkspaceItems(next).length > 1)) return;
    setLayout(next);
    if (!catalog) { if (loadedKey === options.storageKey()) writeUIStorageJSON(loadedKey, next); return; }
    if (!catalog.ready()) return;
    const current = catalog.views().find(view => view.id === activeViewId());
    if (next && (current || splitWorkspaceItems(next).length > 1)) {
      const id = current?.id ?? 'view-' + crypto.randomUUID();
      catalog.put({ id, name: current?.name ?? nextViewName(), layout: next });
      selectViewId(id);
    }
  };
  createEffect(() => {
    if (!catalog?.ready()) return;
    const views = catalog.views();
    const imported = views.find(view => view.id === 'legacy-' + options.storageKey().split(':').slice(2).join('-'));
    if (imported && imported.revision > 0) writeUIStorageJSON(options.storageKey(), null);
    const selected = views.find(view => view.id === activeViewId());
    if (selected) {
      setLayout(selected.layout);
      return;
    }
    if (activeViewId()) { selectViewId(null); setLayout(options.activeId() ? splitWorkspacePane(options.activeId()!) : null); setMaximized(false); }
    if (legacyImportConsidered) return;
    legacyImportConsidered = true;
    // Import the old local split once; backend views are authoritative thereafter.
    const legacy = readUIStorageJSON<unknown>(options.storageKey(), null);
    if (isSplitWorkspaceLayout(legacy) && splitWorkspaceItems(legacy).length > 1) {
      const id = 'legacy-' + options.storageKey().split(':').slice(2).join('-');
      if (!views.some(view => view.id === id)) catalog.put({ id, name: nextViewName(), layout: legacy });
      selectViewId(id);
    }
  });
  const activateView = (id: string) => {
    const view = catalog?.views().find(view => view.id === id);
    if (!view) return;
    const available = reconcileSplitWorkspace(view.layout, options.sessionIds());
    batch(() => {
      selectViewId(id); setLayout(view.layout); setMaximized(false);
      const ids = splitWorkspaceItems(available);
      if (ids.length) options.select(ids.includes(options.activeId() ?? '') ? options.activeId()! : ids[0]);
    });
  };
  const browseSession = (id: string | null) => {
    if (!catalog || !id) return;
    const current = catalog.views().find(view => view.id === activeViewId());
    if (current && splitWorkspaceItems(current.layout).includes(id)) return;
    selectViewId(null); setLayout(splitWorkspacePane(id)); setMaximized(false);
  };
  const leaveView = () => { selectViewId(null); setMaximized(false); };
  const newView = () => {
    const active = options.activeId();
    if (!catalog?.ready() || !active) return;
    batch(() => {
      const id = 'view-' + crypto.randomUUID();
      const next = splitWorkspacePane(active);
      catalog.put({ id, name: nextViewName(), layout: next });
      selectViewId(id); setLayout(next); setMaximized(false);
    });
  };
  const removeView = (id: string) => {
    const wasActive = id === activeViewId();
    batch(() => {
      catalog?.remove(id);
      if (wasActive) { selectViewId(null); setLayout(options.activeId() ? splitWorkspacePane(options.activeId()!) : null); setMaximized(false); }
    });
  };
  const renameView = (id: string, name: string) => {
    const view = catalog?.views().find(view => view.id === id);
    if (view && name.trim()) catalog?.put({ id, name: name.trim(), layout: view.layout });
  };
  createEffect(() => {
    options.storageKey();
    const active = options.activeId();
    const ids = options.sessionIds();
    const deferred = options.deferSelectionPlacement?.() ?? false;
    if (!options.hydrated()) return;
    untrack(() => {
      if (catalog && activeViewId()) return;
      let next = reconcileSplitWorkspace(layout(), ids);
      // Sidebar browsing must never silently replace a member of a saved split.
      // A single-pane workspace can follow selection; a split remains explicit.
      if (!deferred && active && ids.includes(active) && splitWorkspaceItems(next).length < 2) {
        if (!next || !splitWorkspaceItems(next).includes(active)) next = splitWorkspacePane(active);
      }
      if (next !== layout()) commit(next);
    });
  });
  const paneIds = createMemo(() => splitWorkspaceItems(layout()));
  const displayedLayout = createMemo(() => {
    if (catalog && activeViewId()) return reconcileSplitWorkspace(layout(), options.sessionIds());
    const active = options.activeId();
    return active && options.sessionIds().includes(active) && !paneIds().includes(active)
      ? splitWorkspacePane(active)
      : layout();
  });
  const displayedPaneIds = createMemo(() => splitWorkspaceItems(displayedLayout()));
  createEffect(() => {
    if (!catalog || !activeViewId() || !options.hydrated() || options.deferSelectionPlacement?.()) return;
    const ids = displayedPaneIds();
    if (ids.length && !ids.includes(options.activeId() ?? '')) options.select(ids[0]);
  });
  const closePane = (id: string) => {
    if (paneIds().length < 2) return;
    const next = removeSplitWorkspaceItem(layout(), id);
    batch(() => {
      commit(next);
      const available = splitWorkspaceItems(reconcileSplitWorkspace(next, options.sessionIds()));
      if (options.activeId() === id && available.length) options.select(available[0]);
      setMaximized(false);
    });
  };
  return { layout, displayedLayout, commit, paneIds, displayedPaneIds, maximized, setMaximized, closePane, activeViewId, activateView, browseSession, removeView, renameView, newView, leaveView };
}
