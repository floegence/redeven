import type { Component } from 'solid-js';
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { MonitorPointer, Refresh } from '@floegence/floe-webapp-core/icons';

import { FloatingWindow, SurfaceFloatingPanel } from '@floegence/floe-webapp-core/ui';

import type { FlowerActivityItem, FlowerChatMessage, FlowerComputerUserInput } from './contracts/flowerSurfaceContracts';

export type FlowerComputerStageSnapshot = Readonly<{
  item: FlowerActivityItem;
  runID?: string;
  messageStatus?: FlowerChatMessage['status'];
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
  maximize: string;
  restoreSize: string;
  zoomIn: string;
  zoomOut: string;
  restore: string;
  move: string;
  noFrame: string;
  retry: string;
  state: Readonly<Record<FlowerComputerStageSessionState, string>>;
}>;

export type FlowerComputerStageSessionState = 'running' | 'awaiting_user' | 'completed' | 'failed';

export type FlowerComputerStageProps = Readonly<{
  snapshot: FlowerComputerStageSnapshot;
  frameRef?: string;
  userFrame?: Blob;
  onInput?: (input: Omit<FlowerComputerUserInput, 'thread_id' | 'interaction_id'>) => void;
  threadID?: string;
  loadFrame?: (input: Readonly<{ thread_id: string; target_id: string; resource_ref: string; sha256: string; signal: AbortSignal }>) => Promise<Blob>;
  boundary?: HTMLElement;
  copy: FlowerComputerStageCopy;
  open: boolean;
  sessionState: FlowerComputerStageSessionState;
  restoreFocus?: HTMLElement;
  onRestore: (source: HTMLButtonElement) => void;
  onClose: () => void;
}>;

export const FlowerComputerStage: Component<FlowerComputerStageProps> = (props) => {
  const [resolvedURL, setResolvedURL] = createSignal<string>();
  const [failed, setFailed] = createSignal(false);
  const [actualSize, setActualSize] = createSignal(false);
  let frameWrap: HTMLDivElement | undefined;
  const [retry, setRetry] = createSignal(0);
  const frameRef = createMemo(() => props.frameRef || '');
  const targetID = createMemo(() => props.snapshot.targetID || '');
  const threadID = createMemo(() => props.threadID || '');
  let currentURL = '';
  let currentThread = '';
  let currentTarget = '';
  let keyboard: HTMLTextAreaElement | undefined;
  let composing = false;
  let launcher: HTMLButtonElement | undefined;
  const commitText = () => {
    if (!keyboard) return;
    const text = keyboard.value;
    keyboard.value = '';
    if (text) props.onInput?.({ action: 'type', text });
  };
  createEffect(() => {
    threadID(); targetID(); void props.onInput;
    setActualSize(false);
    composing = false;
    if (keyboard) keyboard.value = '';
  });
  createEffect(() => {
    if (!props.open || !props.restoreFocus) return;
    const frame = requestAnimationFrame(() => frameWrap?.closest('[data-floe-geometry-surface]')
      ?.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')?.focus({ preventScroll: true }));
    onCleanup(() => cancelAnimationFrame(frame));
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
    {(viewerThread) => <>
      <FloatingWindow open={props.open} onOpenChange={(open) => {
        if (!open) {
          props.onClose();
          queueMicrotask(() => {
            const source = props.restoreFocus;
            const visible = source?.isConnected && source.getClientRects().length && !source.closest('[inert], [hidden], [aria-hidden="true"]');
            (visible ? source : launcher)?.focus({ preventScroll: true });
          });
        }
      }} title={props.copy.title} draggable resizable defaultSize={{ width: 600, height: 425 }} minSize={{ width: 280, height: 200 }}
        boundary={props.boundary} compactBelow={560} viewportInsets={{ top: 12, right: 12, bottom: 12, left: 12 }}
        labels={{ close: props.copy.close, maximize: props.copy.maximize, restore: props.copy.restoreSize }}
        headerActions={<span class="flower-computer-state" data-session-state={props.sessionState}>{props.copy.state[props.sessionState]}</span>}
        footer={<Show when={!props.onInput && resolvedURL()}><button type="button" class="flower-computer-zoom" aria-pressed={actualSize()}
          onClick={() => setActualSize(value => !value)}>{actualSize() ? props.copy.zoomOut : props.copy.zoomIn}</button></Show>}
        class="flower-computer-stage">
    <div ref={frameWrap} class="flower-computer-stage-frame-wrap" data-zoomed={actualSize() ? 'true' : undefined} data-computer-viewer-thread={viewerThread} data-computer-target={targetID()}>
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
      <SurfaceFloatingPanel
        boundary={props.boundary}
        class={`flower-computer-viewer-minimized${props.open ? ' flower-computer-viewer-minimized-hidden' : ''}`}
        aria-hidden={props.open ? 'true' : undefined}
        snapToEdge
        snapPreview
        snapMotion="gentle"
        snapInset={12}
      >
        {(handle) => (
          <button
            {...handle}
            ref={launcher}
            type="button"
            class="flower-computer-stage-ball"
            data-session-state={props.sessionState}
            aria-label={props.copy.restore}
            aria-description={[props.copy.state[props.sessionState], props.copy.move].filter(Boolean).join(". ")}
            title={[props.copy.restore, props.copy.state[props.sessionState], props.copy.move].filter(Boolean).join(" — ")}
            tabIndex={props.open ? -1 : 0}
            aria-expanded={props.open}
            onClick={(event) => props.onRestore(event.currentTarget)}
          >
            <span aria-hidden="true"><MonitorPointer class="flower-computer-stage-ball-icon" size={20} /></span>
          </button>
        )}
      </SurfaceFloatingPanel>
    </>}
  </Show>
  );
};
