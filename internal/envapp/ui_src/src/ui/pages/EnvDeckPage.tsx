import { createEffect } from 'solid-js';
import { deferAfterPaint, useDeckDrag } from '@floegence/floe-webapp-core';
import { DeckGrid } from '@floegence/floe-webapp-core/deck';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';

import { EnvDeckTopBar } from '../deck/EnvDeckTopBar';
import type { EnvSurfaceId } from '../envViewMode';
import { useEnvContext } from './EnvContext';

export interface EnvDeckPageProps {
  availableSurfaces: readonly EnvSurfaceId[];
}

export function EnvDeckPage(props: EnvDeckPageProps) {
  const env = useEnvContext();
  useDeckDrag();

  createEffect(() => {
    env.deckSurfaceActivationSeq();
    const request = env.deckSurfaceActivation();
    const requestId = String(request?.requestId ?? '').trim();
    const widgetId = String(request?.widgetId ?? '').trim();
    if (!requestId || !widgetId) return;

    deferAfterPaint(() => {
      const host = document.querySelector<HTMLElement>(`[data-widget-drag-handle="${widgetId}"]`);
      host?.scrollIntoView({
        behavior: request?.ensureVisible === false ? 'auto' : 'smooth',
        block: 'center',
        inline: 'center',
      });
      env.consumeDeckSurfaceActivation(requestId);
    });
  });

  return (
    <div class="flex h-full min-h-0 flex-col">
      <EnvDeckTopBar
        availableSurfaces={props.availableSurfaces}
        onAddSurface={(surfaceId) => env.openSurface(surfaceId, { reason: 'direct_navigation', focus: true, ensureVisible: true })}
      />

      <div class="relative min-h-0 flex-1 overflow-hidden">
        <DeckGrid class="p-0" />
        <LoadingOverlay visible={env.connectionOverlayVisible()} message={env.connectionOverlayMessage()} />
      </div>
    </div>
  );
}
