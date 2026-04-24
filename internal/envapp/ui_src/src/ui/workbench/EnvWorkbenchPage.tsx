import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import {
  createDefaultWorkbenchState,
  sanitizeWorkbenchState,
  type WorkbenchState,
} from '@floegence/floe-webapp-core/workbench';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Maximize, Minus } from '@floegence/floe-webapp-core/icons';
import { batch, createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { basenameFromAbsolutePath, normalizeAbsolutePath } from '../utils/askFlowerPath';
import { envWidgetTypeForSurface } from '../envViewMode';
import { useEnvContext } from '../pages/EnvContext';
import { isDesktopStateStorageAvailable, readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';
import { resolveEnvAppStorageBinding } from '../services/uiPersistence';
import {
  connectWorkbenchLayoutEventStream,
  createWorkbenchTerminalSession,
  deleteWorkbenchTerminalSession,
  getWorkbenchLayoutSnapshot,
  putWorkbenchLayout,
  putWorkbenchWidgetState,
  WorkbenchLayoutConflictError,
  WorkbenchWidgetStateConflictError,
} from '../services/workbenchLayoutApi';
import { RedevenWorkbenchSurface, type RedevenWorkbenchSurfaceApi } from './surface/RedevenWorkbenchSurface';
import { redevenWorkbenchFilterBarWidgetTypes, redevenWorkbenchWidgets } from './redevenWorkbenchWidgets';
import {
  EnvWorkbenchInstancesContext,
  type EnvWorkbenchInstancesContextValue,
} from './EnvWorkbenchInstancesContext';
import {
  buildWorkbenchFileBrowserTitle,
  buildWorkbenchFilePreviewTitle,
  buildWorkbenchInstanceStorageKey,
  findWorkbenchPreviewWidgetIdByPath,
  isRedevenWorkbenchMultiInstanceWidgetType,
  pickLatestWorkbenchWidget,
  reconcileWorkbenchInstanceState,
  sanitizeWorkbenchInstanceState,
  type RedevenWorkbenchInstanceState,
  type RedevenWorkbenchTerminalPanelState,
  type WorkbenchOpenFileBrowserRequest,
  type WorkbenchOpenFilePreviewRequest,
  type WorkbenchOpenTerminalRequest,
} from './workbenchInstanceState';
import {
  buildWorkbenchLocalStateStorageKey,
  createEmptyRuntimeWorkbenchLayoutSnapshot,
  derivePersistedWorkbenchLocalState,
  extractRuntimeWorkbenchLayoutFromWorkbenchState,
  projectWorkbenchStateFromRuntimeLayout,
  REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
  runtimeWorkbenchLayoutIsEmpty,
  runtimeWorkbenchLayoutWidgetsEqual,
  runtimeWorkbenchWidgetStateById,
  runtimeWorkbenchWidgetStateDataEqual,
  runtimeWorkbenchWidgetStatesEqual,
  samePersistedWorkbenchLocalState,
  sanitizePersistedWorkbenchLocalState,
  type PersistedWorkbenchLocalState,
  type RuntimeWorkbenchLayoutSnapshot,
  type RuntimeWorkbenchPreviewItem,
  type RuntimeWorkbenchWidgetState,
  type RuntimeWorkbenchWidgetStateData,
} from './runtimeWorkbenchLayout';
import {
  normalizeWorkbenchTheme,
  readLegacyWorkbenchThemeMigration,
  removeLegacyWorkbenchAppearance,
} from './workbenchThemeMigration';
import { WorkbenchEntryIntro } from './WorkbenchEntryIntro';

const WORKBENCH_PERSIST_DELAY_MS = 120;
const WORKBENCH_LAYOUT_FLUSH_DELAY_MS = 0;
const WORKBENCH_LAYOUT_RECONNECT_DELAY_MS = 900;
const WORKBENCH_MIN_SCALE_EPSILON = 0.0001;
const EMPTY_TERMINAL_PANEL_STATE: RedevenWorkbenchTerminalPanelState = {
  sessionIds: [],
  activeSessionId: null,
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function scaleAtMinimum(scale: number): boolean {
  return Math.abs(scale - REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE) <= WORKBENCH_MIN_SCALE_EPSILON;
}

function RedevenWorkbenchHudActions(props: {
  mount: () => HTMLDivElement | null;
  selectedWidget: () => WorkbenchState['widgets'][number] | null;
  onMinimizeCanvasScale: () => void;
  onFitSelectedWidget: () => void;
}) {
  return (
    <Show when={props.mount()}>
      {(mount) => (
        <Portal mount={mount()}>
          <div class="workbench-hud__divider" aria-hidden="true" />
          <button
            type="button"
            class="workbench-hud__button"
            aria-label="Scale canvas to minimum"
            title="Scale canvas to minimum"
            data-floe-canvas-interactive="true"
            onClick={() => props.onMinimizeCanvasScale()}
          >
            <Minus class="w-3.5 h-3.5" />
          </button>
          <Show when={props.selectedWidget()}>
            <button
              type="button"
              class="workbench-hud__button"
              aria-label="Fit selected widget to viewport"
              title="Fit selected widget to viewport"
              data-floe-canvas-interactive="true"
              onClick={() => props.onFitSelectedWidget()}
            >
              <Maximize class="w-3.5 h-3.5" />
            </button>
          </Show>
        </Portal>
      )}
    </Show>
  );
}

function shouldTrackSurfaceOwnerHandoff(previous: WorkbenchState, next: WorkbenchState): boolean {
  const nextSelectedWidgetId = compact(next.selectedWidgetId);
  if (!nextSelectedWidgetId || nextSelectedWidgetId === compact(previous.selectedWidgetId)) {
    return false;
  }
  return next.widgets.some((widget) => widget.id === nextSelectedWidgetId);
}

function requestPostInteractionFrame(callback: () => void): void {
  queueMicrotask(() => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => callback());
      return;
    }
    globalThis.setTimeout(() => callback(), 0);
  });
}

function shouldReplaceBufferedSnapshot(
  previous: RuntimeWorkbenchLayoutSnapshot | null,
  next: RuntimeWorkbenchLayoutSnapshot,
): boolean {
  if (!previous) {
    return true;
  }
  return next.seq > previous.seq || (next.seq === previous.seq && next.revision >= previous.revision);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function sameTerminalPanelState(
  left: RedevenWorkbenchTerminalPanelState,
  right: RedevenWorkbenchTerminalPanelState,
): boolean {
  return left.activeSessionId === right.activeSessionId
    && sameStringArray(left.sessionIds, right.sessionIds);
}

function samePreviewItem(left: FileItem | null | undefined, right: FileItem | null | undefined): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.path === right.path
    && left.name === right.name
    && left.type === right.type
    && left.id === right.id
    && left.size === right.size;
}

function sameInstanceState(
  left: RedevenWorkbenchInstanceState,
  right: RedevenWorkbenchInstanceState,
): boolean {
  const leftLatest = Object.entries(left.latestWidgetIdByType);
  const rightLatest = Object.entries(right.latestWidgetIdByType);
  if (leftLatest.length !== rightLatest.length) {
    return false;
  }
  for (const [type, widgetId] of leftLatest) {
    if (right.latestWidgetIdByType[type] !== widgetId) {
      return false;
    }
  }

  const leftPanels = Object.entries(left.terminalPanelsByWidgetId);
  const rightPanels = Object.entries(right.terminalPanelsByWidgetId);
  if (leftPanels.length !== rightPanels.length) {
    return false;
  }
  for (const [widgetId, panelState] of leftPanels) {
    const other = right.terminalPanelsByWidgetId[widgetId];
    if (!other || !sameTerminalPanelState(panelState, other)) {
      return false;
    }
  }

  const leftPreviewItems = Object.entries(left.previewItemsByWidgetId);
  const rightPreviewItems = Object.entries(right.previewItemsByWidgetId);
  if (leftPreviewItems.length !== rightPreviewItems.length) {
    return false;
  }
  for (const [widgetId, item] of leftPreviewItems) {
    if (!samePreviewItem(item, right.previewItemsByWidgetId[widgetId])) {
      return false;
    }
  }

  return true;
}

function filterRequestRecordByWidgetIds<T extends { widgetId: string }>(
  requests: Record<string, T>,
  widgetIds: ReadonlySet<string>,
): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [widgetId, request] of Object.entries(requests)) {
    if (!widgetIds.has(widgetId)) {
      changed = true;
      continue;
    }
    next[widgetId] = request;
  }
  return changed ? next : requests;
}

function filterGuardRecordByWidgetIds(
  guards: Record<string, () => boolean>,
  widgetIds: ReadonlySet<string>,
): Record<string, () => boolean> {
  let changed = false;
  const next: Record<string, () => boolean> = {};
  for (const [widgetId, guard] of Object.entries(guards)) {
    if (!widgetIds.has(widgetId)) {
      changed = true;
      continue;
    }
    next[widgetId] = guard;
  }
  return changed ? next : guards;
}

function filterStringRecordByWidgetIds(
  values: Record<string, string>,
  widgetIds: ReadonlySet<string>,
): Record<string, string> {
  let changed = false;
  const next: Record<string, string> = {};
  for (const [widgetId, value] of Object.entries(values)) {
    if (!widgetIds.has(widgetId)) {
      changed = true;
      continue;
    }
    next[widgetId] = value;
  }
  return changed ? next : values;
}

function filterNumberRecordByWidgetIds(
  values: Record<string, number>,
  widgetIds: ReadonlySet<string>,
): Record<string, number> {
  let changed = false;
  const next: Record<string, number> = {};
  for (const [widgetId, value] of Object.entries(values)) {
    if (!widgetIds.has(widgetId)) {
      changed = true;
      continue;
    }
    next[widgetId] = value;
  }
  return changed ? next : values;
}

function filterPreviewItemRecordByWidgetIds(
  values: Record<string, RuntimeWorkbenchPreviewItem>,
  widgetIds: ReadonlySet<string>,
): Record<string, RuntimeWorkbenchPreviewItem> {
  let changed = false;
  const next: Record<string, RuntimeWorkbenchPreviewItem> = {};
  for (const [widgetId, value] of Object.entries(values)) {
    if (!widgetIds.has(widgetId)) {
      changed = true;
      continue;
    }
    next[widgetId] = value;
  }
  return changed ? next : values;
}

function runtimePreviewItemToFileItem(item: RuntimeWorkbenchPreviewItem): FileItem {
  return {
    id: compact(item.id) || item.path,
    type: 'file',
    path: item.path,
    name: compact(item.name) || basenameFromAbsolutePath(item.path) || 'File',
    ...(typeof item.size === 'number' ? { size: item.size } : {}),
  };
}

function readPersistedWorkbenchState(storageKey: string): WorkbenchState {
  return sanitizeWorkbenchState(
    readUIStorageJSON(storageKey, null),
    {
      widgetDefinitions: redevenWorkbenchWidgets,
      createFallbackState: () => createDefaultWorkbenchState(redevenWorkbenchWidgets),
    },
  );
}

function readPersistedWorkbenchLocalState(
  storageKey: string,
  legacyWorkbenchState: WorkbenchState,
): PersistedWorkbenchLocalState {
  const localStateKey = buildWorkbenchLocalStateStorageKey(storageKey);
  const rawLocalState = readUIStorageJSON(localStateKey, null);
  const rawLegacyState = readUIStorageJSON(storageKey, null);
  const { theme: migratedTheme, shouldClearLegacyAppearance } = readLegacyWorkbenchThemeMigration();
  const rawLegacyTheme = rawLegacyState && typeof rawLegacyState === 'object'
    ? (rawLegacyState as { theme?: unknown }).theme
    : undefined;
  const legacyThemePersisted = Boolean(
    typeof rawLegacyTheme === 'string'
    && normalizeWorkbenchTheme(rawLegacyTheme) === rawLegacyTheme,
  );
  const nextLocalState = sanitizePersistedWorkbenchLocalState(
    rawLocalState,
    legacyWorkbenchState,
    redevenWorkbenchWidgets,
    !legacyThemePersisted ? migratedTheme ?? undefined : undefined,
  );
  const rawLocalTheme = rawLocalState && typeof rawLocalState === 'object'
    ? (rawLocalState as { theme?: unknown }).theme
    : undefined;
  const localThemePersisted = Boolean(
    typeof rawLocalTheme === 'string'
    && normalizeWorkbenchTheme(rawLocalTheme) === rawLocalTheme,
  );
  if (!localThemePersisted || shouldClearLegacyAppearance) {
    writeUIStorageJSON(localStateKey, nextLocalState);
  }
  if (shouldClearLegacyAppearance) {
    removeLegacyWorkbenchAppearance();
  }
  return nextLocalState;
}

function readPersistedWorkbenchInstanceState(
  storageKey: string,
  workbenchState: WorkbenchState,
): RedevenWorkbenchInstanceState {
  return sanitizeWorkbenchInstanceState(
    readUIStorageJSON(buildWorkbenchInstanceStorageKey(storageKey), null),
    workbenchState.widgets,
  );
}

function waitForAbortOrTimeout(signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = globalThis.setTimeout(resolve, timeoutMs);
    signal.addEventListener('abort', () => {
      globalThis.clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

export function EnvWorkbenchPage() {
  const env = useEnvContext();
  const storageKey = createMemo(() => resolveEnvAppStorageBinding({
    envID: env.env_id(),
    desktopStateStorageAvailable: isDesktopStateStorageAvailable(),
  }).workbenchStorageKey);
  const initialWorkbenchState = readPersistedWorkbenchState(storageKey());
  const initialLocalState = readPersistedWorkbenchLocalState(storageKey(), initialWorkbenchState);
  const [workbenchState, setWorkbenchState] = createSignal<WorkbenchState>({
    ...initialWorkbenchState,
    theme: initialLocalState.theme,
  });
  const [localState, setLocalState] = createSignal<PersistedWorkbenchLocalState>(initialLocalState);
  const [instanceState, setInstanceState] = createSignal<RedevenWorkbenchInstanceState>(
    readPersistedWorkbenchInstanceState(storageKey(), initialWorkbenchState),
  );
  const [runtimeSnapshot, setRuntimeSnapshot] = createSignal<RuntimeWorkbenchLayoutSnapshot>(
    createEmptyRuntimeWorkbenchLayoutSnapshot(),
  );
  const [runtimeLayoutReady, setRuntimeLayoutReady] = createSignal(false);
  const [submitQueued, setSubmitQueued] = createSignal(false);
  const [submitInFlight, setSubmitInFlight] = createSignal(false);
  const [activeLayoutInteractions, setActiveLayoutInteractions] = createSignal(0);
  const [pendingRemoteSnapshot, setPendingRemoteSnapshot] = createSignal<RuntimeWorkbenchLayoutSnapshot | null>(null);
  const [fileBrowserCommittedPaths, setFileBrowserCommittedPaths] = createSignal<Record<string, string>>({});
  const [appliedRemoteFileStateRevisions, setAppliedRemoteFileStateRevisions] = createSignal<Record<string, number>>({});
  const [pendingSyncedPreviewItems, setPendingSyncedPreviewItems] = createSignal<Record<string, RuntimeWorkbenchPreviewItem>>({});
  const [surfaceApi, setSurfaceApi] = createSignal<RedevenWorkbenchSurfaceApi | null>(null);
  const [terminalOpenRequests, setTerminalOpenRequests] = createSignal<Record<string, WorkbenchOpenTerminalRequest>>({});
  const [fileBrowserOpenRequests, setFileBrowserOpenRequests] = createSignal<Record<string, WorkbenchOpenFileBrowserRequest>>({});
  const [previewOpenRequests, setPreviewOpenRequests] = createSignal<Record<string, WorkbenchOpenFilePreviewRequest>>({});
  const [widgetRemoveGuards, setWidgetRemoveGuards] = createSignal<Record<string, () => boolean>>({});
  const [localOwnerHandoffActive, setLocalOwnerHandoffActive] = createSignal(false);
  const [introSurfaceHost, setIntroSurfaceHost] = createSignal<HTMLDivElement>();
  const [workbenchHudMount, setWorkbenchHudMount] = createSignal<HTMLDivElement | null>(null);
  const [introPreparing, setIntroPreparing] = createSignal(true);
  const [introVisible, setIntroVisible] = createSignal(false);
  const [introSequence, setIntroSequence] = createSignal(0);
  const [introDecisionMade, setIntroDecisionMade] = createSignal(false);
  let localOwnerHandoffToken = 0;
  let introStartFrame: number | undefined;
  let introStartSettleFrame: number | undefined;

  const runtimeWidgetStateById = createMemo(() => runtimeWorkbenchWidgetStateById(runtimeSnapshot().widget_states));
  const runtimeFilesWidgetStateById = createMemo<Record<string, RuntimeWorkbenchWidgetState>>(() => Object.fromEntries(
    runtimeSnapshot().widget_states
      .filter((state) => state.widget_type === 'redeven.files' && state.state.kind === 'files')
      .map((state) => [state.widget_id, state]),
  ));
  const runtimePreviewItemsByWidgetId = createMemo<Record<string, FileItem>>(() => Object.fromEntries(
    runtimeSnapshot().widget_states
      .filter((state) => state.widget_type === 'redeven.preview' && state.state.kind === 'preview' && state.state.item)
      .map((state) => [state.widget_id, runtimePreviewItemToFileItem(
        (state.state as Extract<RuntimeWorkbenchWidgetStateData, { kind: 'preview' }>).item as RuntimeWorkbenchPreviewItem,
      )]),
  ));
  const knownPreviewItemsByWidgetId = createMemo<Record<string, FileItem>>(() => ({
    ...instanceState().previewItemsByWidgetId,
    ...runtimePreviewItemsByWidgetId(),
  }));
  const selectedWidget = createMemo(() => {
    const selectedWidgetId = compact(workbenchState().selectedWidgetId);
    if (!selectedWidgetId) {
      return null;
    }
    return workbenchState().widgets.find((widget) => widget.id === selectedWidgetId) ?? null;
  });

  const applyRuntimeSnapshot = (snapshot: RuntimeWorkbenchLayoutSnapshot) => {
    const current = runtimeSnapshot();
    if (
      snapshot.seq < current.seq
      || (
        snapshot.seq === current.seq
        && snapshot.revision === current.revision
        && runtimeWorkbenchLayoutWidgetsEqual(snapshot.widgets, current.widgets)
        && runtimeWorkbenchWidgetStatesEqual(snapshot.widget_states, current.widget_states)
      )
    ) {
      return;
    }
    setRuntimeSnapshot(snapshot);
    setWorkbenchState((previous) => projectWorkbenchStateFromRuntimeLayout({
      snapshot,
      localState: localState(),
      existingState: previous,
      widgetDefinitions: redevenWorkbenchWidgets,
    }));
  };

  const beginLocalOwnerHandoff = () => {
    const token = ++localOwnerHandoffToken;
    setLocalOwnerHandoffActive(true);
    requestPostInteractionFrame(() => {
      if (localOwnerHandoffToken !== token) {
        return;
      }
      setLocalOwnerHandoffActive(false);
    });
  };

  const bufferRuntimeSnapshot = (snapshot: RuntimeWorkbenchLayoutSnapshot) => {
    setPendingRemoteSnapshot((previous) => (shouldReplaceBufferedSnapshot(previous, snapshot) ? snapshot : previous));
  };

  const applyRemoteRuntimeSnapshotWhenReady = (snapshot: RuntimeWorkbenchLayoutSnapshot) => {
    if (submitQueued() || submitInFlight() || localOwnerHandoffActive()) {
      bufferRuntimeSnapshot(snapshot);
      return;
    }
    applyRuntimeSnapshot(snapshot);
  };

  const applyLocalRuntimeSnapshotWhenReady = (snapshot: RuntimeWorkbenchLayoutSnapshot) => {
    if (localOwnerHandoffActive()) {
      bufferRuntimeSnapshot(snapshot);
      return;
    }
    applyRuntimeSnapshot(snapshot);
  };

  const setSurfaceWorkbenchState = (updater: (previous: WorkbenchState) => WorkbenchState) => {
    let shouldStartOwnerHandoff = false;
    setWorkbenchState((previous) => {
      const next = updater(previous);
      shouldStartOwnerHandoff = shouldTrackSurfaceOwnerHandoff(previous, next);
      return next;
    });
    if (shouldStartOwnerHandoff) {
      beginLocalOwnerHandoff();
    }
  };

  const minimizeCanvasScale = () => {
    setSurfaceWorkbenchState((previous) => {
      if (scaleAtMinimum(previous.viewport.scale)) {
        return previous;
      }
      return {
        ...previous,
        viewport: {
          ...previous.viewport,
          scale: REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
        },
      };
    });
  };

  const fitSelectedWidgetToViewport = () => {
    const widget = selectedWidget();
    const api = surfaceApi();
    if (!widget || !api) {
      return;
    }
    api.fitWidget(widget);
  };

  const applyRuntimeWidgetState = (state: RuntimeWorkbenchWidgetState, eventSeq?: number) => {
    setRuntimeSnapshot((previous) => {
      const current = previous.widget_states.find((entry) => entry.widget_id === state.widget_id);
      if (
        current
        && current.revision > state.revision
      ) {
        return previous;
      }
      if (
        current
        && current.revision === state.revision
        && current.widget_type === state.widget_type
        && runtimeWorkbenchWidgetStateDataEqual(current.state, state.state)
      ) {
        return previous;
      }
      const nextStates = [
        ...previous.widget_states.filter((entry) => entry.widget_id !== state.widget_id),
        state,
      ].sort((left, right) => left.widget_id.localeCompare(right.widget_id));
      return {
        ...previous,
        seq: Math.max(previous.seq, Math.max(0, Math.trunc(Number(eventSeq ?? 0)))),
        updated_at_unix_ms: Math.max(previous.updated_at_unix_ms, state.updated_at_unix_ms),
        widget_states: nextStates,
      };
    });
  };

  const putSharedWidgetState = async (
    widgetId: string,
    widgetType: string,
    desiredState: RuntimeWorkbenchWidgetStateData,
    retry = true,
  ): Promise<RuntimeWorkbenchWidgetState | null> => {
    const normalizedWidgetId = compact(widgetId);
    const normalizedWidgetType = compact(widgetType);
    if (!normalizedWidgetId || !normalizedWidgetType) {
      return null;
    }
    const current = runtimeWidgetStateById()[normalizedWidgetId];
    if (current && runtimeWorkbenchWidgetStateDataEqual(current.state, desiredState)) {
      return current;
    }
    try {
      const next = await putWorkbenchWidgetState(normalizedWidgetId, {
        base_revision: current?.revision ?? 0,
        widget_type: normalizedWidgetType,
        state: desiredState,
      });
      applyRuntimeWidgetState(next);
      return next;
    } catch (error) {
      if (retry && error instanceof WorkbenchWidgetStateConflictError) {
        const latestSnapshot = await getWorkbenchLayoutSnapshot();
        applyLocalRuntimeSnapshotWhenReady(latestSnapshot);
        const latest = latestSnapshot.widget_states.find((state) => state.widget_id === normalizedWidgetId);
        if (latest && runtimeWorkbenchWidgetStateDataEqual(latest.state, desiredState)) {
          return latest;
        }
        return putSharedWidgetState(normalizedWidgetId, normalizedWidgetType, desiredState, false);
      }
      console.warn('Failed to persist workbench widget state:', error);
      return null;
    }
  };

  createEffect(() => {
    const key = storageKey();
    const legacyWorkbenchState = readPersistedWorkbenchState(key);
    const nextLocalState = readPersistedWorkbenchLocalState(key, legacyWorkbenchState);
    setWorkbenchState({
      ...legacyWorkbenchState,
      theme: nextLocalState.theme,
    });
    setLocalState(nextLocalState);
    setRuntimeSnapshot(createEmptyRuntimeWorkbenchLayoutSnapshot());
    setRuntimeLayoutReady(false);
    setSubmitQueued(false);
    setSubmitInFlight(false);
    setActiveLayoutInteractions(0);
    setPendingRemoteSnapshot(null);
    setAppliedRemoteFileStateRevisions({});
    setFileBrowserCommittedPaths({});
    setPendingSyncedPreviewItems({});
    setInstanceState(readPersistedWorkbenchInstanceState(key, legacyWorkbenchState));
    setTerminalOpenRequests({});
    setFileBrowserOpenRequests({});
    setPreviewOpenRequests({});
    setWidgetRemoveGuards({});
    setLocalOwnerHandoffActive(false);
    localOwnerHandoffToken += 1;

    const abortController = new AbortController();

    const startRuntimeLayoutStream = async (signal: AbortSignal) => {
      let connectedOnce = false;

      while (!signal.aborted) {
        try {
          await connectWorkbenchLayoutEventStream({
            afterSeq: runtimeSnapshot().seq,
            signal,
            onEvent: (event) => {
              if (event.type === 'layout.replaced') {
                const nextSnapshot = event.payload as RuntimeWorkbenchLayoutSnapshot;
                applyRemoteRuntimeSnapshotWhenReady(nextSnapshot);
                return;
              }

              applyRuntimeWidgetState(event.payload as RuntimeWorkbenchWidgetState, event.seq);
            },
          });
          if (signal.aborted) return;
          connectedOnce = true;
        } catch (error) {
          if (signal.aborted) return;
          if (connectedOnce || runtimeLayoutReady()) {
            console.warn('Workbench layout event stream disconnected:', error);
          }
          connectedOnce = true;
        }

        await waitForAbortOrTimeout(signal, WORKBENCH_LAYOUT_RECONNECT_DELAY_MS);
      }
    };

    const loadRuntimeLayout = async () => {
      try {
        let snapshot = await getWorkbenchLayoutSnapshot();
        if (abortController.signal.aborted) {
          return;
        }

        let nextLocal = nextLocalState;
        if (!nextLocal.legacyLayoutMigrated) {
          if (runtimeWorkbenchLayoutIsEmpty(snapshot)) {
            const legacyLayout = extractRuntimeWorkbenchLayoutFromWorkbenchState(legacyWorkbenchState);
            if (legacyLayout.widgets.length > 0) {
              try {
                snapshot = await putWorkbenchLayout({
                  base_revision: snapshot.revision,
                  widgets: legacyLayout.widgets,
                });
              } catch (error) {
                if (error instanceof WorkbenchLayoutConflictError) {
                  snapshot = await getWorkbenchLayoutSnapshot();
                } else {
                  throw error;
                }
              }
            }
          }

          nextLocal = {
            ...nextLocal,
            legacyLayoutMigrated: true,
          };
          setLocalState(nextLocal);
        }

        if (abortController.signal.aborted) {
          return;
        }

        applyRuntimeSnapshot(snapshot);
        setRuntimeLayoutReady(true);
        void startRuntimeLayoutStream(abortController.signal);
      } catch (error) {
        if (abortController.signal.aborted) {
          return;
        }
        console.warn('Failed to load runtime workbench layout:', error);
        setRuntimeLayoutReady(true);
      }
    };

    void loadRuntimeLayout();

    onCleanup(() => {
      abortController.abort();
    });
  });

  createEffect(() => {
    const state = derivePersistedWorkbenchLocalState(
      workbenchState(),
      localState().legacyLayoutMigrated,
    );
    setLocalState((previous) => (samePersistedWorkbenchLocalState(previous, state) ? previous : state));
  });

  createEffect(() => {
    const key = buildWorkbenchLocalStateStorageKey(storageKey());
    const state = localState();
    if (!key) {
      return;
    }

    const timer = globalThis.setTimeout(() => {
      writeUIStorageJSON(key, state);
    }, WORKBENCH_PERSIST_DELAY_MS);

    onCleanup(() => {
      globalThis.clearTimeout(timer);
    });
  });

  createEffect(() => {
    if (!runtimeLayoutReady()) {
      return;
    }

    const desiredLayout = extractRuntimeWorkbenchLayoutFromWorkbenchState(workbenchState());
    const currentSnapshot = runtimeSnapshot();
    if (runtimeWorkbenchLayoutWidgetsEqual(currentSnapshot.widgets, desiredLayout.widgets)) {
      setSubmitQueued(false);
      return;
    }

    if (activeLayoutInteractions() > 0 || submitInFlight()) {
      setSubmitQueued(true);
      return;
    }

    setSubmitQueued(true);
    const timer = globalThis.setTimeout(async () => {
      const nextDesiredLayout = extractRuntimeWorkbenchLayoutFromWorkbenchState(workbenchState());
      if (runtimeWorkbenchLayoutWidgetsEqual(runtimeSnapshot().widgets, nextDesiredLayout.widgets)) {
        setSubmitQueued(false);
        return;
      }

      setSubmitInFlight(true);
      try {
        const nextSnapshot = await putWorkbenchLayout({
          base_revision: runtimeSnapshot().revision,
          widgets: nextDesiredLayout.widgets,
        });
        applyLocalRuntimeSnapshotWhenReady(nextSnapshot);
      } catch (error) {
        if (error instanceof WorkbenchLayoutConflictError) {
          try {
            const latestSnapshot = await getWorkbenchLayoutSnapshot();
            applyLocalRuntimeSnapshotWhenReady(latestSnapshot);
          } catch (refreshError) {
            console.warn('Failed to refresh workbench layout after conflict:', refreshError);
          }
        } else {
          console.warn('Failed to persist workbench layout:', error);
        }
      } finally {
        setSubmitQueued(false);
        setSubmitInFlight(false);
      }
    }, WORKBENCH_LAYOUT_FLUSH_DELAY_MS);

    onCleanup(() => {
      globalThis.clearTimeout(timer);
    });
  });

  createEffect(() => {
    const bufferedSnapshot = pendingRemoteSnapshot();
    if (!bufferedSnapshot || submitQueued() || submitInFlight() || localOwnerHandoffActive()) {
      return;
    }
    setPendingRemoteSnapshot(null);
    applyRuntimeSnapshot(bufferedSnapshot);
  });

  createEffect(() => {
    const key = buildWorkbenchInstanceStorageKey(storageKey());
    const state = instanceState();
    if (!key) {
      return;
    }

    const timer = globalThis.setTimeout(() => {
      writeUIStorageJSON(key, state);
    }, WORKBENCH_PERSIST_DELAY_MS);

    onCleanup(() => {
      globalThis.clearTimeout(timer);
    });
  });

  createEffect(() => {
    const widgets = workbenchState().widgets;
    const widgetIds = new Set(widgets.map((widget) => widget.id));

    setInstanceState((previous) => {
      const next = reconcileWorkbenchInstanceState(previous, widgets);
      return sameInstanceState(previous, next) ? previous : next;
    });
    setTerminalOpenRequests((previous) => filterRequestRecordByWidgetIds(previous, widgetIds));
    setFileBrowserOpenRequests((previous) => filterRequestRecordByWidgetIds(previous, widgetIds));
    setPreviewOpenRequests((previous) => filterRequestRecordByWidgetIds(previous, widgetIds));
    setWidgetRemoveGuards((previous) => filterGuardRecordByWidgetIds(previous, widgetIds));
    setFileBrowserCommittedPaths((previous) => filterStringRecordByWidgetIds(previous, widgetIds));
    setAppliedRemoteFileStateRevisions((previous) => filterNumberRecordByWidgetIds(previous, widgetIds));
    setPendingSyncedPreviewItems((previous) => filterPreviewItemRecordByWidgetIds(previous, widgetIds));
  });

  createEffect(() => {
    const runtimeStates = runtimeFilesWidgetStateById();
    const committedPaths = fileBrowserCommittedPaths();
    const appliedRevisions = appliedRemoteFileStateRevisions();

    const nextRequests: Record<string, WorkbenchOpenFileBrowserRequest> = {};
    const nextCommittedPaths = { ...committedPaths };
    const nextAppliedRevisions = { ...appliedRevisions };
    let shouldUpdateRequests = false;
    let shouldUpdateCommittedPaths = false;
    let shouldUpdateAppliedRevisions = false;

    for (const state of Object.values(runtimeStates)) {
      const currentPath = state.state.kind === 'files' ? state.state.current_path : '';
      if (!currentPath) {
        continue;
      }

      const widgetId = state.widget_id;
      const currentCommittedPath = normalizeAbsolutePath(committedPaths[widgetId] ?? '');
      const currentAppliedRevision = Math.max(0, Math.trunc(Number(appliedRevisions[widgetId] ?? 0)));

      if (state.revision <= currentAppliedRevision) {
        continue;
      }

      nextAppliedRevisions[widgetId] = state.revision;
      shouldUpdateAppliedRevisions = true;

      if (currentCommittedPath === currentPath) {
        continue;
      }

      nextCommittedPaths[widgetId] = currentPath;
      shouldUpdateCommittedPaths = true;
      nextRequests[widgetId] = {
        requestId: `shared-files:${widgetId}:${state.revision}`,
        widgetId,
        path: currentPath,
      };
      shouldUpdateRequests = true;
    }

    if (!shouldUpdateRequests && !shouldUpdateCommittedPaths && !shouldUpdateAppliedRevisions) {
      return;
    }

    batch(() => {
      if (shouldUpdateCommittedPaths) {
        setFileBrowserCommittedPaths(nextCommittedPaths);
      }
      if (shouldUpdateAppliedRevisions) {
        setAppliedRemoteFileStateRevisions(nextAppliedRevisions);
      }
      if (shouldUpdateRequests) {
        setFileBrowserOpenRequests((previous) => ({
          ...previous,
          ...nextRequests,
        }));
      }
    });
  });

  createEffect(() => {
    const selectedWidgetId = compact(workbenchState().selectedWidgetId);
    if (!selectedWidgetId) {
      return;
    }

    const selectedWidget = workbenchState().widgets.find((widget) => widget.id === selectedWidgetId);
    if (!selectedWidget) {
      return;
    }

    setInstanceState((previous) => {
      if (previous.latestWidgetIdByType[selectedWidget.type] === selectedWidgetId) {
        return previous;
      }
      return {
        ...previous,
        latestWidgetIdByType: {
          ...previous.latestWidgetIdByType,
          [selectedWidget.type]: selectedWidgetId,
        },
      };
    });
  });

  createEffect(() => {
    env.workbenchOverviewEntrySeq();
    const request = env.workbenchOverviewEntry();
    const requestId = compact(request?.requestId);
    const api = surfaceApi();
    if (!requestId || !request || !api || !runtimeLayoutReady()) {
      return;
    }

    api.enterOverview();
    env.consumeWorkbenchOverviewEntry(requestId);
  });

  createEffect(() => {
    const host = introSurfaceHost();
    if (!host) {
      setWorkbenchHudMount(null);
      return;
    }

    const syncHudMount = () => {
      const nextMount = host.querySelector('.workbench-hud');
      setWorkbenchHudMount(nextMount instanceof HTMLDivElement ? nextMount : null);
    };

    syncHudMount();
    if (typeof MutationObserver !== 'function') {
      return;
    }

    const observer = new MutationObserver(() => syncHudMount());
    observer.observe(host, { childList: true, subtree: true });
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const host = introSurfaceHost();
    const api = surfaceApi();
    const ready = runtimeLayoutReady();
    const overlayVisible = env.connectionOverlayVisible();
    if (!host || !api || !ready || overlayVisible || introDecisionMade()) {
      return;
    }

    setIntroDecisionMade(true);
    if (workbenchState().widgets.length === 0) {
      setIntroPreparing(false);
      return;
    }

    setIntroPreparing(true);
    introStartFrame = window.requestAnimationFrame(() => {
      introStartFrame = undefined;
      introStartSettleFrame = window.requestAnimationFrame(() => {
        introStartSettleFrame = undefined;
        setIntroVisible(true);
        setIntroSequence((value) => value + 1);
      });
    });
  });

  createEffect(() => {
    env.workbenchSurfaceActivationSeq();
    const request = env.workbenchSurfaceActivation();
    const requestId = String(request?.requestId ?? '').trim();
    const api = surfaceApi();
    if (!requestId || !request || !api) {
      return;
    }
    env.consumeWorkbenchSurfaceActivation(requestId);

    const widgetType = envWidgetTypeForSurface(request.surfaceId);
    const centerViewport = request.centerViewport ?? request.ensureVisible ?? true;
    let widget = null;

    if (isRedevenWorkbenchMultiInstanceWidgetType(widgetType)) {
      const normalizedRequestedWidgetId = compact(request.widgetId);
      const openStrategy = request.openStrategy ?? 'focus_latest_or_create';
      const latestWidgetId = instanceState().latestWidgetIdByType[widgetType] ?? null;
      const preferredWidget = normalizedRequestedWidgetId
        ? api.findWidgetById(normalizedRequestedWidgetId)
        : null;

      if (preferredWidget && preferredWidget.type === widgetType) {
        widget = preferredWidget;
      } else if (openStrategy === 'create_new') {
        widget = api.createWidget(widgetType, { centerViewport });
      } else {
        const latestWidget = latestWidgetId ? api.findWidgetById(latestWidgetId) : null;
        widget = latestWidget?.type === widgetType
          ? latestWidget
          : pickLatestWorkbenchWidget(workbenchState().widgets, widgetType, normalizedRequestedWidgetId);

        if (!widget) {
          widget = api.createWidget(widgetType, { centerViewport });
        }
      }
    } else {
      widget = api.ensureWidget(
        widgetType,
        {
          centerViewport,
        },
      );
    }

    if (widget && request.focus !== false) {
      api.focusWidget(widget, { centerViewport });
    }

    if (widget) {
      setInstanceState((previous) => ({
        ...previous,
        latestWidgetIdByType: {
          ...previous.latestWidgetIdByType,
          [widget.type]: widget.id,
        },
      }));
    }

    if (widget?.type === 'redeven.terminal') {
      const workingDir = normalizeAbsolutePath(request.terminalPayload?.workingDir ?? '');
      if (workingDir) {
        setTerminalOpenRequests((previous) => ({
          ...previous,
          [widget.id]: {
            requestId,
            widgetId: widget.id,
            workingDir,
            preferredName: compact(request.terminalPayload?.preferredName) || undefined,
          },
        }));
      }
    }

    if (widget?.type === 'redeven.files') {
      const path = normalizeAbsolutePath(request.fileBrowserPayload?.path ?? '');
      if (path) {
        const homePath = normalizeAbsolutePath(request.fileBrowserPayload?.homePath ?? '');
        setFileBrowserOpenRequests((previous) => ({
          ...previous,
          [widget.id]: {
            requestId,
            widgetId: widget.id,
            path,
            homePath: homePath || undefined,
            title: compact(request.fileBrowserPayload?.title) || undefined,
          },
        }));
      }
    }
  });

  createEffect(() => {
    env.workbenchFilePreviewActivationSeq();
    const request = env.workbenchFilePreviewActivation();
    const requestId = compact(request?.requestId);
    const api = surfaceApi();
    if (!requestId || !request || !api) {
      return;
    }
    env.consumeWorkbenchFilePreviewActivation(requestId);

    const previewPath = normalizeAbsolutePath(request.item?.path ?? '');
    if (!previewPath) {
      return;
    }

    const centerViewport = request.centerViewport ?? request.ensureVisible ?? true;
    const openStrategy = request.openStrategy ?? 'focus_latest_or_create';
    const normalizedItem: FileItem = {
      ...request.item,
      id: compact(request.item?.id) || previewPath,
      type: 'file',
      path: previewPath,
      name: compact(request.item?.name) || basenameFromAbsolutePath(previewPath) || 'File',
    };

    let widget = null;
    if (openStrategy !== 'create_new') {
      const matchingWidgetId = findWorkbenchPreviewWidgetIdByPath(
        workbenchState().widgets,
        knownPreviewItemsByWidgetId(),
        previewPath,
      );
      const matchingWidget = matchingWidgetId ? api.findWidgetById(matchingWidgetId) : null;
      if (matchingWidget?.type === 'redeven.preview') {
        widget = matchingWidget;
      }
    }

    if (!widget) {
      const latestWidgetId = instanceState().latestWidgetIdByType['redeven.preview'] ?? null;
      if (openStrategy !== 'create_new') {
        const latestWidget = latestWidgetId ? api.findWidgetById(latestWidgetId) : null;
        widget = latestWidget?.type === 'redeven.preview'
          ? latestWidget
          : pickLatestWorkbenchWidget(workbenchState().widgets, 'redeven.preview') ?? api.findWidgetByType('redeven.preview');
      }
      if (!widget) {
        widget = api.createWidget('redeven.preview', { centerViewport });
      }
    }

    if (!widget) {
      return;
    }

    if (request.focus !== false) {
      api.focusWidget(widget, { centerViewport });
    }

    setInstanceState((previous) => ({
      ...previous,
      latestWidgetIdByType: {
        ...previous.latestWidgetIdByType,
        [widget.type]: widget.id,
      },
      previewItemsByWidgetId: {
        ...previous.previewItemsByWidgetId,
        [widget.id]: normalizedItem,
      },
    }));
    updateWidgetTitle(widget.id, buildWorkbenchFilePreviewTitle(normalizedItem));
    setPreviewOpenRequests((previous) => ({
      ...previous,
      [widget.id]: {
        requestId,
        widgetId: widget.id,
        item: normalizedItem,
      },
    }));
  });

  const updateWidgetTitle = (widgetId: string, title: string) => {
    const normalizedWidgetId = compact(widgetId);
    const normalizedTitle = compact(title);
    if (!normalizedWidgetId || !normalizedTitle) {
      return;
    }

    const api = surfaceApi();
    if (api) {
      api.updateWidgetTitle(normalizedWidgetId, normalizedTitle);
      return;
    }

    setWorkbenchState((previous) => ({
      ...previous,
      widgets: previous.widgets.map((widget) =>
        widget.id === normalizedWidgetId && widget.title !== normalizedTitle
          ? { ...widget, title: normalizedTitle }
          : widget
      ),
    }));
  };

  const removeWidget = (widgetId: string) => {
    const normalizedWidgetId = compact(widgetId);
    if (!normalizedWidgetId) {
      return;
    }
    setWorkbenchState((previous) => ({
      ...previous,
      widgets: previous.widgets.filter((widget) => widget.id !== normalizedWidgetId),
      selectedWidgetId: previous.selectedWidgetId === normalizedWidgetId ? null : previous.selectedWidgetId,
    }));
  };

  const requestWidgetRemoval = (widgetId: string) => {
    const normalizedWidgetId = compact(widgetId);
    if (!normalizedWidgetId) {
      return;
    }
    const guard = widgetRemoveGuards()[normalizedWidgetId];
    if (guard && !guard()) {
      return;
    }
    removeWidget(normalizedWidgetId);
  };

  const runtimeWidgetExists = (widgetId: string, widgetType?: string): boolean => {
    const normalizedWidgetId = compact(widgetId);
    if (!normalizedWidgetId) {
      return false;
    }
    return runtimeSnapshot().widgets.some((widget) => (
      widget.widget_id === normalizedWidgetId
      && (!widgetType || widget.widget_type === widgetType)
    ));
  };

  const runtimeTerminalSessionIds = (widgetId: string): string[] => {
    const state = runtimeWidgetStateById()[widgetId];
    if (state?.widget_type !== 'redeven.terminal' || state.state.kind !== 'terminal') {
      return [];
    }
    return state.state.session_ids;
  };

  const persistLocalTerminalPanelState = (
    widgetId: string,
    sessionIds: readonly string[],
    activeSessionId: string | null,
  ) => {
    const normalizedWidgetId = compact(widgetId);
    if (!normalizedWidgetId) {
      return;
    }
    const uniqueSessionIds = Array.from(new Set(sessionIds.map((sessionId) => compact(sessionId)).filter(Boolean)));
    const normalizedActiveSessionId = compact(activeSessionId);
    const nextState: RedevenWorkbenchTerminalPanelState = {
      sessionIds: uniqueSessionIds,
      activeSessionId: normalizedActiveSessionId && uniqueSessionIds.includes(normalizedActiveSessionId)
        ? normalizedActiveSessionId
        : uniqueSessionIds[0] ?? null,
    };
    setInstanceState((previous) => {
      const current = previous.terminalPanelsByWidgetId[normalizedWidgetId] ?? EMPTY_TERMINAL_PANEL_STATE;
      if (sameTerminalPanelState(current, nextState)) {
        return previous;
      }
      return {
        ...previous,
        terminalPanelsByWidgetId: {
          ...previous.terminalPanelsByWidgetId,
          [normalizedWidgetId]: nextState,
        },
      };
    });
  };

  const workbenchInstancesContextValue: EnvWorkbenchInstancesContextValue = {
    latestWidgetIdByType: createMemo(() => instanceState().latestWidgetIdByType),
    markLatestWidget: (type, widgetId) => {
      const normalizedWidgetId = compact(widgetId);
      if (!normalizedWidgetId) {
        return;
      }
      setInstanceState((previous) => {
        if (previous.latestWidgetIdByType[type] === normalizedWidgetId) {
          return previous;
        }
        return {
          ...previous,
          latestWidgetIdByType: {
            ...previous.latestWidgetIdByType,
            [type]: normalizedWidgetId,
          },
        };
      });
    },
    terminalPanelState: (widgetId) => {
      const normalizedWidgetId = compact(widgetId);
      if (!normalizedWidgetId) {
        return EMPTY_TERMINAL_PANEL_STATE;
      }
      const sessionIds = runtimeTerminalSessionIds(normalizedWidgetId);
      const local = instanceState().terminalPanelsByWidgetId[normalizedWidgetId] ?? EMPTY_TERMINAL_PANEL_STATE;
      const activeSessionId = local.activeSessionId && sessionIds.includes(local.activeSessionId)
        ? local.activeSessionId
        : sessionIds[0] ?? null;
      return {
        sessionIds,
        activeSessionId,
      };
    },
    updateTerminalPanelState: (widgetId, updater) => {
      const normalizedWidgetId = compact(widgetId);
      if (!normalizedWidgetId) {
        return;
      }
      const sharedSessionIds = runtimeTerminalSessionIds(normalizedWidgetId);
      const current = {
        sessionIds: sharedSessionIds,
        activeSessionId: instanceState().terminalPanelsByWidgetId[normalizedWidgetId]?.activeSessionId ?? null,
      };
      const next = updater(current);
      persistLocalTerminalPanelState(normalizedWidgetId, sharedSessionIds, next.activeSessionId);
    },
    createTerminalSession: async (widgetId, name, workingDir) => {
      const normalizedWidgetId = compact(widgetId);
      if (!normalizedWidgetId || !runtimeWidgetExists(normalizedWidgetId, 'redeven.terminal')) {
        return null;
      }
      try {
        const result = await createWorkbenchTerminalSession(normalizedWidgetId, {
          name: compact(name) || undefined,
          working_dir: normalizeAbsolutePath(workingDir) || undefined,
        });
        applyRuntimeWidgetState(result.widget_state);
        const sessionId = compact(result.session.id);
        const nextSessionIds = result.widget_state.state.kind === 'terminal'
          ? result.widget_state.state.session_ids
          : runtimeTerminalSessionIds(normalizedWidgetId);
        if (sessionId) {
          persistLocalTerminalPanelState(normalizedWidgetId, nextSessionIds, sessionId);
        }
        return sessionId || null;
      } catch (error) {
        console.warn('Failed to create workbench terminal session:', error);
        return null;
      }
    },
    deleteTerminalSession: async (widgetId, sessionId) => {
      const normalizedWidgetId = compact(widgetId);
      const normalizedSessionId = compact(sessionId);
      if (!normalizedWidgetId || !normalizedSessionId || !runtimeWidgetExists(normalizedWidgetId, 'redeven.terminal')) {
        return;
      }
      try {
        const state = await deleteWorkbenchTerminalSession(normalizedWidgetId, normalizedSessionId);
        applyRuntimeWidgetState(state);
        const nextSessionIds = state.state.kind === 'terminal' ? state.state.session_ids : [];
        const currentActiveSessionId = instanceState().terminalPanelsByWidgetId[normalizedWidgetId]?.activeSessionId ?? null;
        persistLocalTerminalPanelState(
          normalizedWidgetId,
          nextSessionIds,
          currentActiveSessionId === normalizedSessionId ? null : currentActiveSessionId,
        );
      } catch (error) {
        console.warn('Failed to delete workbench terminal session:', error);
      }
    },
    terminalOpenRequest: (widgetId) => terminalOpenRequests()[compact(widgetId)] ?? null,
    dispatchTerminalOpenRequest: (request) => {
      setTerminalOpenRequests((previous) => ({
        ...previous,
        [request.widgetId]: request,
      }));
    },
    consumeTerminalOpenRequest: (requestId) => {
      const normalizedRequestId = compact(requestId);
      if (!normalizedRequestId) {
        return;
      }
      setTerminalOpenRequests((previous) => {
        let changed = false;
        const next: Record<string, WorkbenchOpenTerminalRequest> = {};
        for (const [widgetId, request] of Object.entries(previous)) {
          if (request.requestId === normalizedRequestId) {
            changed = true;
            continue;
          }
          next[widgetId] = request;
        }
        return changed ? next : previous;
      });
    },
    fileBrowserOpenRequest: (widgetId) => fileBrowserOpenRequests()[compact(widgetId)] ?? null,
    dispatchFileBrowserOpenRequest: (request) => {
      setFileBrowserOpenRequests((previous) => ({
        ...previous,
        [request.widgetId]: request,
      }));
    },
    consumeFileBrowserOpenRequest: (requestId) => {
      const normalizedRequestId = compact(requestId);
      if (!normalizedRequestId) {
        return;
      }
      setFileBrowserOpenRequests((previous) => {
        let changed = false;
        const next: Record<string, WorkbenchOpenFileBrowserRequest> = {};
        for (const [widgetId, request] of Object.entries(previous)) {
          if (request.requestId === normalizedRequestId) {
            changed = true;
            continue;
          }
          next[widgetId] = request;
        }
        return changed ? next : previous;
      });
    },
    updateFileBrowserPath: (widgetId, path) => {
      const normalizedWidgetId = compact(widgetId);
      const normalizedPath = normalizeAbsolutePath(path);
      if (!normalizedWidgetId || !normalizedPath) {
        return;
      }
      setFileBrowserCommittedPaths((previous) => (
        previous[normalizedWidgetId] === normalizedPath
          ? previous
          : { ...previous, [normalizedWidgetId]: normalizedPath }
      ));
      updateWidgetTitle(normalizedWidgetId, buildWorkbenchFileBrowserTitle({ path: normalizedPath }));
      if (!runtimeLayoutReady() || !runtimeWidgetExists(normalizedWidgetId, 'redeven.files')) {
        return;
      }
      void putSharedWidgetState(normalizedWidgetId, 'redeven.files', {
        kind: 'files',
        current_path: normalizedPath,
      });
    },
    previewItem: (widgetId) => {
      const normalizedWidgetId = compact(widgetId);
      if (!normalizedWidgetId) {
        return null;
      }
      return runtimePreviewItemsByWidgetId()[normalizedWidgetId] ?? null;
    },
    pendingSyncedPreviewItem: (widgetId) => pendingSyncedPreviewItems()[compact(widgetId)] ?? null,
    setPendingSyncedPreviewItem: (widgetId, item) => {
      const normalizedWidgetId = compact(widgetId);
      if (!normalizedWidgetId) {
        return;
      }
      setPendingSyncedPreviewItems((previous) => {
        const next = { ...previous };
        if (item) {
          next[normalizedWidgetId] = item;
        } else {
          delete next[normalizedWidgetId];
        }
        return next;
      });
    },
    updatePreviewItem: (widgetId, item) => {
      const normalizedWidgetId = compact(widgetId);
      if (!normalizedWidgetId) {
        return;
      }
      setInstanceState((previous) => {
        const current = previous.previewItemsByWidgetId[normalizedWidgetId] ?? null;
        if (samePreviewItem(current, item)) {
          return previous;
        }
        const nextPreviewItemsByWidgetId = { ...previous.previewItemsByWidgetId };
        if (item) {
          nextPreviewItemsByWidgetId[normalizedWidgetId] = item;
        } else {
          delete nextPreviewItemsByWidgetId[normalizedWidgetId];
        }
        return {
          ...previous,
          previewItemsByWidgetId: nextPreviewItemsByWidgetId,
        };
      });
      if (item) {
        updateWidgetTitle(normalizedWidgetId, buildWorkbenchFilePreviewTitle(item));
      } else {
        updateWidgetTitle(normalizedWidgetId, 'Preview');
      }
      if (!runtimeLayoutReady() || !runtimeWidgetExists(normalizedWidgetId, 'redeven.preview')) {
        return;
      }
      const previewItem: RuntimeWorkbenchPreviewItem | null = item
        ? {
          id: compact(item.id) || item.path,
          type: 'file',
          path: item.path,
          name: compact(item.name) || basenameFromAbsolutePath(item.path) || 'File',
          ...(typeof item.size === 'number' ? { size: item.size } : {}),
        }
        : null;
      void putSharedWidgetState(normalizedWidgetId, 'redeven.preview', {
        kind: 'preview',
        item: previewItem,
      });
    },
    previewOpenRequest: (widgetId) => previewOpenRequests()[compact(widgetId)] ?? null,
    dispatchPreviewOpenRequest: (request) => {
      setPreviewOpenRequests((previous) => ({
        ...previous,
        [request.widgetId]: request,
      }));
    },
    consumePreviewOpenRequest: (requestId) => {
      const normalizedRequestId = compact(requestId);
      if (!normalizedRequestId) {
        return;
      }
      setPreviewOpenRequests((previous) => {
        let changed = false;
        const next: Record<string, WorkbenchOpenFilePreviewRequest> = {};
        for (const [widgetId, request] of Object.entries(previous)) {
          if (request.requestId === normalizedRequestId) {
            changed = true;
            continue;
          }
          next[widgetId] = request;
        }
        return changed ? next : previous;
      });
    },
    registerWidgetRemoveGuard: (widgetId, guard) => {
      const normalizedWidgetId = compact(widgetId);
      if (!normalizedWidgetId) {
        return;
      }
      setWidgetRemoveGuards((previous) => {
        const next = { ...previous };
        if (guard) {
          next[normalizedWidgetId] = guard;
        } else {
          delete next[normalizedWidgetId];
        }
        return next;
      });
    },
    removeWidget,
    requestWidgetRemoval,
    updateWidgetTitle,
  } as const;

  onCleanup(() => {
    if (introStartFrame !== undefined) {
      window.cancelAnimationFrame(introStartFrame);
    }
    if (introStartSettleFrame !== undefined) {
      window.cancelAnimationFrame(introStartSettleFrame);
    }
  });

  return (
    <EnvWorkbenchInstancesContext.Provider value={workbenchInstancesContextValue}>
      <div class="relative h-full min-h-0 overflow-hidden">
        <div
          ref={setIntroSurfaceHost}
          class={`h-full min-h-0${introPreparing() ? ' redeven-workbench-intro-preparing' : ''}`}
        >
          <RedevenWorkbenchSurface
            state={workbenchState}
            setState={setSurfaceWorkbenchState}
            widgetDefinitions={redevenWorkbenchWidgets}
            filterBarWidgetTypes={redevenWorkbenchFilterBarWidgetTypes}
            onApiReady={setSurfaceApi}
            onRequestDelete={requestWidgetRemoval}
            onLayoutInteractionStart={() => {
              setActiveLayoutInteractions((count) => count + 1);
            }}
            onLayoutInteractionEnd={() => {
              setActiveLayoutInteractions((count) => Math.max(0, count - 1));
            }}
          />
        </div>
        <RedevenWorkbenchHudActions
          mount={workbenchHudMount}
          selectedWidget={selectedWidget}
          onMinimizeCanvasScale={minimizeCanvasScale}
          onFitSelectedWidget={fitSelectedWidgetToViewport}
        />
        {introVisible() ? (
          <WorkbenchEntryIntro
            state={workbenchState}
            frameSize={() => ({ width: 0, height: 0 })}
            surfaceHost={introSurfaceHost}
            sequence={introSequence}
            onStart={() => setIntroPreparing(false)}
            onComplete={() => {
              setIntroPreparing(false);
              setIntroVisible(false);
            }}
          />
        ) : null}
        <LoadingOverlay
          visible={!runtimeLayoutReady() || env.connectionOverlayVisible()}
          message={!runtimeLayoutReady() ? 'Loading workbench…' : env.connectionOverlayMessage()}
        />
      </div>
    </EnvWorkbenchInstancesContext.Provider>
  );
}
