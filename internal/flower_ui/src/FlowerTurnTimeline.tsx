import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack, type Accessor, type JSX } from 'solid-js';
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
import { createFlowerActivityTitleReveal, FlowerActivityTitleRevealContext } from './flowerActivityTitleReveal';

type TimelineProps = Readonly<{
  thread: FlowerThreadSnapshot | null | undefined;
  entries: readonly FlowerTimelineEntry[];
  failureNoticeVisible: boolean;
  runtimeID: string;
  scope: string;
  choices: FlowerTurnDisclosureStore;
  scroll: FlowerScrollTailController;
  reducedMotion: Accessor<boolean>;
  liveConfirmed?: Accessor<boolean>;
  copy: FlowerTurnProcessCopy;
  readingBreaks?: ReadonlySet<string>;
  missingEvents?: readonly Readonly<{ after: number; before: number }>[];
  renderBefore?: (entry: Accessor<FlowerTimelineEntry>) => JSX.Element;
  renderEntry: (entry: Accessor<FlowerTimelineEntry>, visible: Accessor<boolean>) => JSX.Element;
}>;

// Each section owns only measured geometry and offscreen layout. Disclosure, grouping and
// title policy remain owned by the single timeline, including across sections.
function HistorySection(props: Readonly<{ entries: readonly FlowerTimelineEntry[]; scroll: FlowerScrollTailController; sectionKey: string; children: JSX.Element }>) {
  const [layoutVisible, setLayoutVisible] = createSignal(true);
  const [height, setHeight] = createSignal<number>();
  let shell!: HTMLDivElement;
  let content!: HTMLDivElement;
  let near = true;
  let measuredWidth = 0;
  const protectedContent = () => {
    const selection = document.getSelection();
    return shell.contains(document.activeElement) || Boolean(selection && !selection.isCollapsed
      && Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i)).some(range => range.intersectsNode(shell)));
  };
  const live = () => props.entries.some(entry => entry.type === 'message' && entry.message.live)
    || props.entries.some(entry => entry.type !== 'message' && entry.type !== 'parent_event' && entry.type !== 'context_compaction');
  const settle = () => setLayoutVisible(near || live() || protectedContent() || height() === undefined);
  createEffect(() => { void props.entries; setLayoutVisible(true); });
  onMount(() => {
    const intersection = new IntersectionObserver(records => { near = records[0].isIntersecting; settle(); },
      { root: props.scroll.viewport(), rootMargin: '1800px 0px' });
    intersection.observe(shell);
    const resize = new ResizeObserver(() => {
      if (!layoutVisible()) return;
      const rect = shell.getBoundingClientRect();
      if (rect.width > 0) { measuredWidth = rect.width; setHeight(rect.height); }
      settle();
      // ResizeObserver runs after layout and before paint. Deferring this
      // correction to another animation frame exposes one frame of jumping.
      props.scroll.flushLayout(false);
    });
    resize.observe(content);
    const width = new ResizeObserver(() => {
      if (Math.abs(shell.clientWidth - measuredWidth) > 1) setLayoutVisible(true);
    });
    width.observe(shell);
    document.addEventListener('selectionchange', settle);
    document.addEventListener('focusout', settle);
    onCleanup(() => { intersection.disconnect(); resize.disconnect(); width.disconnect();
      document.removeEventListener('selectionchange', settle); document.removeEventListener('focusout', settle); });
  });
  return <div ref={shell} data-flower-history-section={props.sectionKey} data-flower-history-mounted={layoutVisible() ? 'true' : 'false'}
    style={{ 'content-visibility': layoutVisible() ? 'visible' : 'hidden', 'contain-intrinsic-block-size': height() === undefined ? undefined : height() + 'px', 'overflow-anchor': 'none' }}>
    <div ref={content} style={{ display: 'flow-root' }}>{props.children}</div>
  </div>;
}

export function FlowerTurnTimeline(props: TimelineProps) {
  const sections = createMemo<{ key: string; threadID: string | undefined; entries: FlowerTimelineEntry[] }[]>((previous = []) => {
    const threadID = props.thread?.thread_id;
    const prior = new Map(previous.filter(section => section.threadID === threadID).map(section => [section.key, section]));
    const id = (entry: FlowerTimelineEntry) => entry.type === 'message' ? entry.message.turn_id : entry.type === 'parent_event'
      ? entry.event.parent_turn_id : entry.type === 'context_compaction' ? entry.decoration.compaction.turn_id : undefined;
    const priorByTurn = new Map<string, string>();
    const priorByEntry = new Map<string, string>();
    for (const section of prior.values()) for (const entry of section.entries) {
      const turn = id(entry);
      if (turn) priorByTurn.set(turn, section.key);
      priorByEntry.set(entry.key, section.key);
    }
    const last = new Map<string, number>();
    props.entries.forEach((entry, index) => { const turn = id(entry); if (turn) last.set(turn, index); });
    const result: { key: string; threadID: string | undefined; entries: FlowerTimelineEntry[] }[] = [];
    for (let first = 0; first < props.entries.length;) {
      let end = first;
      for (let i = first; i <= end; i++) end = Math.max(end, last.get(id(props.entries[i]) ?? '') ?? i);
      const entry = props.entries[first];
      // Retain the mounted section when a pending request gains its turn,
      // and when history prepends earlier rows into an existing turn.
      const turn = id(entry);
      const key = (turn ? priorByTurn.get(turn) : undefined) ?? priorByEntry.get(entry.key)
        ?? JSON.stringify([threadID, turn ?? entry.key]);
      const entries = props.entries.slice(first, end + 1);
      const retained = prior.get(key);
      result.push(retained && retained.entries.length === entries.length && entries.every((value, index) => value === retained.entries[index])
        ? retained : { key, threadID, entries });
      first = end + 1;
    }
    return result;
  });
  const sectionKeys = createMemo(() => sections().map(section => section.key));
  const bySection = createMemo(() => new Map(sections().map(section => [section.key, section.entries])));
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
  const [retainedRows, setRetainedRows] = createSignal<ReadonlySet<string>>(new Set());
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
    if (props.scroll.followingLatest()) { props.scroll.preserveCollapseOffset(); return; }
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
        ? [props.thread.current_execution.turn_id] : [], previousProjection && previousProjection.threadID === threadID ? previousProjection.value : undefined, {
        hasBefore: props.thread?.history_window?.has_before ?? false,
        hasAfter: props.thread?.history_window?.has_after ?? false,
        readingBreaks: props.readingBreaks, missingEvents: props.missingEvents,
      });
    // Protect newly classified process before any row can become inert or hidden.
    const previous = previousProjection;
    if (previous && previous.threadID === threadID) untrack(() => {
      for (const group of value.groups.values()) {
        const prior = previous.value.groups.get(group.turnID);
        if (prior?.summaryKey && prior.summaryKey !== group.summaryKey) {
          const button = nodes.get(prior.summaryKey)?.closest('.flower-turn-row')?.querySelector<HTMLButtonElement>('.flower-turn-summary-button');
          if (button && document.activeElement === button) {
            const top = button.getBoundingClientRect().top;
            queueMicrotask(() => {
              const next = group.summaryKey ? nodes.get(group.summaryKey)?.closest('.flower-turn-row')?.querySelector<HTMLButtonElement>('.flower-turn-summary-button') : undefined;
              if (!next?.isConnected) return;
              next.focus({ preventScroll: true });
              props.scroll.restoreReadingAnchor(next, top);
            });
          }
        }
        if (group.interleavedInputs && !previous.value.groups.get(group.turnID)?.interleavedInputs) {
          preserveReadingAnchor(group.processKeys);
        }
        const newlyFoldable = group.processKeys.filter((key) => previous.value.rows.has(key)
          && !previous.value.rows.get(key)!.processKeys.includes(key));
        if (newlyFoldable.length && inspectionProtected(group.turnID, newlyFoldable)) {
          // A newly classified row may already contain the user's selection.
          // Keep that row visible without reopening the rest of a folded turn.
          setRetainedRows(previous => new Set([...previous, ...newlyFoldable]));
        }
      }
    });
    previousProjection = { threadID, value };
    return value;
  });
  const sequenceIdentity = (key: string) => JSON.stringify([props.runtimeID, props.thread?.thread_id, 'tools', key]);
  let previousSequences: { threadID?: string; value: FlowerToolSequenceProjection } | undefined;
  const sequences = createMemo(() => {
    const previous = previousSequences?.threadID === props.thread?.thread_id ? previousSequences?.value : undefined;
    const next = projectFlowerToolSequences(props.entries, props.thread?.thread_id, props.thread?.turns ?? [], previous, props.readingBreaks, {
      hasBefore: props.thread?.history_window?.has_before ?? false,
      hasAfter: props.thread?.history_window?.has_after ?? false,
      missingEvents: props.missingEvents,
    });
    // The canonical first node may change on prepend. Share its choice so a
    // later navigation remount resolves the same manually controlled state.
    for (const group of next.groups.values()) props.choices.alias(sequenceIdentity(group.nodeKeys[0]), sequenceIdentity(group.key));
    if (previous) untrack(() => {
      for (const group of next.groups.values()) {
        // A mounted singleton may become a settled group in the same frame as
        // its final tool arrives. Let that row mount and claim its title reveal
        // before the existing automatic-disclosure observer settles the group.
        if (!previous.groups.has(group.key) && previous.headerKeys.has(group.nodeKeys[0])
          && sequenceLayout.element(group.nodeKeys[0]) && props.liveConfirmed?.()) {
          props.choices.observe(sequenceIdentity(group.key), 'manual');
        }
        const addedKeys = new Set(group.nodeKeys.filter(key => !previous.members.has(key)));
        if (!addedKeys.size) continue;
        const inspectedNodes = [...addedKeys].flatMap(key => {
          const element = sequenceLayout.element(key);
          return element ? [element] : [];
        });
        const turnID = processes().rows.get(group.entryKeys[0])?.turnID ?? '';
        if (inspectionProtected(turnID, group.entryKeys, true, inspectedNodes)) {
          props.choices.observe(sequenceIdentity(group.key), 'manual');
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
    titleReveal.revealingEntries();
    const threadID = props.thread?.thread_id;
    const execution = props.thread?.current_execution;
    if (threadID && execution && props.thread?.status === 'running') {
      props.choices.observe(identity(execution.turn_id), 'none');
    }
    let cancelled = false;
    onCleanup(() => { cancelled = true; });
    // Let this snapshot mount its fresh titles before settling automatic folds.
    queueMicrotask(() => untrack(() => {
      if (cancelled) return;
      const revealing = titleReveal.revealingEntries();
      if (!threadID) return;
      for (const group of groups.groups.values()) {
        // Automatic folding must not hide a title that has just arrived.
        if (group.disclosure === 'automatic' && group.processKeys.some(key => revealing.has(key))) continue;
        props.choices.observe(identity(group.turnID), group.disclosure,
          () => inspectionProtected(group.turnID, group.processKeys, true), () => preserveReadingAnchor(group.processKeys));
      }
    }));
  });

  createEffect(() => {
    const projection = sequences();
    titleReveal.revealingEntries();
    let cancelled = false;
    onCleanup(() => { cancelled = true; });
    queueMicrotask(() => untrack(() => {
      if (cancelled) return;
      const revealing = titleReveal.revealingEntries();
      for (const group of projection.groups.values()) {
        if (group.disclosure === 'automatic' && group.entryKeys.some(key => revealing.has(key))) continue;
        props.choices.observe(sequenceIdentity(group.key), group.disclosure, () => {
          const inspectedNodes = group.nodeKeys.flatMap(key => {
            const element = sequenceLayout.element(key);
            return element ? [element] : [];
          });
          const turnID = processes().rows.get(group.entryKeys[0])?.turnID ?? '';
          return inspectionProtected(turnID, group.entryKeys, true, inspectedNodes);
        }, () => preserveReadingAnchor(group.entryKeys));
      }
    }));
  });
  const finishMotion = (key: string) => {
    motions.delete(key);
    if (motions.size === 0 && layoutAnchor) {
      props.scroll.finishDisclosure(layoutAnchor);
      layoutAnchor = undefined;
    }
    props.scroll.measureAfterLayout();
  };
  onMount(() => { onCleanup(props.scroll.registerDestination(sequenceLayout.prepareDestination)); });
  const sequenceContext = {
    ...sequenceLayout,
    projection: sequences,
    preparing: props.scroll.isPreparing,
    expanded: (group: FlowerToolSequence) => props.choices.expanded(sequenceIdentity(group.key), group.disclosure),
    manuallyExpanded: (group: FlowerToolSequence) => props.choices.manuallyExpanded(sequenceIdentity(group.key)),
    manuallyControlled: (group: FlowerToolSequence) => props.choices.manuallyControlled(sequenceIdentity(group.key)),
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
  const titleReveal = createFlowerActivityTitleReveal({
    thread: () => props.thread, entries: () => props.entries,
    liveConfirmed: () => props.liveConfirmed?.() ?? false, reducedMotion: props.reducedMotion,
    prepareArrival: key => Math.max(sequenceLayout.prepareArrival(key), props.scroll.prepareArrival()),
    isVisible: key => {
      const group = sequences().members.get(key)?.group;
      return !group || sequenceContext.expanded(group);
    },
  });
  const row = (key: string, entry: Accessor<FlowerTimelineEntry>) => {
    const group = createMemo(() => processes().rows.get(key));
    const process = createMemo(() => group()?.processKeys.includes(key) ?? false);
    const turnExpanded = createMemo(() => !group() || props.choices.expanded(identity(group()!.turnID), group()!.disclosure));
    const expanded = createMemo(() => !process() || retainedRows().has(key) || turnExpanded());
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
    const summary = createMemo(() => group()?.summaryKey === key && group()?.disclosure !== 'none'
      && props.choices.settled(identity(group()!.turnID)));
    const summaryLabel = () => {
      const current = group()!;
      const worked = props.copy.worked(duration(current.turn!.work_duration_ms));
      const details = !current.countsComplete ? [] : current.interleavedInputs ? [
        current.toolCallCount ? props.copy.toolCalls(current.toolCallCount) : '',
        current.inputResponseCount ? props.copy.userResponses(current.inputResponseCount) : '',
        current.failedCallCount ? props.copy.failedCalls(current.failedCallCount) : '',
        current.parentEventCount ? props.copy.subtaskUpdates(current.parentEventCount) : '',
      ].filter(Boolean) : current.parentEventCount ? [props.copy.subtaskUpdates(current.parentEventCount)] : [];
      return [worked, ...details].join(' · ');
    };
    const interactionCheckpoint = createMemo(() => {
      const current = entry();
      return group()?.interleavedInputs === true && current.type === 'message'
        && current.blocks.some((block) => block.type === 'input_response');
    });
    const motion = createFlowerActivityDisclosureMotion(expanded, {
      initialOpen: untrack(expanded),
      reducedMotion: props.reducedMotion,
      animateClose: () => !group() || props.choices.manuallyControlled(identity(group()!.turnID)),
      onLayoutFrame: () => {
        if (motion.state() === 'opening' || motion.state() === 'closing') motions.add(key);
        props.scroll.measureAfterLayout();
      },
      onMotionEnd: () => finishMotion(key),
    });
    const toggle = (button: HTMLButtonElement) => {
      const current = group();
      if (!current || current.disclosure === 'none') return;
      if (turnExpanded()) {
        const focus = document.activeElement;
        if (current.processKeys.some((id) => focus && nodes.get(id)?.contains(focus))) button.focus({ preventScroll: true });
      }
      layoutAnchor = button;
      props.scroll.activateDisclosure(button);
      props.choices.toggle(identity(current.turnID), current.disclosure);
      setRetainedRows(previous => new Set([...previous].filter(key => !current.processKeys.includes(key))));
    };
    onCleanup(() => { nodes.delete(key); motions.delete(key); });
    // Retain inspected content while folded: reopening must preserve nested
    // disclosure choices, selections and the internal reading offset.
    const [contentMounted, setContentMounted] = createSignal(untrack(expanded));
    createEffect(() => { if (expanded()) setContentMounted(true); });
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
        <Show when={group()?.summaryKey === key && group()?.turn?.kind !== 'context_compaction'}>
          <div class="flower-turn-summary" data-reserved={!summary() ? 'true' : undefined} aria-hidden={!summary() ? 'true' : undefined}>
            <Show when={summary()}>
            <button type="button" class="flower-turn-summary-button" data-flower-disclosure-trigger
              aria-expanded={turnExpanded()} aria-controls={group()!.processKeys.map(contentID).join(' ')}
              aria-label={`${turnExpanded() ? props.copy.collapse : props.copy.expand}: ${summaryLabel()}`}
              onClick={(event) => toggle(event.currentTarget)}>
              <span>{summaryLabel()}</span>
              <ChevronRight class="flower-turn-summary-chevron" aria-hidden="true" />
            </button>
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
            <Show when={contentMounted()}><Content /></Show>
          </div>
        </div>
        <Show when={ended()}>{(label) => <div class="flower-turn-ended" role="status">{label()}</div>}</Show>
      </div>
    );
  };
  return <FlowerActivityTitleRevealContext.Provider value={titleReveal}><FlowerToolSequenceContext.Provider value={sequenceContext}><div class="flower-turn-timeline" ref={timeline}>
    <For each={sectionKeys()}>{sectionKey => {
      const section = createMemo(() => bySection().get(sectionKey) ?? []);
      const keys = createMemo(() => section().map(entry => entry.key));
      return <HistorySection sectionKey={sectionKey} entries={section()} scroll={props.scroll}><For each={keys()}>{key => {
        const entry = createMemo(() => entries().get(key)!);
        return <>{props.renderBefore?.(entry)}{row(key, entry)}</>;
      }}</For></HistorySection>;
    }}</For>
  </div></FlowerToolSequenceContext.Provider></FlowerActivityTitleRevealContext.Provider>;
}
