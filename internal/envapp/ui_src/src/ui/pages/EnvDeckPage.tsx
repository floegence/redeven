import { createEffect } from 'solid-js';
import { deferAfterPaint, useDeckDrag } from '@floegence/floe-webapp-core';
import { DeckGrid, DeckTopBar } from '@floegence/floe-webapp-core/deck';

import { useEnvContext } from './EnvContext';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';

export function EnvDeckPage() {
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
    <div class="flex h-full min-h-0 flex-col bg-background">
      <DeckTopBar />
      <div class="relative min-h-0 flex-1 overflow-hidden">
        <DeckGrid class="p-0" />
        <RedevenLoadingCurtain
          visible={env.connectionOverlayVisible()}
          surface="page"
          eyebrow="Runtime"
          message={env.connectionOverlayMessage()}
        />
      </div>
    </div>
  );
}
