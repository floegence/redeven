import type {
  WorkbenchWidgetItem,
  WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';

import { basenameFromAbsolutePath, normalizeAbsolutePath } from '../utils/askFlowerPath';
import type { TerminalGeometryPreferences } from '../services/terminalGeometry';

export type RedevenWorkbenchMultiInstanceWidgetType =
  | 'redeven.terminal'
  | 'redeven.files'
  | 'redeven.preview';

export type RedevenWorkbenchTerminalPanelState = Readonly<{
  sessionIds: string[];
  activeSessionId: string | null;
}>;

export type RedevenWorkbenchTerminalGeometryPreferences = TerminalGeometryPreferences;

export type RedevenWorkbenchInstanceState = Readonly<{
  version: 2;
  latestWidgetIdByType: Partial<Record<WorkbenchWidgetType, string>>;
  terminalPanelsByWidgetId: Record<string, RedevenWorkbenchTerminalPanelState>;
  previewItemsByWidgetId: Record<string, FileItem>;
}>;

export type WorkbenchOpenTerminalRequest = Readonly<{
  requestId: string;
  widgetId: string;
  workingDir: string;
  preferredName?: string;
}>;

export type WorkbenchOpenFileBrowserRequest = Readonly<{
  requestId: string;
  widgetId: string;
  path: string;
  homePath?: string;
  title?: string;
}>;

export type WorkbenchOpenFilePreviewRequest = Readonly<{
  requestId: string;
  widgetId: string;
  item: FileItem;
}>;

const EMPTY_TERMINAL_PANEL_STATE: RedevenWorkbenchTerminalPanelState = {
  sessionIds: [],
  activeSessionId: null,
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeTerminalPanelState(value: unknown): RedevenWorkbenchTerminalPanelState {
  if (!isRecord(value)) {
    return EMPTY_TERMINAL_PANEL_STATE;
  }

  const sessionIds = Array.isArray(value.sessionIds)
    ? value.sessionIds
      .map((entry) => compact(entry))
      .filter(Boolean)
    : [];
  const uniqueSessionIds = Array.from(new Set(sessionIds));
  const activeSessionId = compact(value.activeSessionId);

  return {
    sessionIds: uniqueSessionIds,
    activeSessionId: uniqueSessionIds.includes(activeSessionId) ? activeSessionId : null,
  };
}

function sanitizePreviewItem(value: unknown): FileItem | null {
  if (!isRecord(value)) {
    return null;
  }

  const path = normalizeAbsolutePath(String(value.path ?? ''));
  if (!path) {
    return null;
  }

  const type = compact(value.type);
  if (type && type !== 'file') {
    return null;
  }

  const name = compact(value.name) || basenameFromAbsolutePath(path) || 'File';
  const sizeValue = Number(value.size);
  const size = Number.isFinite(sizeValue) && sizeValue >= 0 ? Math.floor(sizeValue) : undefined;

  return {
    id: compact(value.id) || path,
    type: 'file',
    path,
    name,
    size,
  };
}

export function createDefaultWorkbenchInstanceState(): RedevenWorkbenchInstanceState {
  return {
    version: 2,
    latestWidgetIdByType: {},
    terminalPanelsByWidgetId: {},
    previewItemsByWidgetId: {},
  };
}

export function sanitizeWorkbenchInstanceState(
  value: unknown,
  widgets: readonly WorkbenchWidgetItem[] = [],
): RedevenWorkbenchInstanceState {
  const next = createDefaultWorkbenchInstanceState();
  if (!isRecord(value)) {
    return reconcileWorkbenchInstanceState(next, widgets);
  }

  const latestWidgetIdByType = isRecord(value.latestWidgetIdByType)
    ? Object.fromEntries(
      Object.entries(value.latestWidgetIdByType)
        .map(([type, widgetId]) => [type, compact(widgetId)])
        .filter(([, widgetId]) => Boolean(widgetId)),
    ) as Partial<Record<WorkbenchWidgetType, string>>
    : {};

  const terminalPanelsByWidgetId = isRecord(value.terminalPanelsByWidgetId)
    ? Object.fromEntries(
      Object.entries(value.terminalPanelsByWidgetId)
        .map(([widgetId, panelState]) => [compact(widgetId), sanitizeTerminalPanelState(panelState)])
        .filter(([widgetId]) => Boolean(widgetId)),
    ) as Record<string, RedevenWorkbenchTerminalPanelState>
    : {};

  const previewItemsByWidgetId = isRecord(value.previewItemsByWidgetId)
    ? Object.fromEntries(
      Object.entries(value.previewItemsByWidgetId)
        .map(([widgetId, item]) => [compact(widgetId), sanitizePreviewItem(item)])
        .filter(([widgetId, item]) => Boolean(widgetId) && item !== null),
    ) as Record<string, FileItem>
    : {};

  return reconcileWorkbenchInstanceState({
    version: 2,
    latestWidgetIdByType,
    terminalPanelsByWidgetId,
    previewItemsByWidgetId,
  }, widgets);
}

export function reconcileWorkbenchInstanceState(
  state: RedevenWorkbenchInstanceState,
  widgets: readonly WorkbenchWidgetItem[],
): RedevenWorkbenchInstanceState {
  const widgetById = new Map<string, WorkbenchWidgetItem>();
  for (const widget of widgets) {
    widgetById.set(widget.id, widget);
  }

  const nextLatestWidgetIdByType: Partial<Record<WorkbenchWidgetType, string>> = {};
  for (const [type, widgetId] of Object.entries(state.latestWidgetIdByType)) {
    const normalizedWidgetId = compact(widgetId);
    if (normalizedWidgetId && widgetById.has(normalizedWidgetId)) {
      nextLatestWidgetIdByType[type as WorkbenchWidgetType] = normalizedWidgetId;
    }
  }

  const nextTerminalPanelsByWidgetId: Record<string, RedevenWorkbenchTerminalPanelState> = {};
  for (const [widgetId, panelState] of Object.entries(state.terminalPanelsByWidgetId)) {
    const widget = widgetById.get(widgetId);
    if (!widget || widget.type !== 'redeven.terminal') {
      continue;
    }
    nextTerminalPanelsByWidgetId[widgetId] = sanitizeTerminalPanelState(panelState);
  }

  const nextPreviewItemsByWidgetId: Record<string, FileItem> = {};
  for (const [widgetId, item] of Object.entries(state.previewItemsByWidgetId)) {
    const widget = widgetById.get(widgetId);
    if (!widget || widget.type !== 'redeven.preview') {
      continue;
    }
    const sanitizedItem = sanitizePreviewItem(item);
    if (sanitizedItem) {
      nextPreviewItemsByWidgetId[widgetId] = sanitizedItem;
    }
  }

  return {
    version: 2,
    latestWidgetIdByType: nextLatestWidgetIdByType,
    terminalPanelsByWidgetId: nextTerminalPanelsByWidgetId,
    previewItemsByWidgetId: nextPreviewItemsByWidgetId,
  };
}

export function buildWorkbenchInstanceStorageKey(workbenchStorageKey: string): string {
  const baseKey = compact(workbenchStorageKey);
  return baseKey ? `${baseKey}:instances` : 'workbench:instances';
}

export function isRedevenWorkbenchMultiInstanceWidgetType(
  value: unknown,
): value is RedevenWorkbenchMultiInstanceWidgetType {
  return value === 'redeven.terminal' || value === 'redeven.files' || value === 'redeven.preview';
}

export function buildWorkbenchFileBrowserStateScope(widgetId: string): string {
  const normalizedWidgetId = compact(widgetId);
  return normalizedWidgetId ? `workbench:${normalizedWidgetId}` : 'workbench';
}

export function buildWorkbenchTerminalTitle(params: Readonly<{
  sessionName?: string | null;
  workingDir?: string | null;
}>): string {
  const sessionName = compact(params.sessionName);
  if (sessionName) {
    return `Terminal · ${sessionName}`;
  }

  const workingDir = normalizeAbsolutePath(params.workingDir ?? '');
  if (workingDir && workingDir !== '/') {
    return `Terminal · ${basenameFromAbsolutePath(workingDir)}`;
  }

  return 'Terminal';
}

export function buildWorkbenchFileBrowserTitle(params: Readonly<{
  path?: string | null;
  preferredTitle?: string | null;
}>): string {
  const preferredTitle = compact(params.preferredTitle);
  if (preferredTitle) {
    return `Files · ${preferredTitle}`;
  }

  const normalizedPath = normalizeAbsolutePath(params.path ?? '');
  if (!normalizedPath || normalizedPath === '/') {
    return 'Files';
  }

  return `Files · ${basenameFromAbsolutePath(normalizedPath)}`;
}

export function buildWorkbenchFilePreviewTitle(item: FileItem | null | undefined): string {
  const path = normalizeAbsolutePath(item?.path ?? '');
  const name = compact(item?.name) || (path ? basenameFromAbsolutePath(path) : '');
  if (name) {
    return `Preview · ${name}`;
  }
  return 'Preview';
}

export function findWorkbenchPreviewWidgetIdByPath(
  widgets: readonly WorkbenchWidgetItem[],
  previewItemsByWidgetId: Record<string, FileItem>,
  path: string | null | undefined,
): string | null {
  const normalizedPath = normalizeAbsolutePath(path ?? '');
  if (!normalizedPath) {
    return null;
  }
  return widgets.find((widget) => widget.type === 'redeven.preview' && previewItemsByWidgetId[widget.id]?.path === normalizedPath)?.id ?? null;
}

export function pickLatestWorkbenchWidget(
  widgets: readonly WorkbenchWidgetItem[],
  type: WorkbenchWidgetType,
  preferredWidgetId?: string | null,
): WorkbenchWidgetItem | null {
  const normalizedPreferredWidgetId = compact(preferredWidgetId);
  if (normalizedPreferredWidgetId) {
    const preferred = widgets.find((widget) => widget.id === normalizedPreferredWidgetId && widget.type === type);
    if (preferred) {
      return preferred;
    }
  }

  const candidates = widgets.filter((widget) => widget.type === type);
  if (candidates.length <= 0) {
    return null;
  }

  return candidates
    .slice()
    .sort((left, right) => {
      if (right.z_index !== left.z_index) {
        return right.z_index - left.z_index;
      }
      return right.created_at_unix_ms - left.created_at_unix_ms;
    })[0] ?? null;
}
