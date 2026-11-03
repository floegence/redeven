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
  let text!: HTMLSpanElement;
  let revision = 0;
  let pending = false;
  const [motion, setMotion] = createSignal<Animation>();
  const finishMotion = () => {
    revision++;
    pending = false;
    untrack(motion)?.cancel();
    setMotion(undefined);
  };
  // Keep one complete, readable label. Motion only softens its contrast; it
  // never erases, clips, duplicates or queues text, and ticks do not replay it.
  createEffect(on(phase, (current, previous) => {
    if ((!previous && terminal()) || !['running', 'completed'].includes(current) || previous === 'reconnecting'
      || !props.animate() || props.reducedMotion() || !props.visible() || !props.connected()) { finishMotion(); return; }
    // A fast reply or rapid transition inherits the in-flight entrance. Never
    // reset visible text to transparent or queue another animation behind it.
    if (pending || untrack(motion)) return;
    pending = true;
    const request = ++revision;
    queueMicrotask(() => {
      if (request !== revision) return;
      pending = false;
      if (!text.isConnected || document.hidden || !props.animate() || props.reducedMotion()
        || !props.visible() || !props.connected() || header.contains(document.activeElement)) { finishMotion(); return; }
      const rect = text.getBoundingClientRect();
      const viewport = props.viewport()?.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom <= Math.max(0, viewport?.top ?? 0)
        || rect.top >= Math.min(window.innerHeight, viewport?.bottom ?? window.innerHeight)) { finishMotion(); return; }
      const animation = text.animate([{ opacity: previous ? 0.88 : 0.68 }, { opacity: 1 }],
        { duration: previous ? 160 : 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
      setMotion(animation);
      void animation.finished.then(() => { if (request === revision) finishMotion(); }, () => {});
    });
  }));
  createEffect(() => {
    if (motion() && (!props.animate() || props.reducedMotion() || !props.visible() || !props.connected())) finishMotion();
  });
  createEffect(() => {
    if (!motion()) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preferenceChanged = () => { if (media.matches) finishMotion(); };
    const visibilityChanged = () => { if (document.hidden) finishMotion(); };
    media.addEventListener('change', preferenceChanged);
    document.addEventListener('visibilitychange', visibilityChanged);
    onCleanup(() => {
      media.removeEventListener('change', preferenceChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
    });
  });
  onCleanup(finishMotion);
  // One JSX owner survives the non-interactive label becoming a native button.
  // Moving this node retains text identity and the active animation.
  const content = <span class="flower-turn-header-label">
    <span ref={text} class="flower-turn-header-text">
      <span class="flower-turn-header-status" aria-live={terminal() ? 'off' : 'polite'}>{status()}</span>
      <Show when={timeLabel()}><span class="flower-turn-header-time"> · {timeLabel()}</span></Show>
      <Show when={details()}><span class="flower-turn-header-details"> · {details()}</span></Show>
    </span>
  </span>;
  return <div ref={header} class="flower-turn-summary" data-flower-turn-header={props.group.turnID}
    onPointerDown={finishMotion} onFocusIn={finishMotion}>
    <Show when={props.toggleable} fallback={<div class="flower-turn-summary-label" title={timingDetail()} aria-description={timingDetail()}>
      {content}
    </div>}>
      <button type="button" class="flower-turn-summary-button" data-flower-disclosure-trigger
        aria-expanded={props.expanded} aria-controls={props.controls}
        aria-label={(props.expanded ? props.copy.collapse : props.copy.expand) + ': ' + label()}
        title={timingDetail()} aria-description={timingDetail()} onClick={event => props.onToggle(event.currentTarget)}>
        {content}<ChevronRight class="flower-turn-summary-chevron" aria-hidden="true" />
      </button>
    </Show>
  </div>;
}
