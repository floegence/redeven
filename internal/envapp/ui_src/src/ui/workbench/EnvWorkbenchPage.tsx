import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import {
  createDefaultWorkbenchState,
  sanitizeWorkbenchState,
  type WorkbenchState,
} from '@floegence/floe-webapp-core/workbench';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

import { normalizeAbsolutePath } from '../utils/askFlowerPath';
import { envWidgetTypeForSurface } from '../envViewMode';
import { useEnvContext } from '../pages/EnvContext';
import { isDesktopStateStorageAvailable, readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';
import { resolveEnvAppStorageBinding } from '../services/uiPersistence';
import { RedevenWorkbenchSurface, type RedevenWorkbenchSurfaceApi } from './surface/RedevenWorkbenchSurface';
import { redevenWorkbenchWidgets } from './redevenWorkbenchWidgets';
import {
  EnvWorkbenchInstancesContext,
  type EnvWorkbenchInstancesContextValue,
} from './EnvWorkbenchInstancesContext';
import {
  buildWorkbenchInstanceStorageKey,
  isRedevenWorkbenchMultiInstanceWidgetType,
  pickLatestWorkbenchWidget,
  reconcileWorkbenchInstanceState,
  sanitizeWorkbenchInstanceState,
  type RedevenWorkbenchInstanceState,
  type RedevenWorkbenchTerminalPanelState,
  type WorkbenchOpenFileBrowserRequest,
  type WorkbenchOpenTerminalRequest,
} from './workbenchInstanceState';

const WORKBENCH_PERSIST_DELAY_MS = 120;
const EMPTY_TERMINAL_PANEL_STATE: RedevenWorkbenchTerminalPanelState = {
  sessionIds: [],
  activeSessionId: null,
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
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

function readPersistedWorkbenchState(storageKey: string): WorkbenchState {
  return sanitizeWorkbenchState(
    readUIStorageJSON(storageKey, null),
    {
      widgetDefinitions: redevenWorkbenchWidgets,
      createFallbackState: () => createDefaultWorkbenchState(redevenWorkbenchWidgets),
    },
  );
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

export function EnvWorkbenchPage() {
  const env = useEnvContext();
  const storageKey = createMemo(() => resolveEnvAppStorageBinding({
    envID: env.env_id(),
    desktopStateStorageAvailable: isDesktopStateStorageAvailable(),
  }).workbenchStorageKey);
  const initialWorkbenchState = readPersistedWorkbenchState(storageKey());
  const [workbenchState, setWorkbenchState] = createSignal<WorkbenchState>(initialWorkbenchState);
  const [instanceState, setInstanceState] = createSignal<RedevenWorkbenchInstanceState>(
    readPersistedWorkbenchInstanceState(storageKey(), initialWorkbenchState),
  );
  const [surfaceApi, setSurfaceApi] = createSignal<RedevenWorkbenchSurfaceApi | null>(null);
  const [terminalOpenRequests, setTerminalOpenRequests] = createSignal<Record<string, WorkbenchOpenTerminalRequest>>({});
  const [fileBrowserOpenRequests, setFileBrowserOpenRequests] = createSignal<Record<string, WorkbenchOpenFileBrowserRequest>>({});

  createEffect(() => {
    const nextWorkbenchState = readPersistedWorkbenchState(storageKey());
    setWorkbenchState(nextWorkbenchState);
    setInstanceState(readPersistedWorkbenchInstanceState(storageKey(), nextWorkbenchState));
    setTerminalOpenRequests({});
    setFileBrowserOpenRequests({});
  });

  createEffect(() => {
    const key = storageKey();
    const state = workbenchState();
    if (!key) {
      return;
    }

    const timer = window.setTimeout(() => {
      writeUIStorageJSON(key, state);
    }, WORKBENCH_PERSIST_DELAY_MS);

    onCleanup(() => {
      window.clearTimeout(timer);
    });
  });

  createEffect(() => {
    const key = buildWorkbenchInstanceStorageKey(storageKey());
    const state = instanceState();
    if (!key) {
      return;
    }

    const timer = window.setTimeout(() => {
      writeUIStorageJSON(key, state);
    }, WORKBENCH_PERSIST_DELAY_MS);

    onCleanup(() => {
      window.clearTimeout(timer);
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
      return instanceState().terminalPanelsByWidgetId[normalizedWidgetId] ?? EMPTY_TERMINAL_PANEL_STATE;
    },
    updateTerminalPanelState: (widgetId, updater) => {
      const normalizedWidgetId = compact(widgetId);
      if (!normalizedWidgetId) {
        return;
      }
      setInstanceState((previous) => {
        const current = previous.terminalPanelsByWidgetId[normalizedWidgetId] ?? EMPTY_TERMINAL_PANEL_STATE;
        const next = updater(current);
        if (sameTerminalPanelState(current, next)) {
          return previous;
        }
        return {
          ...previous,
          terminalPanelsByWidgetId: {
            ...previous.terminalPanelsByWidgetId,
            [normalizedWidgetId]: next,
          },
        };
      });
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
    updateWidgetTitle,
  } as const;

  return (
    <EnvWorkbenchInstancesContext.Provider value={workbenchInstancesContextValue}>
      <div class="relative h-full min-h-0 overflow-hidden">
        <RedevenWorkbenchSurface
          state={workbenchState}
          setState={setWorkbenchState}
          widgetDefinitions={redevenWorkbenchWidgets}
          onApiReady={setSurfaceApi}
        />
        <LoadingOverlay visible={env.connectionOverlayVisible()} message={env.connectionOverlayMessage()} />
      </div>
    </EnvWorkbenchInstancesContext.Provider>
  );
}
