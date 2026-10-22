import { For, Show, createEffect, createMemo, onCleanup, onMount, untrack, type Accessor, type JSX } from 'solid-js';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import type { FlowerTurnProcessCopy } from './copy';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerScrollTailController } from './flowerScrollTail';
import type { FlowerTurnDisclosureStore } from './flowerTurnDisclosure';
import { FlowerToolSequenceContext, FlowerToolSequenceNode } from './FlowerToolSequenceNode';
import { projectFlowerToolSequences, type FlowerToolSequence, type FlowerToolSequenceProjection } from './flowerToolSequences';
import { createFlowerActivityDisclosureMotion } from './activityDisclosure';
import { createFlowerToolSequenceLayout } from './flowerToolSequenceLayout';
import { flowerDurationParts, projectFlowerTurnProcess, type FlowerTurnProcessProjection } from './flowerTurnPresentation';

export function FlowerTurnTimeline(props: Readonly<{
  thread: FlowerThreadSnapshot | null | undefined;
  entries: readonly FlowerTimelineEntry[];
  failureNoticeVisible: boolean;
  runtimeID: string;
  scope: string;
  choices: FlowerTurnDisclosureStore;
  scroll: FlowerScrollTailController;
  reducedMotion: Accessor<boolean>;
  copy: FlowerTurnProcessCopy;
  renderEntry: (entry: Accessor<FlowerTimelineEntry>, visible: Accessor<boolean>) => JSX.Element;
}>) {
  const keys = createMemo(() => props.entries.map((entry) => JSON.stringify([props.thread?.thread_id, entry.key])));
  const entries = createMemo(() => new Map(props.entries.map((entry) => [entry.key, entry])));
  const failureTurnID = createMemo(() => props.failureNoticeVisible
    ? props.thread?.turns?.at(-1)?.turn_id : undefined);
  const nodes = new Map<string, HTMLElement>();
  let timeline!: HTMLDivElement;
  onMount(() => {
    const viewport = props.scroll.viewport();
    if (!viewport) return;
    const measure = () => timeline.style.setProperty('--flower-detail-available-height', `${viewport.clientHeight * 0.65}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    measure();
    onCleanup(() => observer.disconnect());
  });
  const motions = new Set<string>();
  let layoutAnchor: HTMLElement | undefined;
  let gestureTarget: Element | undefined;
  let gestureFrame: number | undefined;
  let menuOwner: string | undefined;
  const identity = (turnID: string) => JSON.stringify([props.runtimeID, props.thread?.thread_id, turnID]);
  const contentID = (key: string) => `flower-process-${encodeURIComponent(`${props.scope}:${props.thread?.thread_id}:${key}`)}`;
  const duration = (ms: number) => {
    const parts = flowerDurationParts(ms);
    return parts.length ? parts.map((part) => props.copy[part.unit](part.count)).join(' ') : props.copy.lessThanSecond;
  };
  const startGesture = (target: Element) => {
    if (gestureFrame !== undefined) cancelAnimationFrame(gestureFrame);
    gestureFrame = undefined;
    gestureTarget = target;
  };
  // Pointer release precedes the associated native click. Keep its owner
  // protected through that dispatch, then clear it on the next layout frame.
  const releaseGesture = () => {
    if (gestureFrame !== undefined) cancelAnimationFrame(gestureFrame);
    gestureFrame = requestAnimationFrame(() => { gestureTarget = undefined; gestureFrame = undefined; });
  };
  document.addEventListener('pointerup', releaseGesture, true);
  document.addEventListener('pointercancel', releaseGesture, true);
  document.addEventListener('keyup', releaseGesture, true);
  window.addEventListener('blur', releaseGesture);
  onCleanup(() => {
    document.removeEventListener('pointerup', releaseGesture, true);
    document.removeEventListener('pointercancel', releaseGesture, true);
    document.removeEventListener('keyup', releaseGesture, true);
    window.removeEventListener('blur', releaseGesture);
    if (gestureFrame !== undefined) cancelAnimationFrame(gestureFrame);
    if (layoutAnchor) props.scroll.releaseDisclosure(layoutAnchor);
  });

  const inspectionProtected = (turnID: string, processKeys: readonly string[], protectThinking = false, inspectedNodes?: readonly HTMLElement[]) => {
    const viewport = props.scroll.viewport();
    const visible = viewport?.getBoundingClientRect();
    const selection = document.getSelection();
    return (inspectedNodes ?? processKeys.map(key => nodes.get(key))).some((row) => {
      if (!row) return false;
      if (row.contains(document.activeElement) || gestureTarget && row.contains(gestureTarget)) return true;
      if (menuOwner === turnID && document.querySelector('[role="menu"]')) return true;
      if (row.querySelector('details[open]')) return true;
      if (row.querySelector('[data-flower-reading-paused]')) return true;
      for (const button of row.querySelectorAll('[aria-expanded="true"]')) {
        if (button.closest('.flower-thinking-disclosure') && (!protectThinking || button.getAttribute('data-flower-manual-open') !== 'true')) continue;
        if (button.matches('.flower-tool-sequence-toggle') && button.getAttribute('data-flower-manual-open') !== 'true') continue;
        if (button.matches('.flower-activity-inline-button') && button.getAttribute('data-flower-manual-open') !== 'true') continue;
        return true;
      }
      if (selection && !selection.isCollapsed) {
        for (let i = 0; i < selection.rangeCount; i += 1) {
          if (selection.getRangeAt(i).intersectsNode(row)) return true;
        }
      }
      const rect = row.getBoundingClientRect();
      return !props.scroll.followingLatest() && Boolean(visible && rect.bottom > visible.top && rect.top < visible.bottom);
    });
  };
  const preserveReadingAnchor = (processKeys: readonly string[]) => {
    if (props.scroll.followingLatest()) return;
    const bounds = props.scroll.viewport()?.getBoundingClientRect();
    if (!bounds) return;
    const hidden = new Set(processKeys);
    for (const [key, row] of nodes) {
      const rect = row.getBoundingClientRect();
      if (!hidden.has(key) && rect.bottom > bounds.top && rect.top < bounds.bottom) {
        layoutAnchor = row;
        props.scroll.preserveLayoutAnchor(row);
        return;
      }
    }
  };
  let previousProjection: { threadID?: string; value: FlowerTurnProcessProjection } | undefined;
  const processes = createMemo(() => {
    const threadID = props.thread?.thread_id;
    const value = projectFlowerTurnProcess(props.entries, props.thread?.turns,
      props.thread?.current_execution && ['running', 'waiting_user', 'waiting_approval'].includes(props.thread.status)
        ? [props.thread.current_execution.turn_id] : [], previousProjection && previousProjection.threadID === threadID ? previousProjection.value : undefined);
    // Protect newly classified process before any row can become inert or hidden.
    const previous = previousProjection;
    if (previous && previous.threadID === threadID) untrack(() => {
      for (const group of value.groups.values()) {
        if (group.staticOverview && !previous.value.groups.get(group.turnID)?.staticOverview) {
          preserveReadingAnchor(group.processKeys);
        }
        const newlyFoldable = group.processKeys.filter((key) => previous.value.rows.has(key)
          && !previous.value.rows.get(key)!.processKeys.includes(key));
        if (newlyFoldable.length && inspectionProtected(group.turnID, newlyFoldable)) {
          props.choices.retainExpanded(identity(group.turnID));
        }
      }
    });
    previousProjection = { threadID, value };
    return value;
  });
  const sequenceIdentity = (key: string) => JSON.stringify([props.runtimeID, props.thread?.thread_id, 'tools', key]);
  let previousSequences: { threadID?: string; value: FlowerToolSequenceProjection } | undefined;
  const sequences = createMemo(() => {
    const next = projectFlowerToolSequences(props.entries, props.thread?.thread_id, props.thread?.turns ?? []);
    const previous = previousSequences?.threadID === props.thread?.thread_id ? previousSequences?.value : undefined;
    if (previous) untrack(() => {
      for (const group of next.groups.values()) {
        const addedKeys = new Set(group.nodeKeys.filter(key => !previous.members.has(key)));
        if (!addedKeys.size) continue;
        const inspectedNodes = [...addedKeys].flatMap(key => {
          const element = sequenceLayout.element(key);
          return element ? [element] : [];
        });
        const turnID = processes().rows.get(group.entryKeys[0])?.turnID ?? '';
        if (inspectionProtected(turnID, group.entryKeys, true, inspectedNodes)) {
          props.choices.observe(sequenceIdentity(group.key), 'manual', () => false);
          props.choices.retainExpanded(sequenceIdentity(group.key));
        }
      }
    });
    previousSequences = { threadID: props.thread?.thread_id, value: next };
    return next;
  });
  const sequenceLayout = createFlowerToolSequenceLayout(sequences);
  createEffect(() => {
    const groups = processes();
    const threadID = props.thread?.thread_id;
    untrack(() => {
      if (!threadID) return;
      for (const group of groups.groups.values()) {
        // Check protection after content commits, when defaults first settle or change.
        props.choices.observe(identity(group.turnID), group.disclosure,
          () => inspectionProtected(group.turnID, group.processKeys),
          (expanded) => {
            preserveReadingAnchor(expanded ? [] : group.processKeys);
            if (expanded && layoutAnchor) {
              const anchor = layoutAnchor;
              queueMicrotask(() => {
                if (layoutAnchor !== anchor) return;
                props.scroll.finishDisclosure(anchor);
                layoutAnchor = undefined;
              });
            }
          });
      }
    });
  });

  createEffect(() => {
    const projection = sequences();
    untrack(() => {
      for (const group of projection.groups.values()) {
        const turnID = processes().rows.get(group.entryKeys[0])?.turnID ?? '';
        props.choices.observe(sequenceIdentity(group.key), group.disclosure,
          () => inspectionProtected(turnID, group.entryKeys, true),
          () => preserveReadingAnchor(group.entryKeys));
      }
    });
  });
  const finishMotion = (key: string) => {
    motions.delete(key);
    if (motions.size === 0 && layoutAnchor) {
      props.scroll.finishDisclosure(layoutAnchor);
      layoutAnchor = undefined;
    }
    props.scroll.measureAfterLayout();
  };
  const sequenceContext = {
    ...sequenceLayout,
    projection: sequences,
    expanded: (group: FlowerToolSequence) => props.choices.expanded(sequenceIdentity(group.key), group.disclosure),
    manuallyExpanded: (group: FlowerToolSequence) => props.choices.manuallyExpanded(sequenceIdentity(group.key)),
    toggle: (group: FlowerToolSequence, button: HTMLButtonElement) => {
      if (group.entryKeys.some(key => nodes.get(key)?.contains(document.activeElement))) button.focus({ preventScroll: true });
      layoutAnchor = button;
      props.scroll.activateDisclosure(button);
      props.choices.toggle(sequenceIdentity(group.key), group.disclosure);
    },
    contentID: (key: string) => `flower-tool-sequence-${encodeURIComponent(`${props.scope}:${props.thread?.thread_id}:${key}`)}`,
    onLayoutFrame: (key: string, moving: boolean) => {
      if (moving) motions.add(key);
      props.scroll.measureAfterLayout();
    },
    onMotionEnd: finishMotion,
    copy: () => props.copy,
    reducedMotion: props.reducedMotion,
  };
  const row = (key: string, entry: Accessor<FlowerTimelineEntry>) => {
    const group = createMemo(() => processes().rows.get(key));
    const process = createMemo(() => group()?.processKeys.includes(key) ?? false);
    const expanded = createMemo(() => !process() || group()?.staticOverview === true
      || props.choices.expanded(identity(group()!.turnID), group()!.disclosure));
    const ended = createMemo(() => {
      const current = group();
      const outcome = current?.turn?.outcome;
      if (current?.turnID === failureTurnID() && (outcome === 'failed' || outcome === 'interrupted')) return '';
      return current?.terminalKey === key && outcome && outcome !== 'completed' ? props.copy[outcome] : '';
    });
    // Historical rows can skip offscreen layout immediately. A row that was
    // live keeps its measured layout until the next transcript mount, so
    // completion cannot move the reading anchor before disclosure settles.
    const historical = untrack(() => Boolean(group()?.turn?.ended_at));
    const settled = createMemo(() => historical && !process());
    // Decide protection and capture the anchor before inserting summary height.
    const summary = createMemo(() => group()?.summaryKey === key && (group()?.staticOverview
      || group()?.disclosure !== 'none' && props.choices.settled(identity(group()!.turnID))));
    const summaryLabel = () => {
      const current = group()!;
      const worked = props.copy.worked(duration(current.turn!.work_duration_ms));
      const details = current.staticOverview ? [
        current.toolCallCount ? props.copy.toolCalls(current.toolCallCount) : '',
        current.inputResponseCount ? props.copy.userResponses(current.inputResponseCount) : '',
        current.failedCallCount ? props.copy.failedCalls(current.failedCallCount) : '',
        current.parentEventCount ? props.copy.subtaskUpdates(current.parentEventCount) : '',
      ].filter(Boolean) : current.parentEventCount ? [props.copy.subtaskUpdates(current.parentEventCount)] : [];
      return [worked, ...details].join(' · ');
    };
    const interactionCheckpoint = createMemo(() => {
      const current = entry();
      return group()?.staticOverview === true && current.type === 'message'
        && current.blocks.some((block) => block.type === 'input_response');
    });
    const motion = createFlowerActivityDisclosureMotion(expanded, {
      initialOpen: untrack(expanded),
      reducedMotion: props.reducedMotion,
      onLayoutFrame: () => {
        if (motion.state() === 'opening' || motion.state() === 'closing') motions.add(key);
        props.scroll.measureAfterLayout();
      },
      onMotionEnd: () => finishMotion(key),
    });
    const toggle = (button: HTMLButtonElement) => {
      const current = group();
      if (!current || current.disclosure === 'none') return;
      if (expanded()) {
        const focus = document.activeElement;
        if (current.processKeys.some((id) => focus && nodes.get(id)?.contains(focus))) button.focus({ preventScroll: true });
      }
      layoutAnchor = button;
      props.scroll.activateDisclosure(button);
      props.choices.toggle(identity(current.turnID), current.disclosure);
    };
    onCleanup(() => { nodes.delete(key); motions.delete(key); });
    // Mount only while the disclosure is visible or animating. Stable rows
    // keep their subtree until closing has finished.
    const Content = () => {
      const content = untrack(() => props.renderEntry(entry, expanded));
      return <Show when={entry().type === 'parent_event' && sequences().members.has(key)} fallback={content}>
        <FlowerToolSequenceNode nodeKey={key}>{content}</FlowerToolSequenceNode>
      </Show>;
    };
    return (
      <div class="flower-turn-row" data-flower-turn-id={group()?.turnID} data-flower-turn-process={process() ? 'true' : undefined}
        data-flower-input-checkpoint={interactionCheckpoint() ? 'true' : undefined}
        data-flower-row-message-id={entry().type === 'message' ? (entry() as Extract<FlowerTimelineEntry, { type: 'message' }>).message.id : undefined}
        data-flower-row-event-id={entry().type === 'parent_event' ? (entry() as Extract<FlowerTimelineEntry, { type: 'parent_event' }>).event.id : undefined}
        data-flower-row-decoration-id={entry().type === 'context_compaction' ? (entry() as Extract<FlowerTimelineEntry, { type: 'context_compaction' }>).decoration.decoration_id : undefined}
        data-flower-sequence-continues={sequences().continuingEntries.has(key) ? 'true' : undefined}
        data-flower-turn-settled={settled() ? 'true' : undefined}>
        <Show when={summary()}>
          <div class="flower-turn-summary" classList={{ 'flower-turn-summary-static': group()?.staticOverview === true }}>
            <Show when={group()?.staticOverview} fallback={(
              <button type="button" class="flower-turn-summary-button" data-flower-disclosure-trigger
                aria-expanded={expanded()} aria-controls={group()!.processKeys.map(contentID).join(' ')}
                aria-label={`${expanded() ? props.copy.collapse : props.copy.expand}: ${summaryLabel()}`}
                onClick={(event) => toggle(event.currentTarget)}>
                <span>{summaryLabel()}</span>
                <ChevronRight class="flower-turn-summary-chevron" aria-hidden="true" />
              </button>
            )}>
              <span class="flower-turn-overview-copy">{summaryLabel()}</span>
            </Show>
          </div>
        </Show>
        <div id={contentID(key)} class="flower-turn-row-viewport" ref={motion.bindViewport}
          data-state={motion.state()} aria-hidden={!expanded() ? 'true' : undefined} inert={!expanded()}
          style={{ height: motion.height(), display: motion.state() === 'closed' ? 'none' : undefined }}>
          <div class="flower-turn-row-content" ref={(node) => { motion.bindContent(node); nodes.set(key, node); }}
            onPointerDown={(event) => startGesture(event.target as Element)}
            onKeyDown={(event) => startGesture(event.target as Element)}
            onContextMenu={() => { menuOwner = group()?.turnID; }}>
            <Show when={motion.mounted()}><Content /></Show>
          </div>
        </div>
        <Show when={ended()}>{(label) => <div class="flower-turn-ended" role="status">{label()}</div>}</Show>
      </div>
    );
  };
  return <FlowerToolSequenceContext.Provider value={sequenceContext}><div class="flower-turn-timeline" ref={timeline}><For each={keys()}>{(token) => {
    const key = (JSON.parse(token) as [string, string])[1];
    const entry = createMemo(() => entries().get(key)!);
    return row(key, entry);
  }}</For></div></FlowerToolSequenceContext.Provider>;
}
