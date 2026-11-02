import { batch, createEffect, createMemo, createSignal, on, untrack, type Accessor } from 'solid-js';
import { isSplitWorkspaceLayout, reconcileSplitWorkspace, removeSplitWorkspaceItem, splitWorkspaceItems, splitWorkspacePane, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
import { readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';

/** Product storage and selection adapter; placement mechanics remain upstream. */
export function createTerminalWorkspace(options: {
  storageKey: Accessor<string>;
  sessionIds: Accessor<readonly string[]>;
  hydrated: Accessor<boolean>;
  deferSelectionPlacement?: Accessor<boolean>;
  activeId: Accessor<string | null>;
  select: (id: string) => void;
}) {
  const [layout, setLayout] = createSignal<SplitWorkspaceLayout | null>(null);
  const [maximized, setMaximized] = createSignal(false);
  let loadedKey = '';
  createEffect(on(options.storageKey, key => {
    loadedKey = key;
    const saved = readUIStorageJSON<unknown>(key, null);
    setLayout(isSplitWorkspaceLayout(saved) ? saved : null);
    setMaximized(false);
  }));
  const commit = (next: SplitWorkspaceLayout | null) => {
    setLayout(next);
    if (loadedKey === options.storageKey()) writeUIStorageJSON(loadedKey, next);
  };
  createEffect(() => {
    options.storageKey();
    const active = options.activeId();
    const ids = options.sessionIds();
    const deferred = options.deferSelectionPlacement?.() ?? false;
    if (!options.hydrated()) return;
    untrack(() => {
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
    const active = options.activeId();
    return active && options.sessionIds().includes(active) && !paneIds().includes(active)
      ? splitWorkspacePane(active)
      : layout();
  });
  const displayedPaneIds = createMemo(() => splitWorkspaceItems(displayedLayout()));
  const closePane = (id: string) => {
    if (paneIds().length < 2) return;
    const next = removeSplitWorkspaceItem(layout(), id);
    batch(() => {
      commit(next);
      if (options.activeId() === id) options.select(splitWorkspaceItems(next)[0]);
      setMaximized(false);
    });
  };
  return { layout, displayedLayout, commit, paneIds, displayedPaneIds, maximized, setMaximized, closePane };
}
