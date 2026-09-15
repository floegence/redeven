import type { Component } from 'solid-js';
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { Refresh, XCircle } from '@floegence/floe-webapp-core/icons';

import type { FlowerActivityItem, FlowerComputerUserInput } from './contracts/flowerSurfaceContracts';

export type FlowerComputerStageSnapshot = Readonly<{
  item: FlowerActivityItem;
  runID?: string;
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
  retry: string;
}>;

export type FlowerComputerStageProps = Readonly<{
  snapshot: FlowerComputerStageSnapshot;
  frameRef?: string;
  userFrame?: Blob;
  onInput?: (input: Omit<FlowerComputerUserInput, 'thread_id' | 'interaction_id'>) => void;
  threadID?: string;
  loadFrame?: (input: Readonly<{ thread_id: string; target_id: string; resource_ref: string; sha256: string; signal: AbortSignal }>) => Promise<Blob>;
  copy: FlowerComputerStageCopy;
  onClose: () => void;
}>;

export const FlowerComputerStage: Component<FlowerComputerStageProps> = (props) => {
  const [resolvedURL, setResolvedURL] = createSignal<string>();
  const [failed, setFailed] = createSignal(false);
  const [retry, setRetry] = createSignal(0);
  const frameRef = createMemo(() => props.frameRef || '');
  const targetID = createMemo(() => props.snapshot.targetID || '');
  const threadID = createMemo(() => props.threadID || '');
  let currentURL = '';
  let currentThread = '';
  let currentTarget = '';
  onCleanup(() => { if (currentURL) URL.revokeObjectURL(currentURL); });
  createEffect(() => {
    retry();
    const ref = frameRef();
    const userFrame = props.userFrame;
    const target = targetID();
    const thread = threadID();
    if (thread !== currentThread || target !== currentTarget) {
      currentThread = thread; currentTarget = target;
      setResolvedURL(undefined);
      if (currentURL) URL.revokeObjectURL(currentURL);
      currentURL = '';
    }
    if (!userFrame && (!ref || !target || !thread || !props.loadFrame)) {
      setResolvedURL(undefined);
      setFailed(true);
      return;
    }
    const match = /^computer:\/\/[^/]+\/([a-f0-9]{64})$/u.exec(ref);
    if (!userFrame && !match) { setResolvedURL(undefined); setFailed(true); return; }
    const controller = new AbortController();
    setFailed(false);
    const loading = userFrame ? Promise.resolve(userFrame) : props.loadFrame!({ thread_id: thread, target_id: target, resource_ref: ref, sha256: match![1], signal: controller.signal });
    void loading.then(async (blob) => {
      if (controller.signal.aborted) return;
      const nextURL = URL.createObjectURL(blob);
      // Decode before swapping when the runtime provides Image.decode. Some
      // embedded/webview environments do not implement it; assigning the
      // object URL to the real image element still performs normal decoding,
      // so do not discard an otherwise valid frame in that case.
      const image = new Image(); image.src = nextURL;
      if (typeof image.decode === 'function') {
        try { await image.decode(); } catch (error) { URL.revokeObjectURL(nextURL); throw error; }
      }
      if (controller.signal.aborted) { URL.revokeObjectURL(nextURL); return; }
      const previousURL = currentURL;
      currentURL = nextURL; setResolvedURL(nextURL); setFailed(false);
      if (previousURL) URL.revokeObjectURL(previousURL);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    onCleanup(() => controller.abort());
  });
  return (
  <section class="flower-computer-stage" role="dialog" aria-label={props.copy.title} data-computer-target={targetID()}>
    <button type="button" class="flower-computer-stage-close" aria-label={props.copy.close} title={props.copy.close} onClick={props.onClose}><XCircle class="h-4 w-4" aria-hidden="true" /></button>
    <div class="flower-computer-stage-frame-wrap">
      <Show when={resolvedURL()} fallback={<div class="flower-computer-stage-no-frame">
        <Show when={failed()} fallback={<Refresh class="h-5 w-5 animate-spin" role="status" aria-label={props.copy.noFrame} />}>
          <button type="button" aria-label={props.copy.retry} title={props.copy.retry} onClick={() => setRetry((value) => value + 1)}><Refresh class="h-5 w-5" aria-hidden="true" /></button>
        </Show>
      </div>}>
        {(url) => (
          <img
            class="flower-computer-stage-frame"
            src={url()}
            alt={props.snapshot.action}
            tabIndex={props.onInput ? 0 : undefined}
            style={props.onInput ? { cursor: 'crosshair' } : undefined}
            draggable={false}
            onClick={(event) => {
              if (!props.onInput) return;
              const img = event.currentTarget;
              img.focus({ preventScroll: true });
              const rect = img.getBoundingClientRect();
              const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
              const x = (event.clientX - rect.left - (rect.width - img.naturalWidth * scale) / 2) / scale;
              const y = (event.clientY - rect.top - (rect.height - img.naturalHeight * scale) / 2) / scale;
              if (x >= 0 && y >= 0 && x < img.naturalWidth && y < img.naturalHeight) props.onInput({ action: 'click', x, y });
            }}
            onKeyDown={(event) => {
              if (!props.onInput || event.isComposing) return;
              event.preventDefault(); event.stopPropagation();
              if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return;
              if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) props.onInput({ action: 'type', text: event.key });
              else props.onInput({ action: 'key', key: [event.metaKey ? 'Meta' : '', event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.key].filter(Boolean).join('+') });
            }}
            onCompositionEnd={(event) => { if (props.onInput && event.data) props.onInput({ action: 'type', text: event.data }); }}
            onWheel={(event) => {
              if (!props.onInput) return;
              event.preventDefault(); event.stopPropagation();
              props.onInput({ action: 'scroll', delta_x: event.deltaX, delta_y: event.deltaY });
            }}
            onError={() => {
              setResolvedURL(undefined);
              setFailed(true);
            }}
          />
        )}
      </Show>
    </div>
  </section>
  );
};
