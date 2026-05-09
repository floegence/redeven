import {
  createDefaultWorkbenchState,
  sanitizeWorkbenchState,
  type WorkbenchContextMenuItem,
  type WorkbenchState,
} from '@floegence/floe-webapp-core/workbench';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { TerminalSessionInfo } from '@floegence/floeterm-terminal-web';
import { LayoutDashboard, Maximize, Minus } from '@floegence/floe-webapp-core/icons';
import { batch, createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';
import { Portal } from 'solid-js/web';

import { basenameFromAbsolutePath, normalizeAbsolutePath } from '../utils/askFlowerPath';
import { envWidgetTypeForSurface, type EnvWorkbenchHandoffAnchor } from '../envViewMode';
import { useEnvContext } from '../pages/EnvContext';
import { isDesktopStateStorageAvailable, readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';
import { resolveEnvAppStorageBinding } from '../services/uiPersistence';
import {
  DEFAULT_TERMINAL_FONT_FAMILY_ID,
  DEFAULT_TERMINAL_FONT_SIZE,
  normalizeTerminalFontFamilyId,
  normalizeTerminalFontSize,
} from '../services/terminalGeometry';
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
import {
  RedevenWorkbenchSurface,
  type RedevenWorkbenchContextMenuItemsResolver,
  type RedevenWorkbenchSurfaceApi,
} from './surface/RedevenWorkbenchSurface';
import { redevenWorkbenchFilterBarWidgetTypes, redevenWorkbenchWidgets } from './redevenWorkbenchWidgets';
import { arrangeWorkbenchWidgetsByType } from './workbenchAutoArrange';
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
  type RedevenWorkbenchTerminalGeometryPreferences,
  type RedevenWorkbenchTerminalPanelState,
  type WorkbenchOpenFileBrowserRequest,
  type WorkbenchOpenFilePreviewRequest,
  type WorkbenchOpenTerminalRequest,
} from './workbenchInstanceState';
import {
  recordWorkbenchFocus,
  resolveWorkbenchFocusFallback,
} from './workbenchFocusHistory';
import {
  createWorkbenchTerminalVisualCoordinator,
  type WorkbenchTerminalInteractionKind,
} from './workbenchTerminalVisualCoordinator';
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
  type RuntimeWorkbenchTerminalSessionInfo,
  type RuntimeWorkbenchWidgetState,
  type RuntimeWorkbenchWidgetStateData,
} from './runtimeWorkbenchLayout';
import {
  normalizeWorkbenchTheme,
  readLegacyWorkbenchThemeMigration,
  removeLegacyWorkbenchAppearance,
} from './workbenchThemeMigration';
import {
  WorkbenchProgressCurtain,
  type WorkbenchProgressCurtainStage,
} from './WorkbenchProgressCurtain';

const WORKBENCH_PERSIST_DELAY_MS = 120;
const WORKBENCH_LAYOUT_FLUSH_DELAY_MS = 160;
const WORKBENCH_LAYOUT_FAST_FLUSH_DELAY_MS = 16;
const WORKBENCH_LAYOUT_RECONNECT_DELAY_MS = 900;
const WORKBENCH_LAYOUT_VISUAL_SETTLE_MS = 90;
const WORKBENCH_WIDGET_CLOSE_DEFER_MS = 48;
const WORKBENCH_MIN_SCALE_EPSILON = 0.0001;
const WORKBENCH_SCALE_ANIMATION_DURATION_MS = 180;
const WORKBENCH_HUD_SHORTCUT_GROUP_CLASS = 'redeven-workbench-hud-shortcuts ml-1 flex h-7 items-center gap-1 border-l border-border/50 pl-2';
const WORKBENCH_HUD_SHORTCUT_BUTTON_BASE_CLASS = 'redeven-workbench-hud-shortcut border shadow-sm';
const WORKBENCH_HUD_MINIMIZE_BUTTON_CLASS = `${WORKBENCH_HUD_SHORTCUT_BUTTON_BASE_CLASS} border-warning/30 bg-warning/10 text-warning hover:border-warning/50 hover:bg-warning/20 hover:text-warning`;
const WORKBENCH_HUD_MAXIMIZE_BUTTON_CLASS = `${WORKBENCH_HUD_SHORTCUT_BUTTON_BASE_CLASS} border-success/30 bg-success/10 text-success hover:border-success/50 hover:bg-success/20 hover:text-success`;
const EMPTY_TERMINAL_PANEL_STATE: RedevenWorkbenchTerminalPanelState = {
  sessionIds: [],
  activeSessionId: null,
};
const DEFAULT_TERMINAL_GEOMETRY_PREFERENCES: RedevenWorkbenchTerminalGeometryPreferences = {
  fontSize: DEFAULT_TERMINAL_FONT_SIZE,
  fontFamilyId: DEFAULT_TERMINAL_FONT_FAMILY_ID,
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeRuntimeTerminalTimestamp(value: unknown): number {
  const timestamp = Number(value ?? 0);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.trunc(timestamp) : 0;
}

function normalizeRuntimeTerminalSessionInfo(session: RuntimeWorkbenchTerminalSessionInfo): TerminalSessionInfo | null {
  const id = compact(session.id);
  if (!id) return null;
  return {
    id,
    name: compact(session.name),
    workingDir: normalizeAbsolutePath(session.working_dir),
    createdAtMs: normalizeRuntimeTerminalTimestamp(session.created_at_ms),
    lastActiveAtMs: normalizeRuntimeTerminalTimestamp(session.last_active_at_ms),
    isActive: Boolean(session.is_active),
  };
}

function scaleAtMinimum(scale: number): boolean {
  return Math.abs(scale - REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE) <= WORKBENCH_MIN_SCALE_EPSILON;
}

function workbenchViewportChanged(
  previous: WorkbenchState['viewport'],
  next: WorkbenchState['viewport'],
): boolean {
  return Math.abs(Number(previous.x) - Number(next.x)) > WORKBENCH_MIN_SCALE_EPSILON
    || Math.abs(Number(previous.y) - Number(next.y)) > WORKBENCH_MIN_SCALE_EPSILON
    || Math.abs(Number(previous.scale) - Number(next.scale)) > WORKBENCH_MIN_SCALE_EPSILON;
}

function viewportForCenteredScale(
  viewport: WorkbenchState['viewport'],
  targetScale: number,
  frameSize: Readonly<{ width: number; height: number }>,
): WorkbenchState['viewport'] {
  const frameWidth = Number(frameSize.width);
  const frameHeight = Number(frameSize.height);
  const currentScale = Number(viewport.scale);
  if (!Number.isFinite(frameWidth) || frameWidth <= 0 || !Number.isFinite(frameHeight) || frameHeight <= 0 || !Number.isFinite(currentScale) || Math.abs(currentScale) <= WORKBENCH_MIN_SCALE_EPSILON) {
    return {
      ...viewport,
      scale: targetScale,
    };
  }

  const frameCenterX = frameWidth / 2;
  const frameCenterY = frameHeight / 2;
  const centerWorldX = (frameCenterX - Number(viewport.x)) / currentScale;
  const centerWorldY = (frameCenterY - Number(viewport.y)) / currentScale;
  return {
    x: frameCenterX - centerWorldX * targetScale,
    y: frameCenterY - centerWorldY * targetScale,
    scale: targetScale,
  };
}

function resolveViewportWorldCenter(
  viewport: WorkbenchState['viewport'],
  frameSize: Readonly<{ width: number; height: number }>,
): { x: number; y: number } | null {
  const frameWidth = Number(frameSize.width);
  const frameHeight = Number(frameSize.height);
  const scale = Number(viewport.scale);
  if (!Number.isFinite(frameWidth) || frameWidth <= 0 || !Number.isFinite(frameHeight) || frameHeight <= 0 || !Number.isFinite(scale) || Math.abs(scale) <= WORKBENCH_MIN_SCALE_EPSILON) {
    return null;
  }
  return {
    x: (frameWidth / 2 - Number(viewport.x)) / scale,
    y: (frameHeight / 2 - Number(viewport.y)) / scale,
  };
}

function easeOutCubic(progress: number): number {
  const clamped = Math.min(1, Math.max(0, progress));
  return 1 - ((1 - clamped) ** 3);
}

function eventTargetUsesTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false;
  }
  const interactiveTextTarget = target.closest('textarea, [contenteditable], [role="textbox"]');
  if (interactiveTextTarget) {
    return true;
  }
  const input = target.closest('input, select');
  if (!(input instanceof HTMLInputElement || input instanceof HTMLSelectElement)) {
    return false;
  }
  if (input instanceof HTMLSelectElement) {
    return true;
  }
  const nonTextInputTypes = new Set([
    'button',
    'checkbox',
    'color',
    'file',
    'hidden',
    'image',
    'radio',
    'range',
    'reset',
    'submit',
  ]);
  return !nonTextInputTypes.has(String(input.type || '').toLowerCase());
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
          <div class={WORKBENCH_HUD_SHORTCUT_GROUP_CLASS}>
            <button
              type="button"
              class={`workbench-hud__button ${WORKBENCH_HUD_MINIMIZE_BUTTON_CLASS}`}
              aria-label="Scale canvas to minimum"
              title="Scale canvas to minimum"
              data-floe-canvas-interactive="true"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => props.onMinimizeCanvasScale()}
            >
              <Minus class="w-3.5 h-3.5" />
            </button>
            <Show when={props.selectedWidget()}>
              <button
                type="button"
                class={`workbench-hud__button ${WORKBENCH_HUD_MAXIMIZE_BUTTON_CLASS}`}
                aria-label="Fit selected widget to viewport"
                title="Fit selected widget to viewport"
                data-floe-canvas-interactive="true"
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => props.onFitSelectedWidget()}
              >
                <Maximize class="w-3.5 h-3.5" />
              </button>
            </Show>
          </div>
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

function escapeWorkbenchWidgetIdSelectorValue(value: string): string {
  const escape = globalThis.CSS?.escape;
  return typeof escape === 'function' ? escape(value) : value.replace(/["\\]/g, '\\$&');
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

function normalizeWorkbenchTerminalGeometryPreferences(
  value: Partial<RedevenWorkbenchTerminalGeometryPreferences> | null | undefined,
): RedevenWorkbenchTerminalGeometryPreferences {
  return {
    fontSize: normalizeTerminalFontSize(value?.fontSize),
    fontFamilyId: normalizeTerminalFontFamilyId(value?.fontFamilyId),
  };
}

function sameTerminalGeometryPreferences(
  left: RedevenWorkbenchTerminalGeometryPreferences,
  right: RedevenWorkbenchTerminalGeometryPreferences,
): boolean {
  return left.fontSize === right.fontSize && left.fontFamilyId === right.fontFamilyId;
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

function sameWidgetPlacement(
  left: readonly WorkbenchState['widgets'][number][],
  right: readonly WorkbenchState['widgets'][number][],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((widget, index) => {
    const other = right[index];
    return widget.id === other.id
      && widget.x === other.x
      && widget.y === other.y
      && widget.width === other.width
      && widget.height === other.height;
  });
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

function filterStringSetByWidgetIds(values: ReadonlySet<string>, widgetIds: ReadonlySet<string>): ReadonlySet<string> {
  let changed = false;
  const next = new Set<string>();
  for (const value of values) {
    if (!widgetIds.has(value)) {
      changed = true;
      continue;
    }
    next.add(value);
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
  const [layoutInteractionVisualActive, setLayoutInteractionVisualActive] = createSignal(false);
  const [pendingRemoteSnapshot, setPendingRemoteSnapshot] = createSignal<RuntimeWorkbenchLayoutSnapshot | null>(null);
  const [fileBrowserCommittedPaths, setFileBrowserCommittedPaths] = createSignal<Record<string, string>>({});
  const [appliedRemoteFileStateRevisions, setAppliedRemoteFileStateRevisions] = createSignal<Record<string, number>>({});
  const [pendingSyncedPreviewItems, setPendingSyncedPreviewItems] = createSignal<Record<string, RuntimeWorkbenchPreviewItem>>({});
  const [surfaceApi, setSurfaceApi] = createSignal<RedevenWorkbenchSurfaceApi | null>(null);
  const [terminalOpenRequests, setTerminalOpenRequests] = createSignal<Record<string, WorkbenchOpenTerminalRequest>>({});
  const [pendingTerminalOpenRequests, setPendingTerminalOpenRequests] = createSignal<Record<string, WorkbenchOpenTerminalRequest>>({});
  const [confirmedRuntimeTerminalWidgetIds, setConfirmedRuntimeTerminalWidgetIds] = createSignal<ReadonlySet<string>>(new Set());
  const [fileBrowserOpenRequests, setFileBrowserOpenRequests] = createSignal<Record<string, WorkbenchOpenFileBrowserRequest>>({});
  const [previewOpenRequests, setPreviewOpenRequests] = createSignal<Record<string, WorkbenchOpenFilePreviewRequest>>({});
  const [focusHistory, setFocusHistory] = createSignal<string[]>([]);
  const [widgetRemoveGuards, setWidgetRemoveGuards] = createSignal<Record<string, () => boolean>>({});
  const [localOwnerHandoffActive, setLocalOwnerHandoffActive] = createSignal(false);
  const [surfaceHost, setSurfaceHost] = createSignal<HTMLDivElement>();
  const [workbenchHudMount, setWorkbenchHudMount] = createSignal<HTMLDivElement | null>(null);
  let localOwnerHandoffToken = 0;
  let canvasScaleAnimationFrame: number | undefined;
  let canvasScaleAnimationToken = 0;
  let layoutInteractionVisualSettleTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  const pendingWidgetRemovalTimers = new Map<string, {
    releaseInteraction: () => void;
    timer: ReturnType<typeof globalThis.setTimeout>;
  }>();
  const terminalVisualCoordinator = createWorkbenchTerminalVisualCoordinator();
  const surfaceLayoutInteractionReleases: Array<() => void> = [];
  let surfaceViewportInteractionRelease: (() => void) | null = null;

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
  const workbenchCurtainStage = createMemo<WorkbenchProgressCurtainStage>(() => {
    if (env.connectionOverlayVisible()) {
      return 'connecting';
    }
    if (!runtimeLayoutReady()) {
      return 'layout';
    }
    if (!surfaceApi()) {
      return 'canvas';
    }
    return 'ready';
  });
  const workbenchCurtainVisible = createMemo(() => (
    env.connectionOverlayVisible()
    || !runtimeLayoutReady()
    || !surfaceApi()
  ));
  const workbenchCurtainMessage = createMemo(() => (
    env.connectionOverlayVisible() ? env.connectionOverlayMessage() : undefined
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

  createEffect(() => {
    terminalVisualCoordinator.setSelectedWidgetId(workbenchState().selectedWidgetId);
  });

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

  const confirmRuntimeTerminalWidgets = (snapshot: RuntimeWorkbenchLayoutSnapshot) => {
    const terminalWidgetIds = snapshot.widgets
      .filter((widget) => widget.widget_type === 'redeven.terminal')
      .map((widget) => compact(widget.widget_id))
      .filter(Boolean);
    if (terminalWidgetIds.length === 0) {
      return;
    }
    setConfirmedRuntimeTerminalWidgetIds((previous) => {
      let changed = false;
      const next = new Set(previous);
      for (const widgetId of terminalWidgetIds) {
        if (!next.has(widgetId)) {
          changed = true;
          next.add(widgetId);
        }
      }
      return changed ? next : previous;
    });
  };

  const runtimeTerminalWidgetReady = (widgetId: string): boolean => {
    const normalizedWidgetId = compact(widgetId);
    return Boolean(
      normalizedWidgetId
      && (
        runtimeWidgetExists(normalizedWidgetId, 'redeven.terminal')
        || confirmedRuntimeTerminalWidgetIds().has(normalizedWidgetId)
      ),
    );
  };

  const queueTerminalOpenRequest = (request: WorkbenchOpenTerminalRequest) => {
    const normalizedWidgetId = compact(request.widgetId);
    const workingDir = normalizeAbsolutePath(request.workingDir);
    if (!normalizedWidgetId || !workingDir) {
      return;
    }
    const normalizedRequest: WorkbenchOpenTerminalRequest = {
      ...request,
      widgetId: normalizedWidgetId,
      workingDir,
      preferredName: compact(request.preferredName) || undefined,
    };
    if (runtimeTerminalWidgetReady(normalizedWidgetId)) {
      setTerminalOpenRequests((previous) => ({
        ...previous,
        [normalizedWidgetId]: normalizedRequest,
      }));
      return;
    }
    setPendingTerminalOpenRequests((previous) => ({
      ...previous,
      [normalizedWidgetId]: normalizedRequest,
    }));
  };

  const resolveCanvasFrameSize = (): { width: number; height: number } => {
    const host = surfaceHost();
    const frame = host?.querySelector('[data-floe-workbench-canvas-frame="true"]') as HTMLElement | null;
    const rect = frame?.getBoundingClientRect();
    const hostRect = host?.getBoundingClientRect();
    const width = rect?.width ?? hostRect?.width ?? 0;
    const height = rect?.height ?? hostRect?.height ?? 0;
    return {
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
    };
  };

  const resolveWorkbenchAnchorWorldPoint = (
    anchor?: EnvWorkbenchHandoffAnchor,
  ): { worldX: number; worldY: number } | null => {
    const clientX = Number(anchor?.clientX);
    const clientY = Number(anchor?.clientY);
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
      return null;
    }

    const host = surfaceHost();
    const frame = host?.querySelector('[data-floe-workbench-canvas-frame="true"]') as HTMLElement | null;
    const rect = frame?.getBoundingClientRect();
    const scale = Number(workbenchState().viewport.scale);
    if (!rect || !Number.isFinite(scale) || Math.abs(scale) <= WORKBENCH_MIN_SCALE_EPSILON) {
      return null;
    }

    return {
      worldX: (clientX - rect.left - Number(workbenchState().viewport.x)) / scale,
      worldY: (clientY - rect.top - Number(workbenchState().viewport.y)) / scale,
    };
  };

  const applyRuntimeSnapshot = (snapshot: RuntimeWorkbenchLayoutSnapshot) => {
    confirmRuntimeTerminalWidgets(snapshot);
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
    setWorkbenchState((previous) => {
      const next = projectWorkbenchStateFromRuntimeLayout({
        snapshot,
        localState: localState(),
        existingState: previous,
        widgetDefinitions: redevenWorkbenchWidgets,
      });
      const previousSelectedWidgetId = compact(previous.selectedWidgetId);
      if (previousSelectedWidgetId && !compact(next.selectedWidgetId)) {
        const fallbackWidgetId = resolveWorkbenchFocusFallback(
          focusHistory(),
          next.widgets,
          [previousSelectedWidgetId],
        );
        if (fallbackWidgetId) {
          return {
            ...next,
            selectedWidgetId: fallbackWidgetId,
          };
        }
      }
      return next;
    });
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
    confirmRuntimeTerminalWidgets(snapshot);
    if (submitQueued() || submitInFlight() || localOwnerHandoffActive()) {
      bufferRuntimeSnapshot(snapshot);
      return;
    }
    applyRuntimeSnapshot(snapshot);
  };

  const applyLocalRuntimeSnapshotWhenReady = (snapshot: RuntimeWorkbenchLayoutSnapshot) => {
    confirmRuntimeTerminalWidgets(snapshot);
    if (localOwnerHandoffActive()) {
      bufferRuntimeSnapshot(snapshot);
      return;
    }
    applyRuntimeSnapshot(snapshot);
  };

  const setSurfaceWorkbenchState = (updater: (previous: WorkbenchState) => WorkbenchState) => {
    if (canvasScaleAnimationFrame !== undefined) {
      canvasScaleAnimationToken += 1;
      window.cancelAnimationFrame(canvasScaleAnimationFrame);
      canvasScaleAnimationFrame = undefined;
    }
    let shouldStartOwnerHandoff = false;
    let shouldPulseLayoutVisual = false;
    setWorkbenchState((previous) => {
      const next = updater(previous);
      shouldStartOwnerHandoff = shouldTrackSurfaceOwnerHandoff(previous, next);
      shouldPulseLayoutVisual = shouldPulseLayoutVisual || workbenchViewportChanged(previous.viewport, next.viewport);
      return next;
    });
    if (shouldPulseLayoutVisual) {
      pulseLayoutInteractionVisual();
    }
    if (shouldStartOwnerHandoff) {
      const release = terminalVisualCoordinator.beginInteraction('widget_layer_switch');
      beginLocalOwnerHandoff();
      requestPostInteractionFrame(() => release.end());
    }
  };

  const cancelCanvasScaleAnimation = () => {
    canvasScaleAnimationToken += 1;
    if (canvasScaleAnimationFrame !== undefined) {
      window.cancelAnimationFrame(canvasScaleAnimationFrame);
      canvasScaleAnimationFrame = undefined;
    }
  };

  const cancelLayoutInteractionVisualSettle = () => {
    if (layoutInteractionVisualSettleTimer === undefined) {
      return;
    }
    globalThis.clearTimeout(layoutInteractionVisualSettleTimer);
    layoutInteractionVisualSettleTimer = undefined;
  };

  const scheduleLayoutInteractionVisualSettle = () => {
    cancelLayoutInteractionVisualSettle();
    layoutInteractionVisualSettleTimer = globalThis.setTimeout(() => {
      layoutInteractionVisualSettleTimer = undefined;
      if (activeLayoutInteractions() === 0) {
        setLayoutInteractionVisualActive(false);
      }
    }, WORKBENCH_LAYOUT_VISUAL_SETTLE_MS);
  };

  const pulseLayoutInteractionVisual = () => {
    cancelLayoutInteractionVisualSettle();
    setLayoutInteractionVisualActive(true);
    if (activeLayoutInteractions() === 0) {
      scheduleLayoutInteractionVisualSettle();
    }
  };

  const beginLayoutInteractionHandle = (kind: WorkbenchTerminalInteractionKind = 'widget_drag') => {
    cancelLayoutInteractionVisualSettle();
    setLayoutInteractionVisualActive(true);
    setActiveLayoutInteractions((count) => count + 1);
    const terminalVisualToken = terminalVisualCoordinator.beginInteraction(kind);
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      terminalVisualToken.end();
      let reachedIdle = false;
      setActiveLayoutInteractions((count) => {
        const next = Math.max(0, count - 1);
        reachedIdle = next === 0;
        return next;
      });

      if (!reachedIdle) {
        return;
      }

      scheduleLayoutInteractionVisualSettle();
    };
  };

  const runTerminalVisualInteractionPulse = (
    kind: WorkbenchTerminalInteractionKind,
    settleMs: number,
    action?: () => void,
  ) => {
    const releaseInteraction = beginLayoutInteractionHandle(kind);
    try {
      action?.();
    } finally {
      globalThis.setTimeout(releaseInteraction, Math.max(0, settleMs));
    }
  };

  const beginSurfaceLayoutInteraction = (kind: WorkbenchTerminalInteractionKind = 'widget_drag') => {
    surfaceLayoutInteractionReleases.push(beginLayoutInteractionHandle(kind));
  };

  const endSurfaceLayoutInteraction = () => {
    surfaceLayoutInteractionReleases.pop()?.();
  };

  const beginSurfaceViewportInteraction = (kind: WorkbenchTerminalInteractionKind) => {
    surfaceViewportInteractionRelease?.();
    surfaceViewportInteractionRelease = beginLayoutInteractionHandle(kind);
  };

  const endSurfaceViewportInteraction = () => {
    surfaceViewportInteractionRelease?.();
    surfaceViewportInteractionRelease = null;
  };

  const animateCanvasScaleTo = (targetScale: number) => {
    const startViewport = workbenchState().viewport;
    const startScale = startViewport.scale;
    if (Math.abs(startScale - targetScale) <= WORKBENCH_MIN_SCALE_EPSILON) {
      cancelCanvasScaleAnimation();
      return;
    }
    const frameSize = resolveCanvasFrameSize();
    const viewportAtScale = (scale: number) => viewportForCenteredScale(startViewport, scale, frameSize);

    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      cancelCanvasScaleAnimation();
      setWorkbenchState((previous) => ({
        ...previous,
        viewport: viewportAtScale(targetScale),
      }));
      return;
    }

    cancelCanvasScaleAnimation();
    const animationToken = ++canvasScaleAnimationToken;
    const startTime = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

    const step = (frameTime: number) => {
      if (canvasScaleAnimationToken !== animationToken) {
        return;
      }
      const elapsed = Math.max(0, frameTime - startTime);
      const progress = Math.min(1, elapsed / WORKBENCH_SCALE_ANIMATION_DURATION_MS);
      const easedProgress = easeOutCubic(progress);
      const nextScale = startScale + ((targetScale - startScale) * easedProgress);

      setWorkbenchState((previous) => ({
        ...previous,
        viewport: viewportAtScale(progress >= 1 ? targetScale : nextScale),
      }));

      if (progress >= 1) {
        canvasScaleAnimationFrame = undefined;
        return;
      }

      canvasScaleAnimationFrame = window.requestAnimationFrame(step);
    };

    canvasScaleAnimationFrame = window.requestAnimationFrame(step);
  };

  const minimizeCanvasScale = () => {
    if (scaleAtMinimum(workbenchState().viewport.scale)) {
      return;
    }
    const runTransition = surfaceApi()?.runViewportTransition;
    const animate = () => animateCanvasScaleTo(REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE);
    if (!runTransition) {
      runTerminalVisualInteractionPulse(
        'widget_minimize',
        WORKBENCH_SCALE_ANIMATION_DURATION_MS + WORKBENCH_LAYOUT_VISUAL_SETTLE_MS,
        animate,
      );
      return;
    }
    runTransition(animate, {
      reason: 'hud_control',
      settleMs: WORKBENCH_SCALE_ANIMATION_DURATION_MS + WORKBENCH_LAYOUT_VISUAL_SETTLE_MS,
      interactionKind: 'widget_minimize',
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

  const tidyWorkbenchWidgetsByType = () => {
    const frameSize = resolveCanvasFrameSize();
    setSurfaceWorkbenchState((previous) => {
      if (previous.locked || previous.widgets.length <= 0) {
        return previous;
      }
      const viewportCenter = resolveViewportWorldCenter(previous.viewport, frameSize);
      const arrangedWidgets = arrangeWorkbenchWidgetsByType({
        widgets: previous.widgets,
        typeOrder: redevenWorkbenchFilterBarWidgetTypes,
        centerX: viewportCenter?.x ?? NaN,
        centerY: viewportCenter?.y ?? NaN,
      });
      if (sameWidgetPlacement(previous.widgets, arrangedWidgets)) {
        return previous;
      }
      return {
        ...previous,
        widgets: arrangedWidgets,
      };
    });
  };

  const resolveWorkbenchContextMenuItems: RedevenWorkbenchContextMenuItemsResolver = (context) => {
    const disabled = workbenchState().locked || context.widgets.length <= 0;
    const tidyItem: WorkbenchContextMenuItem = {
      id: 'redeven-tidy-by-type',
      kind: 'action',
      label: 'Tidy by Type',
      icon: LayoutDashboard,
      disabled,
      onSelect: () => {
        if (disabled) {
          return;
        }
        tidyWorkbenchWidgetsByType();
        context.closeMenu();
      },
    };
    const separator: WorkbenchContextMenuItem = {
      id: 'redeven-tidy-separator',
      kind: 'separator',
    };

    if (!context.menu.widgetId) {
      return [tidyItem, separator, ...context.items];
    }

    const deleteSeparatorIndex = context.items.findIndex((item) => item.id === 'separator-delete');
    if (deleteSeparatorIndex < 0) {
      return [...context.items, separator, tidyItem];
    }
    return [
      ...context.items.slice(0, deleteSeparatorIndex),
      tidyItem,
      separator,
      ...context.items.slice(deleteSeparatorIndex),
    ];
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
    if (typeof window === 'undefined') {
      return;
    }
    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented
        || event.isComposing
        || event.key !== 'Escape'
        || event.altKey
        || event.ctrlKey
        || event.metaKey
        || event.shiftKey
        || eventTargetUsesTextEntry(event.target)
        || selectedWidget()
        || scaleAtMinimum(workbenchState().viewport.scale)
      ) {
        return;
      }
      event.preventDefault();
      minimizeCanvasScale();
    };
    window.addEventListener('keydown', handleWindowKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', handleWindowKeyDown);
    });
  });

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
    setPendingTerminalOpenRequests({});
    setConfirmedRuntimeTerminalWidgetIds(new Set<string>());
    setFileBrowserOpenRequests({});
    setPreviewOpenRequests({});
    setFocusHistory([]);
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
    const addedWidgets = desiredLayout.widgets.length > currentSnapshot.widgets.length;
    const delayMs = addedWidgets ? WORKBENCH_LAYOUT_FAST_FLUSH_DELAY_MS : WORKBENCH_LAYOUT_FLUSH_DELAY_MS;
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
    }, delayMs);

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
    setPendingTerminalOpenRequests((previous) => filterRequestRecordByWidgetIds(previous, widgetIds));
    setConfirmedRuntimeTerminalWidgetIds((previous) => filterStringSetByWidgetIds(previous, widgetIds));
    setFileBrowserOpenRequests((previous) => filterRequestRecordByWidgetIds(previous, widgetIds));
    setPreviewOpenRequests((previous) => filterRequestRecordByWidgetIds(previous, widgetIds));
    setWidgetRemoveGuards((previous) => filterGuardRecordByWidgetIds(previous, widgetIds));
    setFileBrowserCommittedPaths((previous) => filterStringRecordByWidgetIds(previous, widgetIds));
    setAppliedRemoteFileStateRevisions((previous) => filterNumberRecordByWidgetIds(previous, widgetIds));
    setPendingSyncedPreviewItems((previous) => filterPreviewItemRecordByWidgetIds(previous, widgetIds));
  });

  createEffect(() => {
    const pending = pendingTerminalOpenRequests();
    const readyRequests: Record<string, WorkbenchOpenTerminalRequest> = {};
    const nextPending: Record<string, WorkbenchOpenTerminalRequest> = {};
    let changed = false;

    for (const [widgetId, request] of Object.entries(pending)) {
      if (runtimeTerminalWidgetReady(widgetId)) {
        readyRequests[widgetId] = request;
        changed = true;
      } else {
        nextPending[widgetId] = request;
      }
    }

    if (!changed) {
      return;
    }

    batch(() => {
      setPendingTerminalOpenRequests(nextPending);
      setTerminalOpenRequests((previous) => ({
        ...previous,
        ...readyRequests,
      }));
    });
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
    const widgets = workbenchState().widgets;
    const selectedWidgetId = compact(workbenchState().selectedWidgetId);
    setFocusHistory((previous) => {
      const next = recordWorkbenchFocus(previous, widgets, selectedWidgetId);
      return sameStringArray(previous, next) ? previous : next;
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
    const host = surfaceHost();
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
    const anchorPoint = resolveWorkbenchAnchorWorldPoint(request.workbenchAnchor);
    const shouldFocusWidget = request.focus !== false;
    const createWidgetOptions = {
      centerViewport: shouldFocusWidget ? false : centerViewport,
      ...(anchorPoint ? anchorPoint : {}),
    };
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
        const release = terminalVisualCoordinator.beginInteraction('widget_create');
        try {
          widget = api.createWidget(widgetType, createWidgetOptions);
        } finally {
          requestPostInteractionFrame(() => release.end());
        }
      } else {
        const latestWidget = latestWidgetId ? api.findWidgetById(latestWidgetId) : null;
        widget = latestWidget?.type === widgetType
          ? latestWidget
          : pickLatestWorkbenchWidget(workbenchState().widgets, widgetType, normalizedRequestedWidgetId);

        if (!widget) {
          const release = terminalVisualCoordinator.beginInteraction('widget_create');
          try {
            widget = api.createWidget(widgetType, createWidgetOptions);
          } finally {
            requestPostInteractionFrame(() => release.end());
          }
        }
      }
    } else {
      const hadWidget = Boolean(api.findWidgetByType(widgetType));
      const release = hadWidget ? null : terminalVisualCoordinator.beginInteraction('widget_create');
      try {
        widget = api.ensureWidget(
          widgetType,
          createWidgetOptions,
        );
      } finally {
        if (release) {
          requestPostInteractionFrame(() => release.end());
        }
      }
    }

    if (widget && shouldFocusWidget) {
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
        queueTerminalOpenRequest({
          requestId,
          widgetId: widget.id,
          workingDir,
          preferredName: compact(request.terminalPayload?.preferredName) || undefined,
        });
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
    const openStrategy = request.openStrategy ?? 'same_file_or_create';
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
      if (openStrategy === 'focus_latest_or_create') {
        const latestWidgetId = instanceState().latestWidgetIdByType['redeven.preview'] ?? null;
        const latestWidget = latestWidgetId ? api.findWidgetById(latestWidgetId) : null;
        widget = latestWidget?.type === 'redeven.preview'
          ? latestWidget
          : pickLatestWorkbenchWidget(workbenchState().widgets, 'redeven.preview') ?? api.findWidgetByType('redeven.preview');
      }
      if (!widget) {
        const release = terminalVisualCoordinator.beginInteraction('widget_create');
        try {
          widget = api.createWidget('redeven.preview', { centerViewport });
        } finally {
          requestPostInteractionFrame(() => release.end());
        }
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

  const removeWidget = (widgetId: string, options?: { ownVisualInteraction?: boolean }) => {
    const normalizedWidgetId = compact(widgetId);
    if (!normalizedWidgetId) {
      return;
    }
    const release = options?.ownVisualInteraction === false
      ? null
      : terminalVisualCoordinator.beginInteraction('widget_close');
    let shouldStartOwnerHandoff = false;
    setWorkbenchState((previous) => {
      const nextWidgets = previous.widgets.filter((widget) => widget.id !== normalizedWidgetId);
      const previousSelectedWidgetId = compact(previous.selectedWidgetId);
      const selectedWidgetId = previousSelectedWidgetId === normalizedWidgetId
        ? resolveWorkbenchFocusFallback(
          focusHistory(),
          nextWidgets,
          [normalizedWidgetId],
        )
        : previous.selectedWidgetId;
      shouldStartOwnerHandoff = Boolean(selectedWidgetId && selectedWidgetId !== previousSelectedWidgetId);
      return {
        ...previous,
        widgets: nextWidgets,
        selectedWidgetId,
      };
    });
    if (shouldStartOwnerHandoff) {
      beginLocalOwnerHandoff();
    }
    if (release) {
      requestPostInteractionFrame(() => release.end());
    }
  };

  const requestWidgetRemoval = (widgetId: string) => {
    const normalizedWidgetId = compact(widgetId);
    if (!normalizedWidgetId) {
      return;
    }
    if (pendingWidgetRemovalTimers.has(normalizedWidgetId)) {
      return;
    }
    const guard = widgetRemoveGuards()[normalizedWidgetId];
    if (guard && !guard()) {
      return;
    }
    const host = surfaceHost();
    const widgetElement = host?.querySelector(
      `[data-redeven-workbench-widget-id="${escapeWorkbenchWidgetIdSelectorValue(normalizedWidgetId)}"]`,
    );
    if (widgetElement instanceof HTMLElement) {
      widgetElement.setAttribute('data-redeven-workbench-widget-closing', 'true');
      widgetElement.style.pointerEvents = 'none';
    }
    const releaseInteraction = beginLayoutInteractionHandle('widget_close');
    const timer = globalThis.setTimeout(() => {
      pendingWidgetRemovalTimers.delete(normalizedWidgetId);
      removeWidget(normalizedWidgetId, { ownVisualInteraction: false });
      releaseInteraction();
    }, WORKBENCH_WIDGET_CLOSE_DEFER_MS);
    pendingWidgetRemovalTimers.set(normalizedWidgetId, { releaseInteraction, timer });
  };

  const runtimeTerminalSessionIds = (widgetId: string): string[] => {
    const state = runtimeWidgetStateById()[widgetId];
    if (state?.widget_type !== 'redeven.terminal' || state.state.kind !== 'terminal') {
      return [];
    }
    return state.state.session_ids;
  };

  const runtimeTerminalGeometryPreferences = (widgetId: string): RedevenWorkbenchTerminalGeometryPreferences => {
    const state = runtimeWidgetStateById()[widgetId];
    if (state?.widget_type !== 'redeven.terminal' || state.state.kind !== 'terminal') {
      return DEFAULT_TERMINAL_GEOMETRY_PREFERENCES;
    }
    return normalizeWorkbenchTerminalGeometryPreferences({
      fontSize: state.state.font_size,
      fontFamilyId: state.state.font_family_id,
    });
  };

  const putSharedTerminalState = async (
    widgetId: string,
    buildDesiredState: (
      latest: Extract<RuntimeWorkbenchWidgetStateData, { kind: 'terminal' }>,
    ) => Extract<RuntimeWorkbenchWidgetStateData, { kind: 'terminal' }>,
    retry = true,
  ): Promise<RuntimeWorkbenchWidgetState | null> => {
    const normalizedWidgetId = compact(widgetId);
    if (!normalizedWidgetId || !runtimeTerminalWidgetReady(normalizedWidgetId)) {
      return null;
    }
    const current = runtimeWidgetStateById()[normalizedWidgetId];
    const currentTerminalState: Extract<RuntimeWorkbenchWidgetStateData, { kind: 'terminal' }> =
      current?.widget_type === 'redeven.terminal' && current.state.kind === 'terminal'
        ? current.state
        : { kind: 'terminal', session_ids: [] };
    const desiredState = buildDesiredState(currentTerminalState);
    if (current && runtimeWorkbenchWidgetStateDataEqual(current.state, desiredState)) {
      return current;
    }
    try {
      const next = await putWorkbenchWidgetState(normalizedWidgetId, {
        base_revision: current?.revision ?? 0,
        widget_type: 'redeven.terminal',
        state: desiredState,
      });
      applyRuntimeWidgetState(next);
      return next;
    } catch (error) {
      if (retry && error instanceof WorkbenchWidgetStateConflictError) {
        const latestSnapshot = await getWorkbenchLayoutSnapshot();
        applyRuntimeSnapshot(latestSnapshot);
        const latest = latestSnapshot.widget_states.find((state) => state.widget_id === normalizedWidgetId);
        if (latest?.widget_type === 'redeven.terminal' && latest.state.kind === 'terminal') {
          const latestDesiredState = buildDesiredState(latest.state);
          if (runtimeWorkbenchWidgetStateDataEqual(latest.state, latestDesiredState)) {
            return latest;
          }
        }
        return putSharedTerminalState(normalizedWidgetId, buildDesiredState, false);
      }
      throw error;
    }
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
    terminalGeometryPreferences: (widgetId) => runtimeTerminalGeometryPreferences(compact(widgetId)),
    updateTerminalGeometryPreferences: (widgetId, updater) => {
      const normalizedWidgetId = compact(widgetId);
      if (!normalizedWidgetId) {
        return;
      }
      const currentPreferences = runtimeTerminalGeometryPreferences(normalizedWidgetId);
      const nextPreferences = normalizeWorkbenchTerminalGeometryPreferences(updater(currentPreferences));
      if (sameTerminalGeometryPreferences(currentPreferences, nextPreferences)) {
        return;
      }
      void putSharedTerminalState(normalizedWidgetId, (latest) => ({
        kind: 'terminal',
        session_ids: latest.session_ids,
        font_size: nextPreferences.fontSize,
        font_family_id: nextPreferences.fontFamilyId,
      })).catch((error) => {
        console.warn('Failed to update workbench terminal geometry preferences:', error);
      });
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
      if (!normalizedWidgetId || !runtimeTerminalWidgetReady(normalizedWidgetId)) {
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
        return normalizeRuntimeTerminalSessionInfo(result.session);
      } catch (error) {
        console.warn('Failed to create workbench terminal session:', error);
        throw error;
      }
    },
    deleteTerminalSession: async (widgetId, sessionId) => {
      const normalizedWidgetId = compact(widgetId);
      const normalizedSessionId = compact(sessionId);
      if (!normalizedWidgetId || !normalizedSessionId || !runtimeTerminalWidgetReady(normalizedWidgetId)) {
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
        throw error;
      }
    },
    registerTerminalCore: (widgetId, sessionId, core) => {
      terminalVisualCoordinator.registerCore(widgetId, sessionId, core);
    },
    registerTerminalSurface: (widgetId, sessionId, surface) => {
      terminalVisualCoordinator.registerSurface(widgetId, sessionId, surface);
    },
    terminalOpenRequest: (widgetId) => terminalOpenRequests()[compact(widgetId)] ?? null,
    dispatchTerminalOpenRequest: (request) => {
      queueTerminalOpenRequest(request);
    },
    consumeTerminalOpenRequest: (requestId) => {
      const normalizedRequestId = compact(requestId);
      if (!normalizedRequestId) {
        return;
      }
      setPendingTerminalOpenRequests((previous) => {
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
    cancelCanvasScaleAnimation();
    cancelLayoutInteractionVisualSettle();
    while (surfaceLayoutInteractionReleases.length > 0) {
      surfaceLayoutInteractionReleases.pop()?.();
    }
    surfaceViewportInteractionRelease?.();
    surfaceViewportInteractionRelease = null;
    terminalVisualCoordinator.dispose();
    for (const pendingRemoval of pendingWidgetRemovalTimers.values()) {
      globalThis.clearTimeout(pendingRemoval.timer);
      pendingRemoval.releaseInteraction();
    }
    pendingWidgetRemovalTimers.clear();
  });

  return (
    <EnvWorkbenchInstancesContext.Provider value={workbenchInstancesContextValue}>
      <div
        class={`redeven-workbench-page relative h-full min-h-0 overflow-hidden${layoutInteractionVisualActive() ? ' is-layout-interacting' : ''}`}
        data-testid="redeven-workbench-page"
        data-redeven-workbench-layout-interacting={layoutInteractionVisualActive() ? 'true' : 'false'}
      >
        <div ref={setSurfaceHost} class="h-full min-h-0">
          <RedevenWorkbenchSurface
            state={workbenchState}
            setState={setSurfaceWorkbenchState}
            widgetDefinitions={redevenWorkbenchWidgets}
            filterBarWidgetTypes={redevenWorkbenchFilterBarWidgetTypes}
            resolveContextMenuItems={resolveWorkbenchContextMenuItems}
            onApiReady={setSurfaceApi}
            onRequestDelete={requestWidgetRemoval}
            onLayoutInteractionStart={beginSurfaceLayoutInteraction}
            onLayoutInteractionEnd={endSurfaceLayoutInteraction}
            onViewportInteractionPulse={pulseLayoutInteractionVisual}
            onViewportInteractionStart={beginSurfaceViewportInteraction}
            onViewportInteractionEnd={endSurfaceViewportInteraction}
          />
        </div>
        <RedevenWorkbenchHudActions
          mount={workbenchHudMount}
          selectedWidget={selectedWidget}
          onMinimizeCanvasScale={minimizeCanvasScale}
          onFitSelectedWidget={fitSelectedWidgetToViewport}
        />
        <WorkbenchProgressCurtain
          visible={workbenchCurtainVisible()}
          stage={workbenchCurtainStage()}
          message={workbenchCurtainMessage()}
        />
      </div>
    </EnvWorkbenchInstancesContext.Provider>
  );
}
