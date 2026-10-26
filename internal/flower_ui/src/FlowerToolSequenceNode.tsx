import { Show, createContext, createEffect, createMemo, createSignal, onCleanup, onMount, untrack, useContext, type Accessor, type JSX } from 'solid-js';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import type { FlowerTurnProcessCopy } from './copy';
import type { FlowerToolSequence, FlowerToolSequenceProjection } from './flowerToolSequences';
import { createFlowerActivityDisclosureMotion } from './activityDisclosure';
import type { FlowerToolSequenceElement } from './flowerToolSequenceLayout';
import { FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS } from './flowerScrollTail';

export const FlowerToolSequenceContext = createContext<Readonly<{
  projection: Accessor<FlowerToolSequenceProjection>;
  manuallyExpanded: (group: FlowerToolSequence) => boolean;
  expanded: (group: FlowerToolSequence) => boolean;
  toggle: (group: FlowerToolSequence, button: HTMLButtonElement) => void;
  contentID: (key: string) => string;
  copy: Accessor<FlowerTurnProcessCopy>;
  onLayoutFrame: (key: string, moving: boolean) => void;
  onMotionEnd: (key: string) => void;
  reducedMotion: Accessor<boolean>;
  register: (key: string, element: FlowerToolSequenceElement) => () => void;
}>>();

export function useFlowerToolSequenceMember(key: Accessor<string>) {
  const context = useContext(FlowerToolSequenceContext);
  return createMemo(() => context?.projection().members.get(key()));
}

export function FlowerToolSequenceNode(props: Readonly<{ nodeKey: string; children: JSX.Element }>) {
  const context = useContext(FlowerToolSequenceContext);
  const member = useFlowerToolSequenceMember(() => props.nodeKey);
  const first = createMemo(() => member()?.first);
  const last = createMemo(() => member()?.last);
  const expanded = createMemo(() => !member() || !context || context.expanded(member()!.group));
  // Unopened history needs only its disclosure shell. Once inspected, retain
  // the same subtree so folding and regrouping preserve local reading state.
  const [contentMounted, setContentMounted] = createSignal(untrack(expanded));
  createEffect(() => { if (expanded()) setContentMounted(true); });
  let trigger: HTMLButtonElement | undefined;
  let content: HTMLDivElement | undefined;
  let slot!: HTMLDivElement;
  let node!: HTMLDivElement;
  let body!: HTMLDivElement;
  let following = true;
  let previousHeight = 0;
  let previousScrollTop = 0;
  let arrivalFrame = 0;
  let arrivalMotion: { startTop: number; startedAt: number } | undefined;
  const cancelArrival = () => {
    cancelAnimationFrame(arrivalFrame);
    arrivalFrame = 0;
    arrivalMotion = undefined;
  };
  const writeScrollTop = (top: number) => {
    body.scrollTop = top;
    previousScrollTop = body.scrollTop;
  };
  const scrollToLatest = () => {
    if (!arrivalMotion) writeScrollTop(body.scrollHeight);
  };
  const prepareArrival = () => {
    if (!following || !expanded() || motion.state() !== 'open' || context?.reducedMotion() || body.scrollHeight - body.clientHeight - body.scrollTop <= 1) return 0;
    if (!arrivalMotion) {
      arrivalMotion = { startTop: body.scrollTop, startedAt: performance.now() };
      const advance = (now: number) => {
        if (!arrivalMotion) return;
        const progress = context?.reducedMotion() ? 1 : Math.min(1, Math.max(0, (now - arrivalMotion.startedAt) / FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS));
        const bottom = Math.max(0, body.scrollHeight - body.clientHeight);
        writeScrollTop(arrivalMotion.startTop + (bottom - arrivalMotion.startTop) * (1 - (1 - progress) ** 3));
        if (progress < 1) arrivalFrame = requestAnimationFrame(advance);
        else cancelArrival();
      };
      arrivalFrame = requestAnimationFrame(advance);
    }
    return FLOWER_TRANSCRIPT_SCROLL_TO_LATEST_MS;
  };
  onCleanup(cancelArrival);
  const motionKey = `tools:${props.nodeKey}`;
  const motion = createFlowerActivityDisclosureMotion(expanded, {
    initialOpen: untrack(expanded), reducedMotion: context?.reducedMotion,
    onLayoutFrame: () => {
      if (first() && expanded() && following) scrollToLatest();
      context?.onLayoutFrame(motionKey, motion.state() === 'opening' || motion.state() === 'closing');
    },
    onMotionEnd: () => {
      if (first() && expanded() && following) scrollToLatest();
      context?.onMotionEnd(motionKey);
    },
    onBeforeClose: () => {
      cancelArrival();
      if (content?.contains(document.activeElement)) trigger?.focus({ preventScroll: true });
    },
  });
  onCleanup(() => context?.onMotionEnd(motionKey));
  onMount(() => {
    const unregister = context?.register(props.nodeKey, { node, slot, body, prepareArrival });
    onCleanup(() => unregister?.());
  });
  createEffect(() => {
    if (!first() || !expanded()) return;
    // Opening is an explicit request to inspect the latest call. Position after
    // row placement, before paint; never reveal the old offset then scroll it.
    following = true;
    cancelArrival();
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      scrollToLatest();
      body.removeAttribute('data-flower-reading-paused');
    });
    onCleanup(() => { cancelled = true; });
  });
  createEffect(() => {
    if (!first() || !expanded()) return;
    const observer = new ResizeObserver(() => {
      const height = body.scrollHeight;
      if (motion.state() === 'opening' && following) {
        // Every child opens concurrently and changes the shared scroll extent.
        // Resize delivery precedes paint, so all visible opening frames stay at
        // the final call without an internal scrolling animation.
        cancelArrival();
        scrollToLatest();
      } else if (following && height > previousHeight) {
        if (context?.reducedMotion() || !member()?.group.runningCount) scrollToLatest(); else prepareArrival();
      }
      previousHeight = height;
    });
    const observe = () => {
      observer.disconnect();
      for (const child of body.children) observer.observe(child);
    };
    observe();
    const children = new MutationObserver(observe);
    children.observe(body, { childList: true });
    onCleanup(() => { observer.disconnect(); children.disconnect(); });
  });
  const label = () => {
    const group = member()!.group, copy = context!.copy();
    const summary = () => {
      const parts = [
        group.toolCount ? copy.toolCalls(group.toolCount) : '',
        group.failedCount ? copy.failedCalls(group.failedCount) : '',
        group.failedSubagentEventCount ? copy.failedSubtaskUpdates(group.failedSubagentEventCount) : '',
        group.thinkingCount ? copy.thinkingSegments(group.thinkingCount) : '',
        group.subagentEventCount ? copy.subtaskUpdates(group.subagentEventCount) : '',
      ].filter(Boolean);
      return parts.join(' · ');
    };
    return summary();
  };
  const Toggle = () => {
    let button: HTMLButtonElement;
    onCleanup(() => {
      if (button !== document.activeElement) return;
      queueMicrotask(() => {
        if (!button.isConnected && content?.isConnected) {
          content.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
        }
      });
    });
    return (
      <button ref={node => { trigger = node; button = node; }} type="button" class="flower-tool-sequence-toggle" data-flower-disclosure-trigger
        aria-expanded={expanded()} data-flower-manual-open={context!.manuallyExpanded(member()!.group) ? 'true' : undefined} aria-controls={member()!.group.nodeKeys.map(context!.contentID).join(' ')}
        aria-label={`${expanded() ? context!.copy().collapseTools : context!.copy().expandTools}: ${label()}`}
        onClick={event => context!.toggle(member()!.group, event.currentTarget)}>
        <ChevronRight class="flower-tool-sequence-chevron" aria-hidden="true" />
        <span class="flower-tool-sequence-label">
          <Show when={member()!.group.toolCount}>{count => <span>{context!.copy().toolCalls(count())}</span>}</Show>
          <Show when={member()!.group.failedCount}>{count => <span class="flower-tool-sequence-failures">{context!.copy().failedCalls(count())}</span>}</Show>
          <Show when={member()!.group.failedSubagentEventCount}>{count => <span class="flower-tool-sequence-subagent-failures">{context!.copy().failedSubtaskUpdates(count())}</span>}</Show>
          <Show when={member()!.group.thinkingCount}>{count => <span class="flower-tool-sequence-thinking">{context!.copy().thinkingSegments(count())}</span>}</Show>
          <Show when={member()!.group.subagentEventCount}>{count => <span class="flower-tool-sequence-subtasks">{context!.copy().subtaskUpdates(count())}</span>}</Show>
        </span>
        <Show when={member()!.group.runningCount}>{count => <span class="flower-tool-sequence-running">{context!.copy().runningTools(count())}</span>}</Show>
      </button>
    );
  };
  return <div class="flower-tool-sequence-slot" ref={slot}><div class="flower-tool-sequence-node" ref={node} data-flower-tool-row-identity={props.nodeKey}
    classList={{ 'flower-activity-inline': Boolean(member()) }}
    data-flower-sequence={member()?.group.key}
    data-flower-sequence-start={first() === undefined ? undefined : String(first())}
    data-flower-sequence-end={last() === undefined ? undefined : String(last())} data-state={motion.state()}>
    <Show when={member()?.first && context}>
      <Toggle />
    </Show>
    <div id={context?.contentID(props.nodeKey)} class="flower-tool-sequence-viewport" ref={motion.bindViewport}
      data-state={motion.state()} aria-hidden={!expanded() ? 'true' : undefined} inert={!expanded()}
      style={{ height: motion.height(), display: motion.state() === 'closed' ? 'none' : undefined }}>
      <div class="flower-tool-sequence-body" classList={{ 'flower-tool-sequence-scroll': Boolean(first()) }}
        ref={element => { body = element; motion.bindContent(element); }}
        tabIndex={first() && expanded() ? 0 : undefined} role={first() ? 'region' : undefined}
        aria-label={first() ? label() : undefined}
        onScroll={event => {
          if (motion.state() !== 'open') return;
          const element = event.currentTarget;
          // A queued tail-scroll event can arrive after another row is added.
          if (element.scrollTop === previousScrollTop) return;
          cancelArrival();
          previousScrollTop = element.scrollTop;
          following = element.scrollHeight - element.clientHeight - element.scrollTop <= 24;
          element.toggleAttribute('data-flower-reading-paused', !following);
        }}>
        <div class="flower-tool-sequence-content" ref={content}>
          <Show when={contentMounted()}>{props.children}</Show>
        </div>
      </div>
    </div>
  </div></div>;
}
