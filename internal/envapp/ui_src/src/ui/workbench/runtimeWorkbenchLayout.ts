import {
  createDefaultWorkbenchState,
  sanitizeWorkbenchState,
  type WorkbenchState,
  type WorkbenchWidgetDefinition,
} from '@floegence/floe-webapp-core/workbench';

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
}>;

export type RuntimeWorkbenchLayoutEvent = Readonly<{
  seq: number;
  type: string;
  created_at_unix_ms: number;
  payload: RuntimeWorkbenchLayoutSnapshot;
}>;

export type RuntimeWorkbenchLayoutPutRequest = Readonly<{
  base_revision: number;
  widgets: RuntimeWorkbenchLayoutWidget[];
}>;

export type PersistedWorkbenchLocalState = Readonly<{
  version: 1;
  viewport: WorkbenchState['viewport'];
  locked: boolean;
  filters: Record<string, boolean>;
  selectedWidgetId: string | null;
  legacyLayoutMigrated: boolean;
}>;

const EMPTY_RUNTIME_WORKBENCH_LAYOUT_SNAPSHOT: RuntimeWorkbenchLayoutSnapshot = {
  seq: 0,
  revision: 0,
  updated_at_unix_ms: 0,
  widgets: [],
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
  return {
    seq: Math.max(0, Math.trunc(finiteNumber(value.seq, 0))),
    revision: Math.max(0, Math.trunc(finiteNumber(value.revision, 0))),
    updated_at_unix_ms: Math.max(0, Math.trunc(finiteNumber(value.updated_at_unix_ms, 0))),
    widgets,
  };
}

export function normalizeRuntimeWorkbenchLayoutEvent(value: unknown): RuntimeWorkbenchLayoutEvent | null {
  if (!isRecord(value)) {
    return null;
  }
  const payload = normalizeRuntimeWorkbenchLayoutSnapshot(value.payload);
  return {
    seq: Math.max(0, Math.trunc(finiteNumber(value.seq, payload.seq))),
    type: compact(value.type),
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
    legacyLayoutMigrated,
  };
}

export function sanitizePersistedWorkbenchLocalState(
  value: unknown,
  legacyState: WorkbenchState,
  widgetDefinitions: readonly WorkbenchWidgetDefinition[],
): PersistedWorkbenchLocalState {
  const fallback = derivePersistedWorkbenchLocalState(legacyState, false);
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
    legacyLayoutMigrated: typeof value.legacyLayoutMigrated === 'boolean' ? value.legacyLayoutMigrated : fallback.legacyLayoutMigrated,
  };
}

export function samePersistedWorkbenchLocalState(
  left: PersistedWorkbenchLocalState,
  right: PersistedWorkbenchLocalState,
): boolean {
  if (left.locked !== right.locked || left.selectedWidgetId !== right.selectedWidgetId || left.legacyLayoutMigrated !== right.legacyLayoutMigrated) {
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

  const widgets = args.snapshot.widgets
    .map((widget) => {
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
    })
    .filter((widget): widget is NonNullable<typeof widget> => widget !== null);

  const widgetIDs = new Set(widgets.map((widget) => widget.id));
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
      selectedWidgetId: widgetIDs.has(args.localState.selectedWidgetId ?? '') ? args.localState.selectedWidgetId : null,
    },
    {
      widgetDefinitions: args.widgetDefinitions,
      createFallbackState: () => createDefaultWorkbenchState(args.widgetDefinitions),
    },
  );
}
