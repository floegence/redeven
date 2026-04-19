import type {
  WorkbenchWidgetItem,
  WorkbenchWidgetType,
} from '@floegence/floe-webapp-core/workbench';

import { basenameFromAbsolutePath, normalizeAbsolutePath } from '../utils/askFlowerPath';

export type RedevenWorkbenchMultiInstanceWidgetType =
  | 'redeven.terminal'
  | 'redeven.files';

export type RedevenWorkbenchTerminalPanelState = Readonly<{
  sessionIds: string[];
  activeSessionId: string | null;
}>;

export type RedevenWorkbenchInstanceState = Readonly<{
  version: 1;
  latestWidgetIdByType: Partial<Record<WorkbenchWidgetType, string>>;
  terminalPanelsByWidgetId: Record<string, RedevenWorkbenchTerminalPanelState>;
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

export function createDefaultWorkbenchInstanceState(): RedevenWorkbenchInstanceState {
  return {
    version: 1,
    latestWidgetIdByType: {},
    terminalPanelsByWidgetId: {},
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

  return reconcileWorkbenchInstanceState({
    version: 1,
    latestWidgetIdByType,
    terminalPanelsByWidgetId,
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

  return {
    version: 1,
    latestWidgetIdByType: nextLatestWidgetIdByType,
    terminalPanelsByWidgetId: nextTerminalPanelsByWidgetId,
  };
}

export function buildWorkbenchInstanceStorageKey(workbenchStorageKey: string): string {
  const baseKey = compact(workbenchStorageKey);
  return baseKey ? `${baseKey}:instances` : 'workbench:instances';
}

export function isRedevenWorkbenchMultiInstanceWidgetType(
  value: unknown,
): value is RedevenWorkbenchMultiInstanceWidgetType {
  return value === 'redeven.terminal' || value === 'redeven.files';
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
