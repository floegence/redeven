import type { Component } from 'solid-js';
import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { XCircle } from '@floegence/floe-webapp-core/icons';

import type { FlowerActivityItem } from './contracts/flowerSurfaceContracts';

export type FlowerComputerStageSnapshot = Readonly<{
  item: FlowerActivityItem;
  targetID?: string;
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
  noFrame: string;
}>;

export type FlowerComputerStageProps = Readonly<{
  snapshot: FlowerComputerStageSnapshot;
  frameURL?: string;
  frameRef?: string;
  threadID?: string;
  loadFrame?: (input: Readonly<{ thread_id: string; target_id: string; resource_ref: string; sha256: string; signal: AbortSignal }>) => Promise<Blob>;
  copy: FlowerComputerStageCopy;
  onClose: () => void;
}>;

export const FlowerComputerStage: Component<FlowerComputerStageProps> = (props) => {
  const [resolvedURL, setResolvedURL] = createSignal(props.frameURL);
  const [resolvedError, setResolvedError] = createSignal('');
  createEffect(() => {
    const ref = props.frameRef || '';
    const targetID = props.snapshot.targetID || '';
    if (!ref || !targetID || !props.threadID || !props.loadFrame) {
      setResolvedURL(props.frameURL);
      setResolvedError('');
      return;
    }
    const match = /^computer:\/\/[^/]+\/([a-f0-9]{64})$/u.exec(ref);
    if (!match) { setResolvedURL(undefined); setResolvedError('Frame reference is invalid.'); return; }
    const controller = new AbortController();
    let objectURL = '';
    setResolvedURL(undefined); setResolvedError('Loading live frame…');
    void props.loadFrame({ thread_id: props.threadID, target_id: targetID, resource_ref: ref, sha256: match[1], signal: controller.signal }).then((blob) => {
      if (controller.signal.aborted) return;
      objectURL = URL.createObjectURL(blob); setResolvedURL(objectURL); setResolvedError('');
    }).catch(() => { if (!controller.signal.aborted) { setResolvedURL(undefined); setResolvedError('Live frame is unavailable.'); } });
    onCleanup(() => { controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL); });
  });
  return (
  <section class="flower-computer-stage" role="dialog" aria-label={props.copy.title}>
    <button type="button" class="flower-computer-stage-close" aria-label={props.copy.close} title={props.copy.close} onClick={props.onClose}><XCircle class="h-4 w-4" aria-hidden="true" /></button>
    <div class="flower-computer-stage-frame-wrap">
      <Show when={resolvedURL()} fallback={<div class="flower-computer-stage-no-frame" role="status" aria-label={resolvedError() || props.copy.noFrame} />}>
        {(url) => (
          <img
            class="flower-computer-stage-frame"
            src={url()}
            alt={props.snapshot.action}
            onError={() => {
              setResolvedURL(undefined);
              setResolvedError('Live frame is unavailable.');
            }}
          />
        )}
      </Show>
    </div>
  </section>
  );
};
