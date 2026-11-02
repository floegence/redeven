import { Show, createEffect, createMemo, createSignal, on, onCleanup, untrack, type Accessor } from 'solid-js';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import type { FlowerThreadStatus } from './contracts/flowerSurfaceContracts';
import type { FlowerTurnProcessCopy } from './copy';
import { flowerDurationParts, type FlowerTurnProcess } from './flowerTurnPresentation';
import { flowerTurnElapsedMS, type FlowerTurnClockSample } from './flowerTurnClock';

export function FlowerTurnHeader(props: Readonly<{
  group: FlowerTurnProcess;
  status?: FlowerThreadStatus;
  sample?: FlowerTurnClockSample;
  tick: Accessor<number>;
  visible: Accessor<boolean>;
  connected: Accessor<boolean>;
  animate: Accessor<boolean>;
  reducedMotion: Accessor<boolean>;
  viewport: () => HTMLElement | undefined;
  toggleable: boolean;
  expanded: boolean;
  controls: string;
  copy: FlowerTurnProcessCopy;
  onToggle: (button: HTMLButtonElement) => void;
}>) {
  let header!: HTMLDivElement;
  const [onScreen, setOnScreen] = createSignal(false);
  const terminal = createMemo(() => Boolean(props.group.turn?.outcome && props.group.turn?.ended_at));
  createEffect(() => {
    if (terminal() || !props.visible()) { setOnScreen(false); return; }
    const observer = new IntersectionObserver(records => setOnScreen(records[0].isIntersecting), { root: props.viewport() });
    observer.observe(header);
    onCleanup(() => observer.disconnect());
  });
  const duration = (ms: number) => {
    const parts = flowerDurationParts(ms);
    return parts.length ? parts.map(part => props.copy[part.unit](part.count)).join(' ') : props.copy.lessThanSecond;
  };
  // Only this text memo subscribes to the shared tick. History, projections and
  // disclosure never observe time. Hidden or settled headers unsubscribe.
  const elapsed = createMemo(() => {
    if (terminal()) return props.group.turn!.elapsed_ms;
    if (!props.status || !props.sample) return undefined;
    if (props.visible() && onScreen() && props.connected()) props.tick();
    return flowerTurnElapsedMS(props.group.turn, props.sample, performance.now());
  });
  const phase = createMemo(() => {
    const outcome = props.group.turn?.outcome;
    if (terminal()) return outcome!;
    if (!props.connected()) return 'reconnecting';
    return props.status === 'waiting_user' || props.status === 'waiting_approval' ? props.status : 'running';
  });
  const status = () => {
    const outcome = phase();
    if (terminal()) return outcome === 'completed' ? props.copy.completed
      : outcome === 'failed' ? props.copy.failedShort : outcome === 'cancelled' ? props.copy.cancelled : props.copy.interruptedShort;
    if (outcome === 'reconnecting') return props.copy.reconnecting;
    return outcome === 'waiting_user' ? props.copy.waitingUser
      : outcome === 'waiting_approval' ? props.copy.waitingApproval : props.copy.inProgress;
  };
  const timeLabel = () => elapsed() === undefined ? '' : terminal() ? props.copy.total(duration(elapsed()!)) : props.copy.elapsed(duration(elapsed()!));
  const details = () => {
    const current = props.group;
    if (!terminal() || !current.countsComplete) return '';
    return (current.interleavedInputs ? [
      current.toolCallCount ? props.copy.toolCalls(current.toolCallCount) : '',
      current.inputResponseCount ? props.copy.userResponses(current.inputResponseCount) : '',
      current.failedCallCount ? props.copy.failedCalls(current.failedCallCount) : '',
      current.parentEventCount ? props.copy.subtaskUpdates(current.parentEventCount) : '',
    ] : current.parentEventCount ? [props.copy.subtaskUpdates(current.parentEventCount)] : []).filter(Boolean).join(' · ');
  };
  const label = () => [status(), timeLabel(), details()].filter(Boolean).join(' · ');
  const timingDetail = () => terminal() ? props.copy.timingDetail(duration(props.group.turn!.work_duration_ms), duration(props.group.turn!.waiting_ms)) : undefined;
  let text: HTMLSpanElement | undefined;
  let revision = 0;
  const [reveal, setReveal] = createSignal<Animation>();
  const finishReveal = () => {
    revision++;
    untrack(reveal)?.cancel();
    setReveal(undefined);
  };
  // Paint complete text progressively; never enqueue characters or subscribe
  // motion to elapsed ticks. Restored history and urgent states stay immediate.
  createEffect(on(phase, (current, previous) => {
    finishReveal();
    if ((!previous && terminal()) || !['running', 'completed'].includes(current) || previous === 'reconnecting') return;
    if (!props.animate() || props.reducedMotion() || !props.visible() || !props.connected()) return;
    const pending = revision;
    queueMicrotask(() => {
      if (pending !== revision || !text?.isConnected || document.hidden || !props.animate()
        || props.reducedMotion() || !props.visible() || !props.connected() || header.contains(document.activeElement)) return;
      const rect = text.getBoundingClientRect();
      const viewport = props.viewport()?.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom <= Math.max(0, viewport?.top ?? 0)
        || rect.top >= Math.min(window.innerHeight, viewport?.bottom ?? window.innerHeight)) return;
      const steps = Math.max(8, Math.min(36, [...(text.textContent ?? '')].length));
      const animation = text.animate([
        { clipPath: 'inset(0 100% 0 0)', opacity: 0.55 },
        { clipPath: 'inset(0 0% 0 0)', opacity: 1 },
      ], { duration: Math.min(360, 120 + steps * 7), easing: 'steps(' + steps + ', end)' });
      setReveal(animation);
      void animation.finished.then(() => { if (untrack(reveal) === animation) finishReveal(); }, () => {});
    });
  }));
  createEffect(() => {
    if (reveal() && (!props.animate() || props.reducedMotion() || !props.visible() || !props.connected())) finishReveal();
  });
  createEffect(() => {
    if (!reveal()) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preferenceChanged = () => { if (media.matches) finishReveal(); };
    const visibilityChanged = () => { if (document.hidden) finishReveal(); };
    media.addEventListener('change', preferenceChanged);
    document.addEventListener('visibilitychange', visibilityChanged);
    onCleanup(() => {
      media.removeEventListener('change', preferenceChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
    });
  });
  onCleanup(finishReveal);
  const bindText = (node: HTMLSpanElement) => {
    text = node;
    // Terminal disclosure may replace the label's wrapper in the same update.
    // Retain the existing reveal timing when the real text node changes owner.
    const animation = untrack(reveal);
    if (animation?.effect) (animation.effect as KeyframeEffect).target = node;
  };
  const Label = () => <span class="flower-turn-header-label">
    <span ref={bindText} class="flower-turn-header-text">
      <span class="flower-turn-header-status" aria-live={terminal() ? 'off' : 'polite'}>{status()}</span>
      <Show when={timeLabel()}><span class="flower-turn-header-time"> · {timeLabel()}</span></Show>
      <Show when={details()}><span class="flower-turn-header-details"> · {details()}</span></Show>
    </span>
  </span>;
  return <div ref={header} class="flower-turn-summary" data-flower-turn-header={props.group.turnID}
    onPointerDown={finishReveal} onFocusIn={finishReveal}>
    <Show when={props.toggleable} fallback={<div class="flower-turn-summary-label" title={timingDetail()} aria-description={timingDetail()}>
      <Label />
    </div>}>
      <button type="button" class="flower-turn-summary-button" data-flower-disclosure-trigger
        aria-expanded={props.expanded} aria-controls={props.controls}
        aria-label={(props.expanded ? props.copy.collapse : props.copy.expand) + ': ' + label()}
        title={timingDetail()} aria-description={timingDetail()} onClick={event => props.onToggle(event.currentTarget)}>
        <Label /><ChevronRight class="flower-turn-summary-chevron" aria-hidden="true" />
      </button>
    </Show>
  </div>;
}
