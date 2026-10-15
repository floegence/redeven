import type { Component } from 'solid-js';
import { createEffect, createMemo, createSignal, onCleanup, Show } from 'solid-js';

import { FlowerIcon } from '../icons/FlowerIcon';
import { trimString } from '../flowerSurfaceModel';
import type { FlowerProviderRequestProgress } from '../contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from '../copy';
import { flowerRequestStallSeconds, flowerRequestWaitSeconds } from '../providerRequestProgress';

export type FlowerProgressIndicatorState = Readonly<{
  kind: string;
  runID: string;
  request?: FlowerProviderRequestProgress;
}>;

export type FlowerProgressIndicatorProps = Readonly<{
  progress: FlowerProgressIndicatorState | null;
  label: string;
  outputCopy?: FlowerSurfaceCopy['chat']['outputProgress'];
}>;

export const FlowerProgressIndicator: Component<FlowerProgressIndicatorProps> = (props) => {
  const runID = () => trimString(props.progress?.runID) || null;

  const [now, setNow] = createSignal(performance.now());
  const waiting = createMemo(() => props.progress?.kind === 'waiting_response'
    && props.progress.request != null && !props.progress.request.first_output_at);
  const streaming = createMemo(() => !!props.progress?.request?.first_output_at
    && (props.progress.kind === 'streaming' || props.progress.kind === 'waiting_response'));
  const stalledSeconds = createMemo(() => streaming() ? flowerRequestStallSeconds(props.progress?.request, now()) : null);
  const label = () => stalledSeconds() !== null && props.outputCopy
    ? props.outputCopy.waitingForContinuation : props.label.replace(/\.\.\.$/, '');
  createEffect(() => {
    if (!waiting() && !streaming()) return;
    // Align the first tick to a whole second of the sampled request age.
    const anchor = waiting() ? props.progress?.request?.wait_anchor_monotonic_ms : props.progress?.request?.progress_anchor_monotonic_ms;
    if (anchor === undefined) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const timestamp = performance.now();
      setNow(timestamp);
      timer = setTimeout(tick, 1000 - Math.max(0, timestamp - anchor) % 1000);
    };
    tick();
    onCleanup(() => clearTimeout(timer));
  });
  const metric = createMemo(() => {
    const progress = props.progress;
    const request = progress?.request;
    if (!request || !props.outputCopy) return null;
    if (waiting()) {
      const seconds = flowerRequestWaitSeconds(request, now());
      return seconds === null ? null : { label: props.outputCopy.elapsed(seconds) };
    }
    if (!request.first_output_at || (!streaming() && progress?.kind !== 'finalizing')) return null;
    const seconds = stalledSeconds();
    const tokens = props.outputCopy.tokens(request.estimated_output_tokens);
    return { label: seconds === null ? tokens : `${tokens} · ${props.outputCopy.elapsed(seconds)}`, title: props.outputCopy.outputTooltip };
  });

  return (
    <Show keyed when={runID()}>
      {(_identity) => (
        <div
          class="flower-model-status-indicator"
          data-flower-progress-kind={props.progress?.kind}
          data-flower-progress-run-id={runID() ?? undefined}
        >
          <span class="flower-model-status-flower" aria-hidden="true">
            <FlowerIcon class="flower-model-status-flower-icon" />
          </span>
          <span class="flower-model-status-text" data-floe-progress-shimmer="text" role="status" aria-live="polite" aria-atomic="true">
            {label()}
            <Show when={!metric()}>
              <span class="flower-model-status-dots" aria-hidden="true">...</span>
            </Show>
          </span>
          <Show when={metric()}>
            {(value) => <span class="flower-model-status-metric" title={value().title} aria-live="off">
              <span aria-hidden="true">· </span>{value().label}
            </span>}
          </Show>
        </div>
      )}
    </Show>
  );
};
