import { COMPUTER_FRAME_RATES } from './computerViewer';
import type { Component } from 'solid-js';
import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js';
import { Clock, MonitorPointer, Refresh } from '@floegence/floe-webapp-core/icons';

import { FloatingWindow, SurfaceFloatingPanel } from '@floegence/floe-webapp-core/ui';

import type { FlowerActivityItem, FlowerComputerInputCommand, FlowerComputerFrameSource, FlowerSurfaceAdapter } from './contracts/flowerSurfaceContracts';

export type FlowerComputerStageSnapshot = Readonly<{
  item: FlowerActivityItem;
  runID?: string;
  turnID?: string;
  targetID?: string;
  target: string;
  action: string;
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
  resumeControl: string;
  frameRate: string;
  frameRateHint: string;
  receivedFrameRate: string;
  state: Readonly<Record<FlowerComputerStageSessionState, string>>;
}>;

export type FlowerComputerStageSessionState = 'running' | 'awaiting_user' | 'completed' | 'failed' | 'taking_control' | 'user_control' | 'returning_control' | 'paused' | 'historical' | 'stopped' | 'disconnected' | 'awaiting_control';

export type FlowerComputerStageProps = Readonly<{
  snapshot: FlowerComputerStageSnapshot;
  frame?: FlowerComputerFrameSource;
  loading?: boolean;
  blocked?: boolean;
  emptyMessage?: string;
  staleLabel?: string;
  onReveal?: () => void;
  revealLabel?: string;
  retainLiveFrame?: boolean;
  privateInteractionID?: string;
  frameRate?: number;
  receivedFrameRate?: number;
  onFrameRateChange?: (fps: number) => void;
  onFrameReady?: (frame: FlowerComputerFrameSource) => void;
  historical?: boolean;
  onFrameError?: () => void;
  onRetry?: () => void;
  onInput?: (input: FlowerComputerInputCommand) => void;
  threadID?: string;
  loadFrame?: FlowerSurfaceAdapter['loadComputerFrame'];
  boundary?: HTMLElement;
  launcherBoundary?: HTMLElement;
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
  let currentFrame: FlowerComputerFrameSource | undefined;
  let currentThread = '';
  let currentTarget = '';
  let currentRun = '';
  const [decoding, setDecoding] = createSignal(false);
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
    loading = true; setDecoding(true);
    try {
      while (pendingFrame) {
        const frame = pendingFrame;
        pendingFrame = undefined;
        const generation = frameGeneration;
        const request = new AbortController();
        controller = request;
        const timeout = setTimeout(() => {
          if (generation !== frameGeneration) return;
          request.abort(); setFailed(true); props.onFrameError?.();
        }, 10000);
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
          currentFrame = frame;
          setResolvedURL(nextURL); setFailed(false);
          if (previous) URL.revokeObjectURL(previous);
          props.onFrameReady?.(frame);
        } catch {
          if (!request.signal.aborted && generation === frameGeneration && !pendingFrame) { setFailed(true); props.onFrameError?.(); }
        } finally { clearTimeout(timeout); }
      }
    } finally { loading = false; setDecoding(false); }
  };
  onCleanup(() => {
    frameGeneration++; pendingFrame = undefined; controller?.abort();
    if (currentURL) URL.revokeObjectURL(currentURL);
  });
  createEffect(() => {
    retry();
    const thread = threadID(), target = targetID(), run = props.snapshot.runID ?? '', privacy = props.blocked ? 'blocked' : props.privateInteractionID ?? '';
    if (thread !== currentThread || target !== currentTarget || run !== currentRun || privacy !== currentPrivacy) {
      currentThread = thread; currentTarget = target; currentRun = run; currentPrivacy = privacy; lastOfferedFrame = '';
      currentFrame = undefined;
      frameGeneration++; pendingFrame = undefined; controller?.abort();
      setResolvedURL(undefined); setFailed(false);
      if (currentURL) URL.revokeObjectURL(currentURL);
      currentURL = '';
    }
    if (props.blocked) { setFailed(false); return; }
    if (!props.open) { currentFrame = undefined; lastOfferedFrame = ''; frameGeneration++; pendingFrame = undefined; controller?.abort(); return; }
    const frame = props.frame;
    if (!frame || !props.loadFrame) { frameGeneration++; pendingFrame = undefined; controller?.abort(); return; }
    // Retired live references cannot be loaded again, but their decoded public
    // pixels remain valid until the viewer closes. Do not rewind them to an
    // earlier model keyframe merely because the task completed.
    if (props.retainLiveFrame && !privacy && currentURL && currentFrame && !currentFrame.private_frame
      && currentFrame.viewer_revision !== undefined && !frame.private_frame && frame.viewer_revision === undefined) {
      frameGeneration++; pendingFrame = undefined; controller?.abort(); return;
    }
    const key = JSON.stringify(frame);
    if (key === lastOfferedFrame) return;
    lastOfferedFrame = key;
    pendingFrame = frame;
    untrack(() => { void pumpFrames(); });
  });
  const retryFrames = () => {
    lastOfferedFrame = ''; setFailed(false);
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
      }} title={props.snapshot.target ? `${props.copy.title} · ${props.snapshot.target}` : props.copy.title} draggable resizable defaultSize={{ width: 600, height: 425 }} minSize={{ width: 280, height: 200 }}
        boundary={props.boundary} compactBelow={560} viewportInsets={{ top: 12, right: 12, bottom: 12, left: 12 }}
        labels={{ close: props.copy.close, maximize: props.copy.maximize, restore: props.copy.restoreSize }}
        headerActions={<div class="flower-computer-header-actions">
          <Show when={props.onReveal}><button type="button" title={props.revealLabel} aria-label={props.revealLabel} onClick={() => props.onReveal?.()}><MonitorPointer class="h-4 w-4" /></button></Show>
          <Show when={props.sessionState !== 'historical'}><span class="flower-computer-state" data-session-state={props.sessionState}>{props.copy.state[props.sessionState]}</span></Show>
          <Show when={!props.historical}><label class="flower-computer-frame-rate" title={`${props.copy.frameRateHint}\n${props.copy.receivedFrameRate.replace('{fps}', String(props.receivedFrameRate ?? 0))}`}>
            <span class="sr-only">{props.copy.frameRate}</span>
            <select aria-label={props.copy.frameRate} aria-description={`${props.copy.frameRateHint} ${props.copy.receivedFrameRate.replace('{fps}', String(props.receivedFrameRate ?? 0))}`} value={props.frameRate ?? 3} onChange={(event) => props.onFrameRateChange?.(Number(event.currentTarget.value))}
              onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              {COMPUTER_FRAME_RATES.map(fps => <option value={fps}>{fps} FPS</option>)}
            </select>
          </label></Show>
          <Show when={props.sessionState === 'paused' || props.sessionState === 'disconnected'}><button type="button" aria-label={props.sessionState === 'disconnected' ? props.copy.resumeControl : props.copy.retry} title={props.sessionState === 'disconnected' ? props.copy.resumeControl : props.copy.retry} onClick={retryFrames}><Refresh class="h-4 w-4" /></button></Show>
        </div>}
        footer={<Show when={resolvedURL() && (props.staleLabel || !props.onInput)}>
          <div class="flower-computer-viewer-toolbar">
            <Show when={props.staleLabel}><span class="flower-computer-frame-notice" role="status">
              <Clock size={13} aria-hidden="true" /><span>{props.staleLabel}</span>
            </span></Show>
            <Show when={!props.onInput}><div class="flower-computer-zoom-options">
              <button type="button" class="flower-computer-zoom" aria-pressed={!actualSize()} onClick={() => setActualSize(false)}>{props.copy.zoomOut}</button>
              <button type="button" class="flower-computer-zoom" aria-pressed={actualSize()} onClick={() => setActualSize(true)}>{props.copy.zoomIn}</button>
            </div></Show>
          </div>
        </Show>}
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
        <p role="status">{props.emptyMessage || props.copy.noFrame}</p>
        <Show when={!props.blocked && (props.loading || decoding()) && !failed()}><Refresh class="h-5 w-5 animate-spin" aria-hidden="true" /></Show>
        <Show when={failed()}>
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
      <Show when={!props.historical}><SurfaceFloatingPanel
        boundary={props.launcherBoundary}
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
            data-floe-progress-shimmer={props.sessionState === 'running' && !props.open ? 'surface' : undefined}
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
      </SurfaceFloatingPanel></Show>
    </>}
  </Show>
  );
};
