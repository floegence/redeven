import { COMPUTER_FRAME_RATES } from './computerViewer';
import type { Component } from 'solid-js';
import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { MonitorPointer, Refresh } from '@floegence/floe-webapp-core/icons';

import { FloatingWindow, SurfaceFloatingPanel } from '@floegence/floe-webapp-core/ui';

import type { FlowerActivityItem, FlowerChatMessage, FlowerComputerInputCommand, FlowerComputerFrameSource, FlowerSurfaceAdapter } from './contracts/flowerSurfaceContracts';

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
  frameRate: string;
  frameRateHint: string;
  receivedFrameRate: string;
  state: Readonly<Record<FlowerComputerStageSessionState, string>>;
}>;

export type FlowerComputerStageSessionState = 'running' | 'awaiting_user' | 'completed' | 'failed' | 'taking_control' | 'user_control' | 'returning_control' | 'paused';

export type FlowerComputerStageProps = Readonly<{
  snapshot: FlowerComputerStageSnapshot;
  frame?: FlowerComputerFrameSource;
  privateInteractionID?: string;
  frameRate?: number;
  receivedFrameRate?: number;
  onFrameRateChange?: (fps: number) => void;
  onFrameReady?: () => void;
  onFrameError?: () => void;
  onRetry?: () => void;
  onInput?: (input: FlowerComputerInputCommand) => void;
  threadID?: string;
  loadFrame?: FlowerSurfaceAdapter['loadComputerFrame'];
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
  let frameGeneration = 0;
  let pendingFrame: FlowerComputerFrameSource | undefined;
  let loading = false;
  let controller: AbortController | undefined;
  let currentPrivacy = '';
  let lastOfferedFrame = '';
  const pumpFrames = async () => {
    if (loading) return;
    loading = true;
    try {
      while (pendingFrame) {
        const frame = pendingFrame;
        pendingFrame = undefined;
        const generation = frameGeneration;
        const request = new AbortController();
        controller = request;
        try {
          const blob = await props.loadFrame!({ ...frame, signal: request.signal });
          if (request.signal.aborted || generation !== frameGeneration) continue;
          const nextURL = URL.createObjectURL(blob);
          const image = new Image(); image.src = nextURL;
          try { if (typeof image.decode === 'function') await image.decode(); }
          catch (error) { URL.revokeObjectURL(nextURL); throw error; }
          if (request.signal.aborted || generation !== frameGeneration) { URL.revokeObjectURL(nextURL); continue; }
          const previous = currentURL;
          currentURL = nextURL;
          setResolvedURL(nextURL); setFailed(false);
          if (previous) URL.revokeObjectURL(previous);
          props.onFrameReady?.();
        } catch {
          if (!request.signal.aborted && generation === frameGeneration && !pendingFrame) { setFailed(true); props.onFrameError?.(); }
        }
      }
    } finally { loading = false; }
  };
  onCleanup(() => {
    frameGeneration++; pendingFrame = undefined; controller?.abort();
    if (currentURL) URL.revokeObjectURL(currentURL);
  });
  createEffect(() => {
    retry();
    const thread = threadID(), target = targetID(), privacy = props.privateInteractionID ?? '';
    if (thread !== currentThread || target !== currentTarget || privacy !== currentPrivacy) {
      currentThread = thread; currentTarget = target; currentPrivacy = privacy; lastOfferedFrame = '';
      frameGeneration++; pendingFrame = undefined; controller?.abort();
      setResolvedURL(undefined);
      if (currentURL) URL.revokeObjectURL(currentURL);
      currentURL = '';
    }
    if (!props.open) { lastOfferedFrame = ''; frameGeneration++; pendingFrame = undefined; controller?.abort(); return; }
    const frame = props.frame;
    if (!frame || !props.loadFrame) { frameGeneration++; pendingFrame = undefined; controller?.abort(); return; }
    const key = JSON.stringify(frame);
    if (key === lastOfferedFrame) return;
    lastOfferedFrame = key;
    pendingFrame = frame;
    untrack(() => { void pumpFrames(); });
  });
  const retryFrames = () => {
    lastOfferedFrame = '';
    props.onRetry?.();
    setRetry(value => value + 1);
  };
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
        headerActions={<div class="flower-computer-header-actions">
          <span class="flower-computer-state" data-session-state={props.sessionState}>{props.copy.state[props.sessionState]}</span>
          <label class="flower-computer-frame-rate" title={`${props.copy.frameRateHint}\n${props.copy.receivedFrameRate.replace('{fps}', String(props.receivedFrameRate ?? 0))}`}>
            <span class="sr-only">{props.copy.frameRate}</span>
            <select aria-label={props.copy.frameRate} aria-description={`${props.copy.frameRateHint} ${props.copy.receivedFrameRate.replace('{fps}', String(props.receivedFrameRate ?? 0))}`} value={props.frameRate ?? 3} onChange={(event) => props.onFrameRateChange?.(Number(event.currentTarget.value))}
              onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              {COMPUTER_FRAME_RATES.map(fps => <option value={fps}>{fps} FPS</option>)}
            </select>
          </label>
          <Show when={props.sessionState === 'paused'}><button type="button" aria-label={props.copy.retry} title={props.copy.retry} onClick={retryFrames}><Refresh class="h-4 w-4" /></button></Show>
        </div>}
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
          <button type="button" aria-label={props.copy.retry} title={props.copy.retry} onClick={retryFrames}><Refresh class="h-5 w-5" aria-hidden="true" /></button>
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
