import {
  createDefaultWorkbenchState,
  sanitizeWorkbenchState,
  type WorkbenchThemeId,
  type WorkbenchState,
  type WorkbenchWidgetDefinition,
} from '@floegence/floe-webapp-core/workbench';

import { normalizeWorkbenchTheme } from './workbenchThemeMigration';

export type RuntimeWorkbenchLayoutWidget = Readonly<{
  widget_id: string;
  widget_type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z_index: number;
  created_at_unix_ms: number;
}>;

export type RuntimeWorkbenchLayoutSnapshot = Readonly<{
  seq: number;
  revision: number;
  updated_at_unix_ms: number;
  widgets: RuntimeWorkbenchLayoutWidget[];
  widget_states: RuntimeWorkbenchWidgetState[];
}>;

export type RuntimeWorkbenchLayoutEvent = Readonly<{
  seq: number;
  type: string;
  created_at_unix_ms: number;
  payload: RuntimeWorkbenchLayoutSnapshot | RuntimeWorkbenchWidgetState;
}>;

export type RuntimeWorkbenchLayoutPutRequest = Readonly<{
  base_revision: number;
  widgets: RuntimeWorkbenchLayoutWidget[];
}>;

export type RuntimeWorkbenchPreviewItem = Readonly<{
  id: string;
  type: 'file';
  path: string;
  name: string;
  size?: number;
}>;

export type RuntimeWorkbenchWidgetStateData =
  | Readonly<{ kind: 'files'; current_path: string }>
  | Readonly<{ kind: 'terminal'; session_ids: string[] }>
  | Readonly<{ kind: 'preview'; item: RuntimeWorkbenchPreviewItem | null }>;

export type RuntimeWorkbenchWidgetState = Readonly<{
  widget_id: string;
  widget_type: string;
  revision: number;
  updated_at_unix_ms: number;
  state: RuntimeWorkbenchWidgetStateData;
}>;

export type RuntimeWorkbenchWidgetStatePutRequest = Readonly<{
  base_revision: number;
  widget_type: string;
  state: RuntimeWorkbenchWidgetStateData;
}>;

export type RuntimeWorkbenchTerminalCreateSessionRequest = Readonly<{
  name?: string;
  working_dir?: string;
}>;

export type RuntimeWorkbenchTerminalSessionInfo = Readonly<{
  id: string;
  name: string;
  working_dir: string;
  created_at_ms: number;
  last_active_at_ms: number;
  is_active: boolean;
}>;

export type RuntimeWorkbenchTerminalCreateSessionResponse = Readonly<{
  session: RuntimeWorkbenchTerminalSessionInfo;
  widget_state: RuntimeWorkbenchWidgetState;
}>;

export type PersistedWorkbenchLocalState = Readonly<{
  version: 1;
  viewport: WorkbenchState['viewport'];
  locked: boolean;
  filters: Record<string, boolean>;
  selectedWidgetId: string | null;
  theme: WorkbenchThemeId;
  legacyLayoutMigrated: boolean;
}>;

const EMPTY_RUNTIME_WORKBENCH_LAYOUT_SNAPSHOT: RuntimeWorkbenchLayoutSnapshot = {
  seq: 0,
  revision: 0,
  updated_at_unix_ms: 0,
  widgets: [],
  widget_states: [],
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function viewportOrFallback(value: unknown, fallback: WorkbenchState['viewport']): WorkbenchState['viewport'] {
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    x: finiteNumber(value.x, fallback.x),
    y: finiteNumber(value.y, fallback.y),
    scale: finiteNumber(value.scale, fallback.scale),
  };
}

function normalizeRuntimeWorkbenchLayoutWidget(value: unknown): RuntimeWorkbenchLayoutWidget | null {
  if (!isRecord(value)) {
    return null;
  }
  const widgetID = compact(value.widget_id);
  const widgetType = compact(value.widget_type);
  const width = finiteNumber(value.width, NaN);
  const height = finiteNumber(value.height, NaN);
  const x = finiteNumber(value.x, NaN);
  const y = finiteNumber(value.y, NaN);
  const zIndex = Math.max(0, Math.trunc(finiteNumber(value.z_index, NaN)));
  const createdAt = Math.max(0, Math.trunc(finiteNumber(value.created_at_unix_ms, 0)));
  if (!widgetID || !widgetType || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return {
    widget_id: widgetID,
    widget_type: widgetType,
    x,
    y,
    width,
    height,
    z_index: zIndex,
    created_at_unix_ms: createdAt,
  };
}

function normalizeAbsolutePath(value: unknown): string {
  let path = compact(value);
  if (!path || !path.startsWith('/')) {
    return '';
  }
  while (path.includes('//')) {
    path = path.replaceAll('//', '/');
  }
  if (path.length > 1) {
    path = path.replace(/\/+$/g, '');
  }
  return path.length <= 4096 ? path : '';
}

function basenameFromPath(path: string): string {
  const normalized = normalizeAbsolutePath(path);
  if (!normalized || normalized === '/') return '';
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function normalizePreviewItem(value: unknown): RuntimeWorkbenchPreviewItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const path = normalizeAbsolutePath(value.path);
  if (!path) {
    return null;
  }
  const type = compact(value.type) || 'file';
  if (type !== 'file') {
    return null;
  }
  const sizeValue = Number(value.size);
  const size = Number.isFinite(sizeValue) && sizeValue >= 0 ? Math.floor(sizeValue) : undefined;
  return {
    id: compact(value.id) || path,
    type: 'file',
    path,
    name: compact(value.name) || basenameFromPath(path) || 'File',
    ...(typeof size === 'number' ? { size } : {}),
  };
}

function normalizeRuntimeWorkbenchWidgetStateData(
  widgetType: string,
  value: unknown,
): RuntimeWorkbenchWidgetStateData | null {
  if (!isRecord(value)) {
    return null;
  }
  const kind = compact(value.kind);
  if (widgetType === 'redeven.files' && (!kind || kind === 'files')) {
    const currentPath = normalizeAbsolutePath(value.current_path);
    return currentPath ? { kind: 'files', current_path: currentPath } : null;
  }
  if (widgetType === 'redeven.terminal' && (!kind || kind === 'terminal')) {
    const sessionIds = Array.isArray(value.session_ids)
      ? Array.from(new Set(value.session_ids.map((entry) => compact(entry)).filter(Boolean)))
      : [];
    return { kind: 'terminal', session_ids: sessionIds };
  }
  if (widgetType === 'redeven.preview' && (!kind || kind === 'preview')) {
    return { kind: 'preview', item: normalizePreviewItem(value.item) };
  }
  return null;
}

export function normalizeRuntimeWorkbenchWidgetState(value: unknown): RuntimeWorkbenchWidgetState | null {
  if (!isRecord(value)) {
    return null;
  }
  const widgetID = compact(value.widget_id);
  const widgetType = compact(value.widget_type);
  const state = normalizeRuntimeWorkbenchWidgetStateData(widgetType, value.state);
  if (!widgetID || !widgetType || !state) {
    return null;
  }
  return {
    widget_id: widgetID,
    widget_type: widgetType,
    revision: Math.max(0, Math.trunc(finiteNumber(value.revision, 0))),
    updated_at_unix_ms: Math.max(0, Math.trunc(finiteNumber(value.updated_at_unix_ms, 0))),
    state,
  };
}

function normalizeFilters(
  value: unknown,
  defaults: Record<string, boolean>,
  widgetDefinitions: readonly WorkbenchWidgetDefinition[],
): Record<string, boolean> {
  const allowedTypes = new Set(widgetDefinitions.map((definition) => definition.type));
  const next = { ...defaults };
  if (!isRecord(value)) {
    return next;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (!allowedTypes.has(key) || typeof entry !== 'boolean') {
      continue;
    }
    next[key] = entry;
  }
  return next;
}

export function buildWorkbenchLocalStateStorageKey(workbenchStorageKey: string): string {
  const baseKey = compact(workbenchStorageKey);
  return baseKey ? `${baseKey}:local_state` : 'workbench:local_state';
}

export function createEmptyRuntimeWorkbenchLayoutSnapshot(): RuntimeWorkbenchLayoutSnapshot {
  return EMPTY_RUNTIME_WORKBENCH_LAYOUT_SNAPSHOT;
}

export function normalizeRuntimeWorkbenchLayoutSnapshot(value: unknown): RuntimeWorkbenchLayoutSnapshot {
  if (!isRecord(value)) {
    return EMPTY_RUNTIME_WORKBENCH_LAYOUT_SNAPSHOT;
  }
  const widgets = Array.isArray(value.widgets)
    ? value.widgets
      .map((widget) => normalizeRuntimeWorkbenchLayoutWidget(widget))
      .filter((widget): widget is RuntimeWorkbenchLayoutWidget => widget !== null)
      .sort((left, right) => {
        if (left.z_index !== right.z_index) {
          return left.z_index - right.z_index;
        }
        if (left.created_at_unix_ms !== right.created_at_unix_ms) {
          return left.created_at_unix_ms - right.created_at_unix_ms;
        }
        return left.widget_id.localeCompare(right.widget_id);
      })
    : [];
  const widgetStates = Array.isArray(value.widget_states)
    ? value.widget_states
      .map((state) => normalizeRuntimeWorkbenchWidgetState(state))
      .filter((state): state is RuntimeWorkbenchWidgetState => state !== null)
      .sort((left, right) => left.widget_id.localeCompare(right.widget_id))
    : [];
  return {
    seq: Math.max(0, Math.trunc(finiteNumber(value.seq, 0))),
    revision: Math.max(0, Math.trunc(finiteNumber(value.revision, 0))),
    updated_at_unix_ms: Math.max(0, Math.trunc(finiteNumber(value.updated_at_unix_ms, 0))),
    widgets,
    widget_states: widgetStates,
  };
}

export function normalizeRuntimeWorkbenchLayoutEvent(value: unknown): RuntimeWorkbenchLayoutEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const eventType = compact(value.type);
  const payload = eventType === 'widget_state.upserted'
    ? normalizeRuntimeWorkbenchWidgetState(value.payload) ?? normalizeRuntimeWorkbenchLayoutSnapshot(value.payload)
    : normalizeRuntimeWorkbenchLayoutSnapshot(value.payload);
  return {
    seq: Math.max(0, Math.trunc(finiteNumber(value.seq, 'seq' in payload ? payload.seq : 0))),
    type: eventType,
    created_at_unix_ms: Math.max(0, Math.trunc(finiteNumber(value.created_at_unix_ms, 0))),
    payload,
  };
}

export function derivePersistedWorkbenchLocalState(
  state: WorkbenchState,
  legacyLayoutMigrated: boolean,
): PersistedWorkbenchLocalState {
  return {
    version: 1,
    viewport: {
      x: finiteNumber(state.viewport?.x, 0),
      y: finiteNumber(state.viewport?.y, 0),
      scale: finiteNumber(state.viewport?.scale, 1),
    },
    locked: Boolean(state.locked),
    filters: Object.fromEntries(
      Object.entries(state.filters ?? {}).map(([key, enabled]) => [key, Boolean(enabled)]),
    ),
    selectedWidgetId: compact(state.selectedWidgetId) || null,
    theme: normalizeWorkbenchTheme(state.theme),
    legacyLayoutMigrated,
  };
}

export function sanitizePersistedWorkbenchLocalState(
  value: unknown,
  legacyState: WorkbenchState,
  widgetDefinitions: readonly WorkbenchWidgetDefinition[],
  fallbackTheme?: WorkbenchThemeId,
): PersistedWorkbenchLocalState {
  const fallback = derivePersistedWorkbenchLocalState({
    ...legacyState,
    theme: fallbackTheme ?? normalizeWorkbenchTheme(legacyState.theme),
  }, false);
  const defaultState = createDefaultWorkbenchState(widgetDefinitions);
  if (!isRecord(value)) {
    return {
      ...fallback,
      filters: normalizeFilters(fallback.filters, defaultState.filters, widgetDefinitions),
    };
  }
  return {
    version: 1,
    viewport: viewportOrFallback(value.viewport, fallback.viewport),
    locked: typeof value.locked === 'boolean' ? value.locked : fallback.locked,
    filters: normalizeFilters(value.filters, defaultState.filters, widgetDefinitions),
    selectedWidgetId: compact(value.selectedWidgetId) || null,
    theme: normalizeWorkbenchTheme(value.theme, fallback.theme),
    legacyLayoutMigrated: typeof value.legacyLayoutMigrated === 'boolean' ? value.legacyLayoutMigrated : fallback.legacyLayoutMigrated,
  };
}

export function samePersistedWorkbenchLocalState(
  left: PersistedWorkbenchLocalState,
  right: PersistedWorkbenchLocalState,
): boolean {
  if (
    left.locked !== right.locked
    || left.selectedWidgetId !== right.selectedWidgetId
    || left.theme !== right.theme
    || left.legacyLayoutMigrated !== right.legacyLayoutMigrated
  ) {
    return false;
  }
  if (left.viewport.x !== right.viewport.x || left.viewport.y !== right.viewport.y || left.viewport.scale !== right.viewport.scale) {
    return false;
  }
  const leftFilters = Object.entries(left.filters);
  const rightFilters = Object.entries(right.filters);
  if (leftFilters.length !== rightFilters.length) {
    return false;
  }
  return leftFilters.every(([key, value]) => right.filters[key] === value);
}

export function runtimeWorkbenchLayoutIsEmpty(snapshot: RuntimeWorkbenchLayoutSnapshot): boolean {
  return snapshot.revision === 0 && snapshot.widgets.length <= 0;
}

export function runtimeWorkbenchLayoutWidgetsEqual(
  left: readonly RuntimeWorkbenchLayoutWidget[],
  right: readonly RuntimeWorkbenchLayoutWidget[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((widget, index) => {
    const other = right[index];
    return widget.widget_id === other.widget_id
      && widget.widget_type === other.widget_type
      && widget.x === other.x
      && widget.y === other.y
      && widget.width === other.width
      && widget.height === other.height
      && widget.z_index === other.z_index
      && widget.created_at_unix_ms === other.created_at_unix_ms;
  });
}

export function runtimeWorkbenchWidgetStateDataEqual(
  left: RuntimeWorkbenchWidgetStateData,
  right: RuntimeWorkbenchWidgetStateData,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'files' && right.kind === 'files') {
    return left.current_path === right.current_path;
  }
  if (left.kind === 'terminal' && right.kind === 'terminal') {
    return left.session_ids.length === right.session_ids.length
      && left.session_ids.every((id, index) => right.session_ids[index] === id);
  }
  if (left.kind === 'preview' && right.kind === 'preview') {
    const leftItem = left.item;
    const rightItem = right.item;
    if (!leftItem || !rightItem) return leftItem === rightItem;
    return leftItem.id === rightItem.id
      && leftItem.type === rightItem.type
      && leftItem.path === rightItem.path
      && leftItem.name === rightItem.name
      && leftItem.size === rightItem.size;
  }
  return false;
}

export function runtimeWorkbenchWidgetStatesEqual(
  left: readonly RuntimeWorkbenchWidgetState[],
  right: readonly RuntimeWorkbenchWidgetState[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((state, index) => {
    const other = right[index];
    return state.widget_id === other.widget_id
      && state.widget_type === other.widget_type
      && state.revision === other.revision
      && runtimeWorkbenchWidgetStateDataEqual(state.state, other.state);
  });
}

export function runtimeWorkbenchWidgetStateById(
  states: readonly RuntimeWorkbenchWidgetState[],
): Record<string, RuntimeWorkbenchWidgetState> {
  return Object.fromEntries(states.map((state) => [state.widget_id, state]));
}

export function extractRuntimeWorkbenchLayoutFromWorkbenchState(
  state: WorkbenchState,
): Readonly<{
  widgets: RuntimeWorkbenchLayoutWidget[];
}> {
  const widgets = (state.widgets ?? [])
    .map((widget) => normalizeRuntimeWorkbenchLayoutWidget({
      widget_id: widget.id,
      widget_type: widget.type,
      x: widget.x,
      y: widget.y,
      width: widget.width,
      height: widget.height,
      z_index: widget.z_index,
      created_at_unix_ms: widget.created_at_unix_ms,
    }))
    .filter((widget): widget is RuntimeWorkbenchLayoutWidget => widget !== null)
    .sort((left, right) => {
      if (left.z_index !== right.z_index) {
        return left.z_index - right.z_index;
      }
      if (left.created_at_unix_ms !== right.created_at_unix_ms) {
        return left.created_at_unix_ms - right.created_at_unix_ms;
      }
      return left.widget_id.localeCompare(right.widget_id);
    });
  return { widgets };
}

export function projectWorkbenchStateFromRuntimeLayout(args: Readonly<{
  snapshot: RuntimeWorkbenchLayoutSnapshot;
  localState: PersistedWorkbenchLocalState;
  existingState?: WorkbenchState | null;
  widgetDefinitions: readonly WorkbenchWidgetDefinition[];
}>): WorkbenchState {
  const defaultState = createDefaultWorkbenchState(args.widgetDefinitions);
  const widgetDefinitionByType = new Map(args.widgetDefinitions.map((definition) => [definition.type, definition]));
  const existingWidgetByID = new Map((args.existingState?.widgets ?? []).map((widget) => [widget.id, widget]));
  const runtimeWidgetByID = new Map(args.snapshot.widgets.map((widget) => [widget.widget_id, widget]));
  const visitedWidgetIDs = new Set<string>();

  const projectRuntimeWidget = (widget: RuntimeWorkbenchLayoutWidget): WorkbenchState['widgets'][number] | null => {
    const definition = widgetDefinitionByType.get(widget.widget_type);
    if (!definition) {
      return null;
    }
    const existing = existingWidgetByID.get(widget.widget_id);
    const title = existing?.type === widget.widget_type
      ? compact(existing.title) || definition.defaultTitle
      : definition.defaultTitle;
    return {
      id: widget.widget_id,
      type: widget.widget_type,
      title,
      x: widget.x,
      y: widget.y,
      width: widget.width,
      height: widget.height,
      z_index: widget.z_index,
      created_at_unix_ms: widget.created_at_unix_ms,
    };
  };

  const widgets: WorkbenchState['widgets'] = [];
  for (const existing of args.existingState?.widgets ?? []) {
    const runtimeWidget = runtimeWidgetByID.get(existing.id);
    if (!runtimeWidget || visitedWidgetIDs.has(runtimeWidget.widget_id)) {
      continue;
    }
    const projectedWidget = projectRuntimeWidget(runtimeWidget);
    if (!projectedWidget) {
      continue;
    }
    visitedWidgetIDs.add(runtimeWidget.widget_id);
    widgets.push(projectedWidget);
  }

  for (const runtimeWidget of args.snapshot.widgets) {
    if (visitedWidgetIDs.has(runtimeWidget.widget_id)) {
      continue;
    }
    const projectedWidget = projectRuntimeWidget(runtimeWidget);
    if (!projectedWidget) {
      continue;
    }
    visitedWidgetIDs.add(runtimeWidget.widget_id);
    widgets.push(projectedWidget);
  }

  const widgetIDs = new Set(widgets.map((widget) => widget.id));
  const liveSelectedWidgetId = compact(args.existingState?.selectedWidgetId);
  const selectedWidgetId = widgetIDs.has(liveSelectedWidgetId)
    ? liveSelectedWidgetId
    : null;
  return sanitizeWorkbenchState(
    {
      ...defaultState,
      widgets,
      viewport: args.localState.viewport,
      locked: args.localState.locked,
      filters: {
        ...defaultState.filters,
        ...args.localState.filters,
      },
      selectedWidgetId,
      theme: args.localState.theme,
    },
    {
      widgetDefinitions: args.widgetDefinitions,
      createFallbackState: () => createDefaultWorkbenchState(args.widgetDefinitions),
    },
  );
}
