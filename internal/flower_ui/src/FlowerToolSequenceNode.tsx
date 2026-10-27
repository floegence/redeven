import { Show, createContext, createEffect, createMemo, createSignal, onCleanup, onMount, untrack, useContext, type Accessor, type JSX } from 'solid-js';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import type { FlowerTurnProcessCopy } from './copy';
import type { FlowerToolSequence, FlowerToolSequenceProjection } from './flowerToolSequences';
import { createFlowerActivityDisclosureMotion } from './activityDisclosure';
import type { FlowerToolSequenceElement } from './flowerToolSequenceLayout';
import { createFlowerScrollTailController } from './flowerScrollTail';

export const FlowerToolSequenceContext = createContext<Readonly<{
  projection: Accessor<FlowerToolSequenceProjection>;
  manuallyExpanded: (group: FlowerToolSequence) => boolean;
  manuallyControlled: (group: FlowerToolSequence) => boolean;
  expanded: (group: FlowerToolSequence) => boolean;
  toggle: (group: FlowerToolSequence, button: HTMLButtonElement) => void;
  contentID: (key: string) => string;
  copy: Accessor<FlowerTurnProcessCopy>;
  onLayoutFrame: (key: string, moving: boolean) => void;
  onMotionEnd: (key: string) => void;
  reducedMotion: Accessor<boolean>;
  preparing: Accessor<boolean>;
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
  const scroll = createFlowerScrollTailController({
    preparing: () => context?.preparing() || motion.state() === 'opening',
    reducedMotionPreferred: () => context?.reducedMotion() ?? false,
    requestAnimationFrame: callback => requestAnimationFrame(callback),
    cancelAnimationFrame: handle => cancelAnimationFrame(handle),
    nearBottomThreshold: 24,
    observeChildren: true,
  });
  const scrollToLatest = () => scroll.flushLayout(false);
  const prepareArrival = () => scroll.prepareArrival();
  const prepareDestination = () => {
    if (!first() || !expanded()) return true;
    if (!body.isConnected || body.clientHeight <= 0) return false;
    scroll.scrollToBottom();
    return motion.state() === 'open';
  };
  onCleanup(() => scroll.dispose());
  const motionKey = `tools:${props.nodeKey}`;
  const motion = createFlowerActivityDisclosureMotion(expanded, {
    initialOpen: untrack(expanded), reducedMotion: () => Boolean(context?.preparing() || context?.reducedMotion()),
    animateClose: () => !member() || !context || context.manuallyControlled(member()!.group),
    onLayoutFrame: () => {
      if (first() && expanded() && scroll.followingLatest()) scrollToLatest();
      context?.onLayoutFrame(motionKey, motion.state() === 'opening' || motion.state() === 'closing');
    },
    onMotionEnd: () => {
      if (first() && expanded() && scroll.followingLatest()) scrollToLatest();
      context?.onMotionEnd(motionKey);
    },
    onBeforeClose: () => {
      if (content?.contains(document.activeElement)) trigger?.focus({ preventScroll: true });
    },
  });
  onCleanup(() => context?.onMotionEnd(motionKey));
  onMount(() => {
    const unregister = context?.register(props.nodeKey, { node, slot, body, prepareArrival, prepareDestination });
    onCleanup(() => unregister?.());
  });
  createEffect(() => {
    if (!first() || !expanded()) return;
    untrack(() => scroll.bind(body));
    const onScroll = () => { scroll.onScroll(); };
    body.addEventListener('scroll', onScroll);
    body.addEventListener('wheel', scroll.onWheel, { passive: true });
    body.addEventListener('pointerdown', scroll.onPointerDown);
    body.addEventListener('touchmove', scroll.onTouchMove, { passive: true });
    body.addEventListener('keydown', scroll.onKeyDown);
    // Placement completes in the same microtask checkpoint, before first paint.
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) scroll.scrollToBottom(); });
    onCleanup(() => {
      cancelled = true;
      body.removeEventListener('scroll', onScroll);
      body.removeEventListener('wheel', scroll.onWheel);
      body.removeEventListener('pointerdown', scroll.onPointerDown);
      body.removeEventListener('touchmove', scroll.onTouchMove);
      body.removeEventListener('keydown', scroll.onKeyDown);
      scroll.bind(undefined);
    });
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
  const currentLabel = () => !expanded() && member()?.group.disclosure === 'manual' ? member()?.group.latestToolLabel : undefined;
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
        aria-label={`${expanded() ? context!.copy().collapseTools : context!.copy().expandTools}: ${[label(), currentLabel()].filter(Boolean).join(' · ')}`}
        onClick={event => context!.toggle(member()!.group, event.currentTarget)}>
        <ChevronRight class="flower-tool-sequence-chevron" aria-hidden="true" />
        <span class="flower-tool-sequence-label">
          <Show when={member()!.group.toolCount}>{count => <span>{context!.copy().toolCalls(count())}</span>}</Show>
          <Show when={member()!.group.failedCount}>{count => <span class="flower-tool-sequence-failures">{context!.copy().failedCalls(count())}</span>}</Show>
          <Show when={member()!.group.failedSubagentEventCount}>{count => <span class="flower-tool-sequence-subagent-failures">{context!.copy().failedSubtaskUpdates(count())}</span>}</Show>
          <Show when={member()!.group.thinkingCount}>{count => <span class="flower-tool-sequence-thinking">{context!.copy().thinkingSegments(count())}</span>}</Show>
          <Show when={member()!.group.subagentEventCount}>{count => <span class="flower-tool-sequence-subtasks">{context!.copy().subtaskUpdates(count())}</span>}</Show>
        </span>
        <Show when={currentLabel()}>
          {label => <span class="flower-tool-sequence-current" title={label()}>{label()}</span>}
        </Show>
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
        data-flower-reading-paused={first() && !scroll.followingLatest() ? '' : undefined}>
        <div class="flower-tool-sequence-content" ref={content}>
          <Show when={contentMounted()}>{props.children}</Show>
        </div>
      </div>
    </div>
  </div></div>;
}
