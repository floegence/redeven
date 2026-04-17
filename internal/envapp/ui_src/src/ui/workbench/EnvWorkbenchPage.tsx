import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

import { envWidgetTypeForSurface } from '../envViewMode';
import { useEnvContext } from '../pages/EnvContext';
import { isDesktopStateStorageAvailable, readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';
import { resolveEnvAppStorageBinding } from '../services/uiPersistence';
import { createDefaultEnvWorkbenchState, sanitizeEnvWorkbenchState } from './helpers';
import { type EnvWorkbenchSurfaceApi, EnvWorkbenchSurface } from './EnvWorkbenchSurface';
import { redevenWorkbenchWidgets } from './redevenWorkbenchWidgets';
import type { EnvWorkbenchState } from './types';

const WORKBENCH_PERSIST_DELAY_MS = 120;

function readPersistedWorkbenchState(storageKey: string): EnvWorkbenchState {
  return sanitizeEnvWorkbenchState(
    readUIStorageJSON(storageKey, null),
    {
      widgetDefinitions: redevenWorkbenchWidgets,
      createFallbackState: () => createDefaultEnvWorkbenchState(redevenWorkbenchWidgets),
    },
  );
}

export function EnvWorkbenchPage() {
  const env = useEnvContext();
  const storageKey = createMemo(() => resolveEnvAppStorageBinding({
    envID: env.env_id(),
    desktopStateStorageAvailable: isDesktopStateStorageAvailable(),
  }).workbenchStorageKey);
  const [workbenchState, setWorkbenchState] = createSignal<EnvWorkbenchState>(readPersistedWorkbenchState(storageKey()));
  const [surfaceApi, setSurfaceApi] = createSignal<EnvWorkbenchSurfaceApi | null>(null);

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
    <div class="relative h-full min-h-0 overflow-hidden bg-[radial-gradient(circle_at_top,_color-mix(in_srgb,var(--primary)_10%,transparent),_transparent_40%),linear-gradient(180deg,color-mix(in_srgb,var(--background)_97%,transparent),color-mix(in_srgb,var(--muted)_20%,transparent))]">
      <div class="pointer-events-none absolute inset-x-0 top-0 z-[7] flex justify-center px-4 pt-3">
        <div class="pointer-events-auto inline-flex max-w-full items-center gap-3 rounded-full border border-border/70 bg-background/86 px-4 py-2 text-[11px] shadow-[0_10px_32px_rgba(15,23,42,0.08)] backdrop-blur">
          <span class="font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">Workbench</span>
          <span class="hidden text-muted-foreground/75 sm:inline">Spatial canvas for exploratory runtime operations</span>
        </div>
      </div>

      <EnvWorkbenchSurface
        class="pt-0"
        state={workbenchState}
        setState={setWorkbenchState}
        widgetDefinitions={redevenWorkbenchWidgets}
        onApiReady={setSurfaceApi}
      />
      <LoadingOverlay visible={env.connectionOverlayVisible()} message={env.connectionOverlayMessage()} />
    </div>
  );
}
