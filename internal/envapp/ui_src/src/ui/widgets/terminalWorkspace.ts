import { batch, createEffect, createMemo, createSignal, on, untrack, type Accessor } from 'solid-js';
import { isSplitWorkspaceLayout, mapSplitWorkspace, measureSplitWorkspace, createSplitWorkspaceArrangements, reconcileSplitWorkspace, splitWorkspaceItems, splitWorkspacePane, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
import { emptyViewSlots, viewSessionIds, vacateViewSessions, type TerminalViewLayout } from '../services/terminalViewLayout';
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
  select: (id: string | null) => void;
}) {
  const catalog = options.catalog;
  const [activeVacancy, setActiveVacancy] = createSignal<string | null>(null);
  const [activeViewId, setActiveViewId] = createSignal<string | null>(null);
  const [layout, setLayout] = createSignal<SplitWorkspaceLayout | null>(null);
  let loadedKey = '';
  let legacyImportConsidered = false;
  createEffect(on(options.storageKey, key => {
    setActiveVacancy(null);
    loadedKey = key;
    legacyImportConsidered = false;
    const saved = readUIStorageJSON<unknown>(key, null);
    setLayout(isSplitWorkspaceLayout(saved) ? saved : null);
    setActiveViewId(readUIStorageJSON<string | null>(key + ':active-view', null));
  }));
  const nextViewName = () => {
    const names = new Set(catalog?.views().map(view => view.name));
    let index = 1;
    while (names.has(options.viewName?.(index) ?? String(index))) index++;
    return options.viewName?.(index) ?? String(index);
  };
  const selectViewId = (id: string | null) => {
    if (id !== activeViewId()) setActiveVacancy(null);
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
      batch(() => { catalog.put({ id, name: current?.name ?? nextViewName(), layout: next }); selectViewId(id); });
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
    if (activeViewId()) { selectViewId(null); setLayout(options.activeId() ? splitWorkspacePane(options.activeId()!) : null); }
    if (legacyImportConsidered) {
      const owner = options.activeId() ? catalog.ownerOf(options.activeId()!) : undefined;
      if (owner) { selectViewId(owner.id); setLayout(owner.layout); }
      return;
    }
    legacyImportConsidered = true;
    const owner = options.activeId() ? catalog.ownerOf(options.activeId()!) : undefined;
    if (owner) { selectViewId(owner.id); setLayout(owner.layout); return; }
    // Import the old local split once; backend views are authoritative thereafter.
    const legacy = readUIStorageJSON<unknown>(options.storageKey(), null);
    if (isSplitWorkspaceLayout(legacy) && splitWorkspaceItems(legacy).length > 1) {
      const id = 'legacy-' + options.storageKey().split(':').slice(2).join('-');
      if (!views.some(view => view.id === id)) {
        const available = reconcileSplitWorkspace(legacy, splitWorkspaceItems(legacy).filter(session => !catalog.ownerOf(session)));
        if (available) { catalog.put({ id, name: nextViewName(), layout: available }); selectViewId(id); }
        else writeUIStorageJSON(options.storageKey(), null);
      } else selectViewId(id);
    }
  });
  const availableArrangements = (viewId: string | null = activeViewId()) => {
    if (!catalog?.ready()) return [];
    const view = catalog.views().find(item => item.id === viewId);
    if (!view) return [];
    const members = [...measureSplitWorkspace(view.layout).panes.entries()]
      .sort(([, a], [, b]) => Math.round(a.y * 1e6) - Math.round(b.y * 1e6) || a.x - b.x).map(([id]) => id);
    const empty = emptyViewSlots(view.layout);
    let sequence = 0;
    return createSplitWorkspaceArrangements(members, () => 'arrangement-' + ++sequence).map(choice => {
      let layout: TerminalViewLayout = choice.layout;
      for (const id of empty) layout = mapSplitWorkspace(layout, id, () => ({ type: 'pane', id, empty: true } as TerminalViewLayout));
      return { ...choice, layout };
    });
  };
  const applyArrangement = (arrangementId: string, viewId: string | null = activeViewId()) => {
    const view = catalog?.views().find(item => item.id === viewId);
    const choice = availableArrangements(viewId).find(item => item.id === arrangementId);
    if (!view || !choice) return;
    // Resolve against the current target view when committing, so open pickers
    // cannot overwrite a newer membership snapshot or switch another view.
    const identify = (node: TerminalViewLayout): TerminalViewLayout => node.type === 'pane' ? node : {
      ...node, id: 'split-' + crypto.randomUUID(), first: identify(node.first), second: identify(node.second),
    };
    const next = identify(choice.layout);
    const members = splitWorkspaceItems(view.layout);
    const nextMembers = splitWorkspaceItems(next);
    if (members.length !== nextMembers.length || !members.every(id => nextMembers.includes(id))) return;
    catalog?.put({ id: view.id, name: view.name, layout: next });
  };
  const activateView = (id: string) => {
    const view = catalog?.views().find(view => view.id === id);
    if (!view) return;
    const available = reconcileSplitWorkspace(view.layout, viewSessionIds(view.layout).filter(id => options.sessionIds().includes(id)));
    batch(() => {
      setActiveVacancy(null);
      selectViewId(id); setLayout(view.layout);
      const ids = splitWorkspaceItems(available);
      options.select(ids.includes(options.activeId() ?? '') ? options.activeId()! : ids[0] ?? null);
    });
  };
  const browseSession = (id: string | null) => {
    if (!catalog || !id) return;
    const owner = catalog.ownerOf(id);
    batch(() => { setActiveVacancy(null); selectViewId(owner?.id ?? null); setLayout(owner?.layout ?? splitWorkspacePane(id)); });
  };
  const leaveView = () => { batch(() => { selectViewId(null); setLayout(null); }); };
  const newView = (sessionId: string) => {
    const active = sessionId;
    if (!catalog?.ready() || !active) return;
    batch(() => {
      const id = 'view-' + crypto.randomUUID();
      const next = splitWorkspacePane(active);
      catalog.put({ id, name: nextViewName(), layout: next });
      selectViewId(id); setLayout(next);
    });
  };
  const removeView = (id: string) => {
    const wasActive = id === activeViewId();
    batch(() => {
      catalog?.remove(id);
      if (wasActive) { selectViewId(null); setLayout(options.activeId() ? splitWorkspacePane(options.activeId()!) : null); }
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
    if (catalog && activeViewId()) return layout();
    const active = options.activeId();
    return active && options.sessionIds().includes(active) && !paneIds().includes(active)
      ? splitWorkspacePane(active)
      : layout();
  });
  const displayedPaneIds = createMemo(() => viewSessionIds(displayedLayout()).filter(id => options.sessionIds().includes(id)));
  const vacantPaneIds = createMemo(() => {
    const empty = emptyViewSlots(displayedLayout());
    return splitWorkspaceItems(displayedLayout()).filter(id => empty.has(id) || !options.sessionIds().includes(id));
  });
  const activePaneId = createMemo(() => vacantPaneIds().includes(activeVacancy() ?? '') ? activeVacancy() : displayedPaneIds().includes(options.activeId() ?? '') ? options.activeId() : vacantPaneIds()[0] ?? null);
  const activatePane = (id: string) => {
    const vacant = vacantPaneIds().includes(id);
    batch(() => { setActiveVacancy(vacant ? id : null); if (vacant) options.select(null); });
  };
  const fillVacancy = (slotId: string, sessionId: string) => {
    if (!layout() || !activeViewId() || !vacantPaneIds().includes(slotId)) return false;
    const base = vacateViewSessions(layout()!, new Set([sessionId]));
    commit(mapSplitWorkspace(base, slotId, () => splitWorkspacePane(sessionId)));
    setActiveVacancy(null);
    return true;
  };
  createEffect(() => {
    if (!catalog || !activeViewId() || !options.hydrated() || options.deferSelectionPlacement?.()) return;
    if (vacantPaneIds().includes(activeVacancy() ?? '')) return;
    const ids = displayedPaneIds();
    if (!ids.includes(options.activeId() ?? '')) options.select(ids[0] ?? null);
  });
  const releaseSession = (id: string) => {
    const view = catalog?.ownerOf(id);
    if (view) catalog?.put({ ...view, layout: vacateViewSessions(view.layout, new Set([id])) });
  };
  return { layout, displayedLayout, commit, availableArrangements, applyArrangement, paneIds, displayedPaneIds, vacantPaneIds, activePaneId, activatePane, fillVacancy, releaseSession, activeViewId, activateView, browseSession, removeView, renameView, newView, leaveView };
}
