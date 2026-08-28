import type { Component } from 'solid-js';
import { Show, createEffect, createSignal } from 'solid-js';

import { FlowerIcon } from '../icons/FlowerIcon';
import { trimString } from '../flowerSurfaceModel';

export type FlowerProgressIndicatorState = Readonly<{
  kind: string;
  runID: string;
}>;

export type FlowerProgressIndicatorProps = Readonly<{
  progress: FlowerProgressIndicatorState | null;
  label: string;
  threadID: string;
  activeRunID?: string;
  running: boolean;
}>;

export const FlowerProgressIndicator: Component<FlowerProgressIndicatorProps> = (props) => {
  const [displayedProgress, setDisplayedProgress] = createSignal<FlowerProgressIndicatorState | null>(null);
  const [displayedLabel, setDisplayedLabel] = createSignal('');
  const [displayedRunID, setDisplayedRunID] = createSignal('');
  let displayedThreadIDValue = '';
  let displayedRunIDValue = '';
  let updateSequence = 0;

  const clearDisplayedProgress = () => {
    updateSequence += 1;
    displayedThreadIDValue = '';
    displayedRunIDValue = '';
    setDisplayedProgress(null);
    setDisplayedLabel('');
    setDisplayedRunID('');
  };

  createEffect(() => {
    const progress = props.progress;
    const threadID = trimString(props.threadID);
    const activeRunID = trimString(props.activeRunID);
    const runID = trimString(progress?.runID) || activeRunID;
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

    if (!props.running || !progress || !threadID || !runID) {
      if (props.running && !progress && previousThreadID === threadID && previousRunID === runID && previousRunID) return;
      clearDisplayedProgress();
      return;
    }

    if (runChanged) {
      clearDisplayedProgress();
      const sequence = updateSequence;
      queueMicrotask(() => {
        if (sequence !== updateSequence) return;
        const currentProgress = props.progress;
        const currentThreadID = trimString(props.threadID);
        const currentRunID = trimString(currentProgress?.runID) || trimString(props.activeRunID);
        if (!props.running || !currentProgress || currentThreadID !== threadID || currentRunID !== runID) return;
        setDisplayedProgress(currentProgress);
        setDisplayedLabel(props.label.replace(/\.\.\.$/, ''));
        displayedThreadIDValue = threadID;
        displayedRunIDValue = runID;
        setDisplayedRunID(runID);
      });
      return;
    }

    updateSequence += 1;
    setDisplayedProgress(progress);
    setDisplayedLabel(props.label.replace(/\.\.\.$/, ''));
    displayedThreadIDValue = threadID;
    displayedRunIDValue = runID;
    setDisplayedRunID(runID);
  });

  return (
    <Show when={displayedProgress()}>
      {(progress) => (
        <div
          class="flower-model-status-indicator"
          data-flower-progress-kind={progress().kind}
          data-flower-progress-run-id={displayedRunID()}
        >
          <span class="flower-model-status-flower" aria-hidden="true">
            <FlowerIcon class="flower-model-status-flower-icon" />
          </span>
          <span class="flower-model-status-text" data-text={displayedLabel()}>
            {displayedLabel()}
            <span class="flower-model-status-dots" aria-hidden="true">...</span>
          </span>
        </div>
      )}
    </Show>
  );
};
