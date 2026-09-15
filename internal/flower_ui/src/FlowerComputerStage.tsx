import type { Component } from 'solid-js';
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { GripVertical, Minus, Refresh, XCircle } from '@floegence/floe-webapp-core/icons';

import { FloatingWindow, SurfaceFloatingPanel } from '@floegence/floe-webapp-core/ui';

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
  minimize: string;
  restore: string;
  move: string;
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
  const [minimized, setMinimized] = createSignal(false);
  let launcher: HTMLButtonElement | undefined;
  let grip: HTMLButtonElement | undefined;
  const minimize = () => {
    composing = false;
    if (keyboard) { keyboard.value = ''; keyboard.blur(); }
    setMinimized(true); queueMicrotask(() => launcher?.focus({ preventScroll: true })); };
  const restore = () => { setMinimized(false); queueMicrotask(() => grip?.focus({ preventScroll: true })); };
  const [resolvedURL, setResolvedURL] = createSignal<string>();
  const [failed, setFailed] = createSignal(false);
  const [retry, setRetry] = createSignal(0);
  const frameRef = createMemo(() => props.frameRef || '');
  const targetID = createMemo(() => props.snapshot.targetID || '');
  const threadID = createMemo(() => props.threadID || '');
  createEffect(() => { threadID(); setMinimized(false); });
  let currentURL = '';
  let currentThread = '';
  let currentTarget = '';
  let keyboard: HTMLTextAreaElement | undefined;
  let composing = false;
  const commitText = () => {
    if (!keyboard) return;
    const text = keyboard.value;
    keyboard.value = '';
    if (text) props.onInput?.({ action: 'type', text });
  };
  createEffect(() => {
    threadID(); targetID(); void props.onInput;
    composing = false;
    if (keyboard) keyboard.value = '';
  });
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
  <Show when={threadID() || 'computer-viewer'} keyed>
    {(viewerThread) => <SurfaceFloatingPanel data-computer-viewer-thread={viewerThread} class={`flower-computer-viewer${minimized() ? ' flower-computer-viewer-minimized' : ''}`}>
      {(handle) => <Show when={!minimized()} fallback={
        <button {...handle} ref={launcher} type="button" class="flower-computer-stage-ball"
          aria-label={props.copy.restore} title={props.copy.restore} onClick={restore}>
          <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <path d="M6.5 8h5" />
            <rect x="11" y="11" width="7" height="6" rx="1" fill="currentColor" fill-opacity="0.16" />
          </svg>
        </button>
      }>
  <FloatingWindow open={true} onOpenChange={(open) => { if (!open) props.onClose(); }} title={props.copy.title} draggable resizable={false} class="flower-computer-stage" headerActions={<><button type="button" class="flower-computer-stage-minimize" aria-label={props.copy.minimize} title={props.copy.minimize} onClick={minimize}><Minus class="h-4 w-4" aria-hidden="true" /></button><button type="button" class="flower-computer-stage-close" aria-label={props.copy.close} title={props.copy.close} onClick={props.onClose}><XCircle class="h-4 w-4" aria-hidden="true" /></button></>}>
    <div class="flower-computer-stage-frame-wrap">
      <Show when={props.onInput}>
        <textarea
          ref={keyboard}
          class="sr-only"
          tabIndex={-1}
          aria-label={props.copy.title}
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          onCompositionStart={() => { composing = true; }}
          onCompositionEnd={() => { composing = false; commitText(); }}
          onInput={(event) => { if (!composing && !event.isComposing) commitText(); }}
          onBlur={() => { composing = false; if (keyboard) keyboard.value = ''; }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (composing || event.isComposing || event.keyCode === 229 || ['Process', 'Dead', 'Unidentified', 'Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return;
            // Native editing owns text, paste and IME. Only non-text commands
            // cross the key path; this avoids sending a composition twice.
            if ((event.key.length === 1 && ((!event.metaKey && !event.ctrlKey && !event.altKey) || event.getModifierState('AltGraph')))
              || ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'v')
              || (event.shiftKey && event.key === 'Insert')) return;
            event.preventDefault();
            props.onInput?.({ action: 'key', key: [event.metaKey ? 'Meta' : '', event.ctrlKey ? 'Control' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.key].filter(Boolean).join('+') });
          }}
        />
      </Show>
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
            onFocus={() => keyboard?.focus({ preventScroll: true })}
            style={props.onInput ? { cursor: 'crosshair' } : undefined}
            draggable={false}
            onClick={(event) => {
              if (!props.onInput) return;
              const img = event.currentTarget;
              keyboard?.focus({ preventScroll: true });
              const rect = img.getBoundingClientRect();
              const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
              const x = (event.clientX - rect.left - (rect.width - img.naturalWidth * scale) / 2) / scale;
              const y = (event.clientY - rect.top - (rect.height - img.naturalHeight * scale) / 2) / scale;
              if (x >= 0 && y >= 0 && x < img.naturalWidth && y < img.naturalHeight) props.onInput({ action: 'click', x, y });
            }}
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
  </FloatingWindow>
      </Show>}
    </SurfaceFloatingPanel>}
  </Show>
  );
};
