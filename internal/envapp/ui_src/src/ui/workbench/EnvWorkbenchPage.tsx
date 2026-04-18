import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import {
  WorkbenchSurface,
  createDefaultWorkbenchState,
  sanitizeWorkbenchState,
  type WorkbenchState,
  type WorkbenchSurfaceApi,
} from '@floegence/floe-webapp-core/workbench';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

import { envWidgetTypeForSurface } from '../envViewMode';
import { useEnvContext } from '../pages/EnvContext';
import { isDesktopStateStorageAvailable, readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';
import { resolveEnvAppStorageBinding } from '../services/uiPersistence';
import { redevenWorkbenchWidgets } from './redevenWorkbenchWidgets';

const WORKBENCH_PERSIST_DELAY_MS = 120;

function readPersistedWorkbenchState(storageKey: string): WorkbenchState {
  return sanitizeWorkbenchState(
    readUIStorageJSON(storageKey, null),
    {
      widgetDefinitions: redevenWorkbenchWidgets,
      createFallbackState: () => createDefaultWorkbenchState(redevenWorkbenchWidgets),
    },
  );
}

export function EnvWorkbenchPage() {
  const env = useEnvContext();
  const storageKey = createMemo(() => resolveEnvAppStorageBinding({
    envID: env.env_id(),
    desktopStateStorageAvailable: isDesktopStateStorageAvailable(),
  }).workbenchStorageKey);
  const [workbenchState, setWorkbenchState] = createSignal<WorkbenchState>(readPersistedWorkbenchState(storageKey()));
  const [surfaceApi, setSurfaceApi] = createSignal<WorkbenchSurfaceApi | null>(null);

  createEffect(() => {
    setWorkbenchState(readPersistedWorkbenchState(storageKey()));
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
    env.workbenchSurfaceActivationSeq();
    const request = env.workbenchSurfaceActivation();
    const requestId = String(request?.requestId ?? '').trim();
    const api = surfaceApi();
    if (!requestId || !request || !api) {
      return;
    }

    const widget = api.ensureWidget(
      envWidgetTypeForSurface(request.surfaceId),
      {
        centerViewport: request.centerViewport ?? request.ensureVisible ?? true,
      },
    );
    if (widget && request.focus !== false) {
      api.focusWidget(widget, { centerViewport: request.centerViewport ?? request.ensureVisible ?? true });
    }
    env.consumeWorkbenchSurfaceActivation(requestId);
  });

  return (
    <div class="relative h-full min-h-0 overflow-hidden">
      <WorkbenchSurface
        state={workbenchState}
        setState={setWorkbenchState}
        widgetDefinitions={redevenWorkbenchWidgets}
        onApiReady={setSurfaceApi}
      />
      <LoadingOverlay visible={env.connectionOverlayVisible()} message={env.connectionOverlayMessage()} />
    </div>
  );
}
