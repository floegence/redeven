import type { Component } from 'solid-js';
import { Show } from 'solid-js';

import { FlowerIcon } from '../icons/FlowerIcon';
import { trimString } from '../flowerSurfaceModel';

export type FlowerProgressIndicatorState = Readonly<{
  kind: string;
  runID: string;
}>;

export type FlowerProgressIndicatorProps = Readonly<{
  progress: FlowerProgressIndicatorState | null;
  pendingRequestID?: string;
  label: string;
}>;

export const FlowerProgressIndicator: Component<FlowerProgressIndicatorProps> = (props) => {
  const runID = () => trimString(props.progress?.runID) || null;
  const pendingRequestID = () => runID() ? null : trimString(props.pendingRequestID) || null;
  const label = () => props.label.replace(/\.\.\.$/, '');

  return (
    <Show keyed when={runID() || pendingRequestID()}>
      {(_identity) => (
        <div
          class="flower-model-status-indicator"
          data-flower-progress-kind={runID() ? props.progress?.kind : 'sending'}
          data-flower-progress-run-id={runID() ?? undefined}
          data-flower-progress-request-id={pendingRequestID() ?? undefined}
        >
          <span class="flower-model-status-flower" aria-hidden="true">
            <FlowerIcon class="flower-model-status-flower-icon" />
          </span>
          <span class="flower-model-status-text" data-floe-progress-shimmer="text">
            {label()}
            <span class="flower-model-status-dots" aria-hidden="true">...</span>
          </span>
        </div>
      )}
    </Show>
  );
};
