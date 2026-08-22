import type { Component } from 'solid-js';
import { Show, createEffect, createSignal } from 'solid-js';

import type { FlowerModelIOStatus } from '../contracts/flowerSurfaceContracts';
import { FlowerIcon } from '../icons/FlowerIcon';
import { trimString } from '../flowerSurfaceModel';

export type FlowerModelStatusIndicatorProps = Readonly<{
  status: FlowerModelIOStatus | null;
  label: string;
  threadID: string;
  activeRunID?: string;
  running: boolean;
}>;

export const FlowerModelStatusIndicator: Component<FlowerModelStatusIndicatorProps> = (props) => {
  const [displayedStatus, setDisplayedStatus] = createSignal<FlowerModelIOStatus | null>(null);
  const [displayedLabel, setDisplayedLabel] = createSignal('');
  const [displayedRunID, setDisplayedRunID] = createSignal('');
  let displayedThreadIDValue = '';
  let displayedRunIDValue = '';
  let updateSequence = 0;

  const clearDisplayedStatus = () => {
    updateSequence += 1;
    displayedThreadIDValue = '';
    displayedRunIDValue = '';
    setDisplayedStatus(null);
    setDisplayedLabel('');
    setDisplayedRunID('');
  };

  createEffect(() => {
    const status = props.status;
    const threadID = trimString(props.threadID);
    const activeRunID = trimString(props.activeRunID);
    const runID = trimString(status?.run_id) || activeRunID;
    const previousThreadID = displayedThreadIDValue;
    const previousRunID = displayedRunIDValue;
    const runChanged = Boolean(
      previousThreadID
      && threadID
      && previousThreadID !== threadID,
    ) || Boolean(
      previousRunID
      && runID
      && previousRunID !== runID,
    );

    if (!props.running || !status || !threadID || !runID) {
      if (props.running && !status && previousThreadID === threadID && previousRunID === runID && previousRunID) return;
      clearDisplayedStatus();
      return;
    }

    if (runChanged) {
      clearDisplayedStatus();
      const sequence = updateSequence;
      queueMicrotask(() => {
        if (sequence !== updateSequence) return;
        const currentStatus = props.status;
        const currentThreadID = trimString(props.threadID);
        const currentRunID = trimString(currentStatus?.run_id) || trimString(props.activeRunID);
        if (!props.running || !currentStatus || currentThreadID !== threadID || currentRunID !== runID) return;
        setDisplayedStatus(currentStatus);
        setDisplayedLabel(props.label.replace(/\.\.\.$/, ''));
        displayedThreadIDValue = threadID;
        displayedRunIDValue = runID;
        setDisplayedRunID(runID);
      });
      return;
    }

    updateSequence += 1;
    setDisplayedStatus(status);
    setDisplayedLabel(props.label.replace(/\.\.\.$/, ''));
    displayedThreadIDValue = threadID;
    displayedRunIDValue = runID;
    setDisplayedRunID(runID);
  });

  return (
    <Show when={displayedStatus()}>
      {(status) => (
        <div
          class="flower-model-status-indicator"
          data-model-io-phase={status().phase}
          data-model-status-run-id={displayedRunID()}
        >
          <span class="flower-model-status-flower" aria-hidden="true">
            <FlowerIcon class="flower-model-status-flower-icon" />
          </span>
          <span class="flower-model-status-text" data-text={displayedLabel()}>
            {displayedLabel()}
            <span class="flower-model-status-dots" aria-hidden="true">
              <span class="flower-model-status-dot" />
              <span class="flower-model-status-dot" />
              <span class="flower-model-status-dot" />
            </span>
          </span>
        </div>
      )}
    </Show>
  );
};
