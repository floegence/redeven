import {
  createDefaultWorkbenchState,
  sanitizeWorkbenchState,
  WORKBENCH_BACKGROUND_MATERIALS,
  WORKBENCH_DEFAULT_BACKGROUND_MATERIAL,
  WORKBENCH_DEFAULT_REGION_FILL,
  WORKBENCH_DEFAULT_STICKY_NOTE_COLOR,
  WORKBENCH_DEFAULT_TEXT_COLOR,
  WORKBENCH_DEFAULT_TEXT_FONT,
  WORKBENCH_LAYER_COMPONENT_FILTER_IDS,
  WORKBENCH_REGION_FILL_OPTIONS,
  WORKBENCH_STICKY_NOTE_COLORS,
  WORKBENCH_TEXT_COLOR_OPTIONS,
  WORKBENCH_TEXT_FONT_OPTIONS,
  type WorkbenchAnnotationItem,
  type WorkbenchBackgroundLayer,
  type WorkbenchDockToolId,
  type WorkbenchInteractionMode,
  type WorkbenchSelection,
  type WorkbenchStickyNoteColor,
  type WorkbenchStickyNoteItem,
  type WorkbenchTextAnnotationAlign,
  type WorkbenchThemeId,
  type WorkbenchState,
  type WorkbenchWidgetDefinition,
} from '@floegence/floe-webapp-core/workbench';

import { normalizeWorkbenchTheme } from './workbenchThemeMigration';
import {
  normalizeTerminalFontFamilyId,
  normalizeTerminalFontSize,
} from '../services/terminalGeometry';

export const REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE = 0.45;
export const REDEVEN_WORKBENCH_TEXT_ANNOTATION_DEFAULT_FONT_SIZE = 100;
const WORKBENCH_INTERACTION_MODES = new Set(['work', 'annotation', 'background']);
const WORKBENCH_TEXT_ALIGNMENTS = new Set(['left', 'center', 'right']);
const WORKBENCH_STICKY_NOTE_COLOR_SET = new Set<string>(WORKBENCH_STICKY_NOTE_COLORS);
const WORKBENCH_TEXT_COLOR_SET = new Set<string>(WORKBENCH_TEXT_COLOR_OPTIONS);
const WORKBENCH_REGION_FILL_SET = new Set<string>(WORKBENCH_REGION_FILL_OPTIONS);
const WORKBENCH_BACKGROUND_MATERIAL_SET = new Set<string>(WORKBENCH_BACKGROUND_MATERIALS);
const WORKBENCH_TEXT_FONT_FAMILY_SET = new Set<string>(
  WORKBENCH_TEXT_FONT_OPTIONS.map((option) => option.fontFamily),
);

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
  sticky_notes: WorkbenchStickyNoteItem[];
  annotations: WorkbenchAnnotationItem[];
  background_layers: WorkbenchBackgroundLayer[];
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
  sticky_notes: WorkbenchStickyNoteItem[];
  annotations: WorkbenchAnnotationItem[];
  background_layers: WorkbenchBackgroundLayer[];
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
  | Readonly<{ kind: 'terminal'; session_ids: string[]; font_size?: number; font_family_id?: string }>
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
  version: 3;
  locked: boolean;
  filters: Record<string, boolean>;
  theme: WorkbenchThemeId;
  mode: WorkbenchInteractionMode;
  activeTool: WorkbenchDockToolId;
  legacyLayoutMigrated: boolean;
}>;

const EMPTY_RUNTIME_WORKBENCH_LAYOUT_SNAPSHOT: RuntimeWorkbenchLayoutSnapshot = {
  seq: 0,
  revision: 0,
  updated_at_unix_ms: 0,
  widgets: [],
  widget_states: [],
  sticky_notes: [],
  annotations: [],
  background_layers: [],
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

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeWorkbenchInteractionMode(value: unknown, fallback: WorkbenchInteractionMode = 'work'): WorkbenchInteractionMode {
  const mode = compact(value);
  return WORKBENCH_INTERACTION_MODES.has(mode) ? mode as WorkbenchInteractionMode : fallback;
}

function normalizeWorkbenchDockToolId(value: unknown, fallback: WorkbenchDockToolId = 'select'): WorkbenchDockToolId {
  return compact(value) as WorkbenchDockToolId || fallback;
}

function normalizeStickyNoteColor(value: unknown): WorkbenchStickyNoteColor {
  const color = compact(value);
  return WORKBENCH_STICKY_NOTE_COLOR_SET.has(color)
    ? color as WorkbenchStickyNoteColor
    : WORKBENCH_DEFAULT_STICKY_NOTE_COLOR;
}

function normalizeTextAlignment(value: unknown): WorkbenchTextAnnotationAlign {
  const align = compact(value);
  return WORKBENCH_TEXT_ALIGNMENTS.has(align) ? align as WorkbenchTextAnnotationAlign : 'left';
}

function normalizeFiniteDimension(value: unknown, fallback: number): number {
  const dimension = finiteNumber(value, fallback);
  return Number.isFinite(dimension) && dimension > 0 ? dimension : fallback;
}

function normalizeWorkbenchTextFontFamily(value: unknown): string {
  const fontFamily = compact(value);
  return WORKBENCH_TEXT_FONT_FAMILY_SET.has(fontFamily)
    ? fontFamily
    : WORKBENCH_DEFAULT_TEXT_FONT.fontFamily;
}

function normalizeWorkbenchTextColor(value: unknown): string {
  const color = compact(value);
  return WORKBENCH_TEXT_COLOR_SET.has(color) ? color : WORKBENCH_DEFAULT_TEXT_COLOR;
}

function normalizeWorkbenchRegionFill(value: unknown): string {
  const fill = compact(value);
  return WORKBENCH_REGION_FILL_SET.has(fill) ? fill : WORKBENCH_DEFAULT_REGION_FILL;
}

function normalizeLayerTimestamp(value: unknown): number {
  return Math.max(0, Math.trunc(finiteNumber(value, 0)));
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
    const fontSize = 'font_size' in value ? normalizeTerminalFontSize(value.font_size) : undefined;
    const fontFamilyId = 'font_family_id' in value ? normalizeTerminalFontFamilyId(value.font_family_id) : undefined;
    return {
      kind: 'terminal',
      session_ids: sessionIds,
      ...(typeof fontSize === 'number' ? { font_size: fontSize } : {}),
      ...(fontFamilyId ? { font_family_id: fontFamilyId } : {}),
    };
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

function normalizeWorkbenchStickyNote(value: unknown): WorkbenchStickyNoteItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = compact(value.id);
  const x = finiteNumber(value.x, NaN);
  const y = finiteNumber(value.y, NaN);
  const width = finiteNumber(value.width, NaN);
  const height = finiteNumber(value.height, NaN);
  if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    id,
    kind: 'sticky_note',
    body: stringValue(value.body),
    color: normalizeStickyNoteColor(value.color),
    x,
    y,
    width,
    height,
    z_index: Math.max(0, Math.trunc(finiteNumber(value.z_index, 0))),
    created_at_unix_ms: normalizeLayerTimestamp(value.created_at_unix_ms),
    updated_at_unix_ms: normalizeLayerTimestamp(value.updated_at_unix_ms),
  };
}

function normalizeWorkbenchAnnotation(value: unknown): WorkbenchAnnotationItem | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = compact(value.id);
  const x = finiteNumber(value.x, NaN);
  const y = finiteNumber(value.y, NaN);
  const width = finiteNumber(value.width, NaN);
  const height = finiteNumber(value.height, NaN);
  if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    id,
    kind: 'text',
    text: stringValue(value.text),
    font_family: normalizeWorkbenchTextFontFamily(value.font_family),
    font_size: normalizeFiniteDimension(value.font_size, REDEVEN_WORKBENCH_TEXT_ANNOTATION_DEFAULT_FONT_SIZE),
    font_weight: Math.max(100, Math.min(900, Math.trunc(finiteNumber(value.font_weight, WORKBENCH_DEFAULT_TEXT_FONT.fontWeight)))),
    color: normalizeWorkbenchTextColor(value.color),
    align: normalizeTextAlignment(value.align),
    x,
    y,
    width,
    height,
    z_index: Math.max(0, Math.trunc(finiteNumber(value.z_index, 0))),
    created_at_unix_ms: normalizeLayerTimestamp(value.created_at_unix_ms),
    updated_at_unix_ms: normalizeLayerTimestamp(value.updated_at_unix_ms),
  };
}

function normalizeWorkbenchBackgroundLayer(value: unknown): WorkbenchBackgroundLayer | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = compact(value.id);
  const x = finiteNumber(value.x, NaN);
  const y = finiteNumber(value.y, NaN);
  const width = finiteNumber(value.width, NaN);
  const height = finiteNumber(value.height, NaN);
  if (!id || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const material = compact(value.material);
  return {
    id,
    name: compact(value.name) || 'Background',
    fill: normalizeWorkbenchRegionFill(value.fill),
    opacity: Math.max(0, Math.min(1, finiteNumber(value.opacity, 0.35))),
    material: WORKBENCH_BACKGROUND_MATERIAL_SET.has(material)
      ? material as WorkbenchBackgroundLayer['material']
      : WORKBENCH_DEFAULT_BACKGROUND_MATERIAL,
    x,
    y,
    width,
    height,
    z_index: Math.max(0, Math.trunc(finiteNumber(value.z_index, 0))),
    created_at_unix_ms: normalizeLayerTimestamp(value.created_at_unix_ms),
    updated_at_unix_ms: normalizeLayerTimestamp(value.updated_at_unix_ms),
  };
}

function sortLayerItems<T extends { id: string; z_index: number; created_at_unix_ms: number }>(
  items: readonly T[] | null | undefined,
): T[] {
  return [...(items ?? [])].sort((left, right) => {
    if (left.z_index !== right.z_index) {
      return left.z_index - right.z_index;
    }
    if (left.created_at_unix_ms !== right.created_at_unix_ms) {
      return left.created_at_unix_ms - right.created_at_unix_ms;
    }
    return left.id.localeCompare(right.id);
  });
}

function normalizeFilters(
  value: unknown,
  defaults: Record<string, boolean>,
  widgetDefinitions: readonly WorkbenchWidgetDefinition[],
): Record<string, boolean> {
  const allowedTypes = new Set<string>([
    ...widgetDefinitions.map((definition) => definition.type),
    ...WORKBENCH_LAYER_COMPONENT_FILTER_IDS,
  ]);
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
  const stickyNotes = Array.isArray(value.sticky_notes)
    ? sortLayerItems(value.sticky_notes
      .map((note) => normalizeWorkbenchStickyNote(note))
      .filter((note): note is WorkbenchStickyNoteItem => note !== null))
    : [];
  const annotations = Array.isArray(value.annotations)
    ? sortLayerItems(value.annotations
      .map((annotation) => normalizeWorkbenchAnnotation(annotation))
      .filter((annotation): annotation is WorkbenchAnnotationItem => annotation !== null))
    : [];
  const backgroundLayers = Array.isArray(value.background_layers)
    ? sortLayerItems(value.background_layers
      .map((layer) => normalizeWorkbenchBackgroundLayer(layer))
      .filter((layer): layer is WorkbenchBackgroundLayer => layer !== null))
    : [];
  return {
    seq: Math.max(0, Math.trunc(finiteNumber(value.seq, 0))),
    revision: Math.max(0, Math.trunc(finiteNumber(value.revision, 0))),
    updated_at_unix_ms: Math.max(0, Math.trunc(finiteNumber(value.updated_at_unix_ms, 0))),
    widgets,
    widget_states: widgetStates,
    sticky_notes: stickyNotes,
    annotations,
    background_layers: backgroundLayers,
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
    version: 3,
    locked: Boolean(state.locked),
    filters: Object.fromEntries(
      Object.entries(state.filters ?? {}).map(([key, enabled]) => [key, Boolean(enabled)]),
    ),
    theme: normalizeWorkbenchTheme(state.theme),
    mode: normalizeWorkbenchInteractionMode(state.mode),
    activeTool: normalizeWorkbenchDockToolId(state.activeTool),
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
    version: 3,
    locked: typeof value.locked === 'boolean' ? value.locked : fallback.locked,
    filters: normalizeFilters(value.filters, defaultState.filters, widgetDefinitions),
    theme: normalizeWorkbenchTheme(value.theme, fallback.theme),
    mode: normalizeWorkbenchInteractionMode(value.mode, fallback.mode),
    activeTool: normalizeWorkbenchDockToolId(value.activeTool, fallback.activeTool),
    legacyLayoutMigrated: typeof value.legacyLayoutMigrated === 'boolean' ? value.legacyLayoutMigrated : fallback.legacyLayoutMigrated,
  };
}

export function samePersistedWorkbenchLocalState(
  left: PersistedWorkbenchLocalState,
  right: PersistedWorkbenchLocalState,
): boolean {
  if (
    left.locked !== right.locked
    || left.theme !== right.theme
    || left.mode !== right.mode
    || left.activeTool !== right.activeTool
    || left.legacyLayoutMigrated !== right.legacyLayoutMigrated
  ) {
    return false;
  }
  const leftFilters = Object.entries(left.filters);
  const rightFilters = Object.entries(right.filters);
  if (leftFilters.length !== rightFilters.length) {
    return false;
  }
  return leftFilters.every(([key, value]) => right.filters[key] === value);
}

export function createWorkbenchOverviewViewport(args: Readonly<{
  widgets: readonly WorkbenchState['widgets'][number][];
  frameWidth: number;
  frameHeight: number;
  fallbackViewport?: WorkbenchState['viewport'];
}>): WorkbenchState['viewport'] {
  const frameWidth = finiteNumber(args.frameWidth, 0);
  const frameHeight = finiteNumber(args.frameHeight, 0);
  const fallbackViewport = args.fallbackViewport ?? {
    x: 0,
    y: 0,
    scale: REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
  };

  if (frameWidth <= 0 || frameHeight <= 0) {
    return {
      x: finiteNumber(fallbackViewport.x, 0),
      y: finiteNumber(fallbackViewport.y, 0),
      scale: REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
    };
  }

  if (!Array.isArray(args.widgets) || args.widgets.length <= 0) {
    return {
      x: frameWidth / 2,
      y: frameHeight / 2,
      scale: REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const widget of args.widgets) {
    const left = finiteNumber(widget.x, 0);
    const top = finiteNumber(widget.y, 0);
    const right = left + Math.max(0, finiteNumber(widget.width, 0));
    const bottom = top + Math.max(0, finiteNumber(widget.height, 0));
    minX = Math.min(minX, left);
    minY = Math.min(minY, top);
    maxX = Math.max(maxX, right);
    maxY = Math.max(maxY, bottom);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return {
      x: frameWidth / 2,
      y: frameHeight / 2,
      scale: REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
    };
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  return {
    x: frameWidth / 2 - centerX * REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
    y: frameHeight / 2 - centerY * REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
    scale: REDEVEN_WORKBENCH_OVERVIEW_MIN_SCALE,
  };
}

export function runtimeWorkbenchLayoutIsEmpty(snapshot: RuntimeWorkbenchLayoutSnapshot): boolean {
  return snapshot.revision === 0
    && (snapshot.widgets ?? []).length <= 0
    && (snapshot.sticky_notes ?? []).length <= 0
    && (snapshot.annotations ?? []).length <= 0
    && (snapshot.background_layers ?? []).length <= 0;
}

export function runtimeWorkbenchLayoutWidgetsEqual(
  left: readonly RuntimeWorkbenchLayoutWidget[] | null | undefined,
  right: readonly RuntimeWorkbenchLayoutWidget[] | null | undefined,
): boolean {
  const leftWidgets = left ?? [];
  const rightWidgets = right ?? [];
  if (leftWidgets.length !== rightWidgets.length) {
    return false;
  }
  return leftWidgets.every((widget, index) => {
    const other = rightWidgets[index];
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
      && left.session_ids.every((id, index) => right.session_ids[index] === id)
      && left.font_size === right.font_size
      && left.font_family_id === right.font_family_id;
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

export function runtimeWorkbenchStickyNotesEqual(
  left: readonly WorkbenchStickyNoteItem[] | null | undefined,
  right: readonly WorkbenchStickyNoteItem[] | null | undefined,
): boolean {
  const leftNotes = left ?? [];
  const rightNotes = right ?? [];
  if (leftNotes.length !== rightNotes.length) {
    return false;
  }
  return leftNotes.every((note, index) => {
    const other = rightNotes[index];
    return note.id === other.id
      && note.kind === other.kind
      && note.body === other.body
      && note.color === other.color
      && note.x === other.x
      && note.y === other.y
      && note.width === other.width
      && note.height === other.height
      && note.z_index === other.z_index
      && note.created_at_unix_ms === other.created_at_unix_ms
      && note.updated_at_unix_ms === other.updated_at_unix_ms;
  });
}

export function runtimeWorkbenchAnnotationsEqual(
  left: readonly WorkbenchAnnotationItem[] | null | undefined,
  right: readonly WorkbenchAnnotationItem[] | null | undefined,
): boolean {
  const leftAnnotations = left ?? [];
  const rightAnnotations = right ?? [];
  if (leftAnnotations.length !== rightAnnotations.length) {
    return false;
  }
  return leftAnnotations.every((annotation, index) => {
    const other = rightAnnotations[index];
    return annotation.id === other.id
      && annotation.kind === other.kind
      && annotation.text === other.text
      && annotation.font_family === other.font_family
      && annotation.font_size === other.font_size
      && annotation.font_weight === other.font_weight
      && annotation.color === other.color
      && annotation.align === other.align
      && annotation.x === other.x
      && annotation.y === other.y
      && annotation.width === other.width
      && annotation.height === other.height
      && annotation.z_index === other.z_index
      && annotation.created_at_unix_ms === other.created_at_unix_ms
      && annotation.updated_at_unix_ms === other.updated_at_unix_ms;
  });
}

export function runtimeWorkbenchBackgroundLayersEqual(
  left: readonly WorkbenchBackgroundLayer[] | null | undefined,
  right: readonly WorkbenchBackgroundLayer[] | null | undefined,
): boolean {
  const leftLayers = left ?? [];
  const rightLayers = right ?? [];
  if (leftLayers.length !== rightLayers.length) {
    return false;
  }
  return leftLayers.every((layer, index) => {
    const other = rightLayers[index];
    return layer.id === other.id
      && layer.name === other.name
      && layer.fill === other.fill
      && layer.opacity === other.opacity
      && layer.material === other.material
      && layer.x === other.x
      && layer.y === other.y
      && layer.width === other.width
      && layer.height === other.height
      && layer.z_index === other.z_index
      && layer.created_at_unix_ms === other.created_at_unix_ms
      && layer.updated_at_unix_ms === other.updated_at_unix_ms;
  });
}

export function runtimeWorkbenchSharedLayoutEqual(
  left: Partial<Pick<RuntimeWorkbenchLayoutSnapshot, 'widgets' | 'sticky_notes' | 'annotations' | 'background_layers'>>,
  right: Partial<Pick<RuntimeWorkbenchLayoutSnapshot, 'widgets' | 'sticky_notes' | 'annotations' | 'background_layers'>>,
): boolean {
  return runtimeWorkbenchLayoutWidgetsEqual(left.widgets, right.widgets)
    && runtimeWorkbenchStickyNotesEqual(left.sticky_notes, right.sticky_notes)
    && runtimeWorkbenchAnnotationsEqual(left.annotations, right.annotations)
    && runtimeWorkbenchBackgroundLayersEqual(left.background_layers, right.background_layers);
}

function selectedObjectExists(
  selectedObject: WorkbenchSelection | null | undefined,
  state: Pick<WorkbenchState, 'widgets' | 'stickyNotes' | 'annotations' | 'backgroundLayers'>,
): boolean {
  const id = compact(selectedObject?.id);
  if (!selectedObject || !id) {
    return false;
  }
  if (selectedObject.kind === 'widget') {
    return state.widgets.some((widget) => widget.id === id);
  }
  if (selectedObject.kind === 'sticky_note') {
    return (state.stickyNotes ?? []).some((note) => note.id === id);
  }
  if (selectedObject.kind === 'annotation') {
    return (state.annotations ?? []).some((annotation) => annotation.id === id);
  }
  if (selectedObject.kind === 'background_layer') {
    return (state.backgroundLayers ?? []).some((layer) => layer.id === id);
  }
  return false;
}

export function extractRuntimeWorkbenchLayoutFromWorkbenchState(
  state: WorkbenchState,
): Readonly<{
  widgets: RuntimeWorkbenchLayoutWidget[];
  sticky_notes: WorkbenchStickyNoteItem[];
  annotations: WorkbenchAnnotationItem[];
  background_layers: WorkbenchBackgroundLayer[];
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
  const stickyNotes = sortLayerItems((state.stickyNotes ?? [])
    .map((note) => normalizeWorkbenchStickyNote(note))
    .filter((note): note is WorkbenchStickyNoteItem => note !== null));
  const annotations = sortLayerItems((state.annotations ?? [])
    .map((annotation) => normalizeWorkbenchAnnotation(annotation))
    .filter((annotation): annotation is WorkbenchAnnotationItem => annotation !== null));
  const backgroundLayers = sortLayerItems((state.backgroundLayers ?? [])
    .map((layer) => normalizeWorkbenchBackgroundLayer(layer))
    .filter((layer): layer is WorkbenchBackgroundLayer => layer !== null));
  return {
    widgets,
    sticky_notes: stickyNotes,
    annotations,
    background_layers: backgroundLayers,
  };
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
  const stickyNotes = sortLayerItems(args.snapshot.sticky_notes);
  const annotations = sortLayerItems(args.snapshot.annotations);
  const backgroundLayers = sortLayerItems(args.snapshot.background_layers);
  const selectedObject = selectedObjectExists(args.existingState?.selectedObject, {
    widgets,
    stickyNotes,
    annotations,
    backgroundLayers,
  }) ? args.existingState?.selectedObject ?? null : null;
  const sanitized = sanitizeWorkbenchState(
    {
      ...defaultState,
      widgets,
      viewport: args.existingState?.viewport ?? defaultState.viewport,
      locked: args.localState.locked,
      filters: {
        ...defaultState.filters,
        ...args.localState.filters,
      },
      selectedWidgetId,
      theme: args.localState.theme,
      mode: args.localState.mode,
      activeTool: args.localState.activeTool,
      selectedObject,
      stickyNotes,
      annotations,
      backgroundLayers,
    },
    {
      widgetDefinitions: args.widgetDefinitions,
      createFallbackState: () => createDefaultWorkbenchState(args.widgetDefinitions),
    },
  );
  return {
    ...sanitized,
    mode: args.localState.mode,
    activeTool: args.localState.activeTool,
    selectedObject,
    stickyNotes,
    annotations,
    backgroundLayers,
  };
}
