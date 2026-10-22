import { Show, createContext, createMemo, onCleanup, untrack, useContext, type Accessor, type JSX } from 'solid-js';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import type { FlowerTurnProcessCopy } from './copy';
import type { FlowerToolSequence, FlowerToolSequenceProjection } from './flowerToolSequences';
import { createFlowerActivityDisclosureMotion } from './activityDisclosure';

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
}>>();

export function useFlowerToolSequenceMember(key: Accessor<string>) {
  const context = useContext(FlowerToolSequenceContext);
  return createMemo(() => context?.projection().members.get(key()));
}

export function FlowerToolSequenceNode(props: Readonly<{ nodeKey: string; children: JSX.Element }>) {
  const context = useContext(FlowerToolSequenceContext);
  const member = useFlowerToolSequenceMember(() => props.nodeKey);
  const first = () => member()?.first;
  const last = () => member()?.last;
  const expanded = createMemo(() => !member() || !context || context.expanded(member()!.group));
  let trigger: HTMLButtonElement | undefined;
  let content: HTMLDivElement | undefined;
  const motionKey = `tools:${props.nodeKey}`;
  const motion = createFlowerActivityDisclosureMotion(expanded, {
    initialOpen: untrack(expanded), reducedMotion: context?.reducedMotion,
    onLayoutFrame: () => context?.onLayoutFrame(motionKey, motion.state() === 'opening' || motion.state() === 'closing'),
    onMotionEnd: () => context?.onMotionEnd(motionKey),
    onBeforeClose: () => {
      if (content?.contains(document.activeElement)) trigger?.focus({ preventScroll: true });
    },
  });
  onCleanup(() => context?.onMotionEnd(motionKey));
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
  // Keep the existing row mounted during classification. No row is reparented
  // when a trailing thought becomes bounded by the next invocation.
  return <div class="flower-tool-sequence-node" data-flower-tool-row-identity={props.nodeKey}
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
      <div class="flower-tool-sequence-content" ref={node => { content = node; motion.bindContent(node); }}>
        {props.children}
      </div>
    </div>
  </div>;
}
