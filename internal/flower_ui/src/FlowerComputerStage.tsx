import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { XCircle } from '@floegence/floe-webapp-core/icons';

import type { FlowerActivityItem } from './contracts/flowerSurfaceContracts';

export type FlowerComputerStageSnapshot = Readonly<{
  item: FlowerActivityItem;
  target: string;
  action: string;
  location: string;
  safety: string;
  frame?: string;
  status: FlowerActivityItem['status'];
}>;

export type FlowerComputerStageCopy = Readonly<{
  title: string;
  close: string;
  live: string;
  waiting: string;
  noFrame: string;
}>;

export type FlowerComputerStageProps = Readonly<{
  snapshot: FlowerComputerStageSnapshot;
  frameURL?: string;
  copy: FlowerComputerStageCopy;
  onClose: () => void;
}>;

function statusLabel(status: FlowerComputerStageSnapshot['status'], copy: FlowerComputerStageCopy): string {
  if (status === 'running' || status === 'pending') return copy.live;
  if (status === 'waiting') return copy.waiting;
  return copy.live;
}

export const FlowerComputerStage: Component<FlowerComputerStageProps> = (props) => (
  <section class="flower-computer-stage" role="dialog" aria-label={props.copy.title}>
    <header class="flower-computer-stage-header">
      <div class="flower-computer-stage-heading">
        <span class="flower-computer-stage-eyebrow">{props.copy.title}</span>
        <strong class="flower-computer-stage-target">{props.snapshot.target}</strong>
      </div>
      <div class="flower-computer-stage-header-actions">
        <span class="flower-computer-stage-status" data-status={props.snapshot.status}>{statusLabel(props.snapshot.status, props.copy)}</span>
        <button type="button" class="flower-computer-stage-close" aria-label={props.copy.close} title={props.copy.close} onClick={props.onClose}>
          <XCircle class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </header>
    <div class="flower-computer-stage-frame-wrap">
      <Show when={props.frameURL} fallback={<div class="flower-computer-stage-no-frame" role="status">{props.copy.noFrame}</div>}>
        {(url) => <img class="flower-computer-stage-frame" src={url()} alt={props.snapshot.action} />}
      </Show>
    </div>
    <footer class="flower-computer-stage-footer">
      <span class="flower-computer-stage-action">{props.snapshot.action}</span>
      <Show when={props.snapshot.location || props.snapshot.safety}>
        <span class="flower-computer-stage-meta">
          <Show when={props.snapshot.location}>{props.snapshot.location}</Show>
          <Show when={props.snapshot.safety}> · {props.snapshot.safety}</Show>
        </span>
      </Show>
    </footer>
  </section>
);
