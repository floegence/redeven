import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import { FlowerMessageRunIndicator } from '../widgets/FlowerMessageRunIndicator';

export interface FlowerLiveRunPaneProps {
  phaseLabel?: string;
  class?: string;
}

export const FlowerLiveRunPane: Component<FlowerLiveRunPaneProps> = (props) => {
  return (
    <div class={cn('flower-live-run-pane', props.class)}>
      <div class="flower-live-run-header">
        <FlowerMessageRunIndicator phaseLabel={props.phaseLabel} />
      </div>
    </div>
  );
};
