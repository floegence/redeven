import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import {
  createDefaultWorkbenchState,
  sanitizeWorkbenchState,
  type WorkbenchState,
} from '@floegence/floe-webapp-core/workbench';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

import { basenameFromAbsolutePath, normalizeAbsolutePath } from '../utils/askFlowerPath';
import { envWidgetTypeForSurface } from '../envViewMode';
import { useEnvContext } from '../pages/EnvContext';
import { isDesktopStateStorageAvailable, readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';
import { resolveEnvAppStorageBinding } from '../services/uiPersistence';
import { RedevenWorkbenchSurface, type RedevenWorkbenchSurfaceApi } from './surface/RedevenWorkbenchSurface';
import { redevenWorkbenchFilterBarWidgetTypes, redevenWorkbenchWidgets } from './redevenWorkbenchWidgets';
import {
  EnvWorkbenchInstancesContext,
  type EnvWorkbenchInstancesContextValue,
} from './EnvWorkbenchInstancesContext';
import {
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
import type { WorkbenchAppearance } from './workbenchAppearance';

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

export interface EnvWorkbenchPageProps {
  appearance?: WorkbenchAppearance;
}

export function EnvWorkbenchPage(props: EnvWorkbenchPageProps = {}) {
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
  const [previewOpenRequests, setPreviewOpenRequests] = createSignal<Record<string, WorkbenchOpenFilePreviewRequest>>({});
  const [widgetRemoveGuards, setWidgetRemoveGuards] = createSignal<Record<string, () => boolean>>({});

  createEffect(() => {
    const nextWorkbenchState = readPersistedWorkbenchState(storageKey());
    setWorkbenchState(nextWorkbenchState);
    setInstanceState(readPersistedWorkbenchInstanceState(storageKey(), nextWorkbenchState));
    setTerminalOpenRequests({});
    setFileBrowserOpenRequests({});
    setPreviewOpenRequests({});
    setWidgetRemoveGuards({});
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
    setPreviewOpenRequests((previous) => filterRequestRecordByWidgetIds(previous, widgetIds));
    setWidgetRemoveGuards((previous) => filterGuardRecordByWidgetIds(previous, widgetIds));
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
        instanceState().previewItemsByWidgetId,
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
    previewItem: (widgetId) => {
      const normalizedWidgetId = compact(widgetId);
      if (!normalizedWidgetId) {
        return null;
      }
      return instanceState().previewItemsByWidgetId[normalizedWidgetId] ?? null;
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
      }
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

  return (
    <EnvWorkbenchInstancesContext.Provider value={workbenchInstancesContextValue}>
      <div class="relative h-full min-h-0 overflow-hidden">
        <RedevenWorkbenchSurface
          state={workbenchState}
          setState={setWorkbenchState}
          appearance={props.appearance}
          widgetDefinitions={redevenWorkbenchWidgets}
          filterBarWidgetTypes={redevenWorkbenchFilterBarWidgetTypes}
          onApiReady={setSurfaceApi}
          onRequestDelete={requestWidgetRemoval}
        />
        <LoadingOverlay visible={env.connectionOverlayVisible()} message={env.connectionOverlayMessage()} />
      </div>
    </EnvWorkbenchInstancesContext.Provider>
  );
}
