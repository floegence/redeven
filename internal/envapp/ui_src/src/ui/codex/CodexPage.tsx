import { Show, createEffect, onCleanup } from 'solid-js';
import { deferAfterPaint, useViewActivation } from '@floegence/floe-webapp-core';

import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { useCodexContext } from './CodexProvider';
import { CodexPageShell } from './CodexPageShell';

function useCodexViewActivation() {
  try {
    return useViewActivation();
  } catch {
    return {
      id: 'codex-standalone',
      active: () => true,
      activationSeq: () => 1,
    };
  }
}

export function CodexPage() {
  const codex = useCodexContext();
  const viewActivation = useCodexViewActivation();

  createEffect(() => {
    const active = Boolean(viewActivation.active());
    const activationSeq = Math.max(0, Math.floor(Number(viewActivation.activationSeq()) || 0));
    codex.reportSurfaceActivation({
      mounted: true,
      active,
      activation_seq: activationSeq,
    });
    if (!active || activationSeq <= 0) return;
    deferAfterPaint(() => {
      codex.reportSurfaceAfterPaint(activationSeq);
    });
  });

  onCleanup(() => {
    codex.reportSurfaceActivation({
      mounted: false,
      active: false,
      activation_seq: Math.max(0, Math.floor(Number(viewActivation.activationSeq()) || 0)),
    });
  });

  return (
    <div class="relative flex h-full min-h-0 flex-col">
      <Show when={codex.statusLoading()}>
        <RedevenLoadingCurtain visible eyebrow="Codex" message="Loading Codex..." />
      </Show>
      <CodexPageShell />
    </div>
  );
}
