import { useDeckDrag } from '@floegence/floe-webapp-core';
import { DeckGrid, DeckTopBar } from '@floegence/floe-webapp-core/deck';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';

import { useEnvContext } from './EnvContext';

export function EnvDeckPage() {
  const env = useEnvContext();
  useDeckDrag();

  return (
    <div class="h-full min-h-0 flex flex-col">
      <DeckTopBar />

      <div class="flex-1 min-h-0 overflow-hidden relative">
        <DeckGrid class="p-0" />
        <LoadingOverlay visible={env.connectionOverlayVisible()} message={env.connectionOverlayMessage()} />
      </div>
    </div>
  );
}
