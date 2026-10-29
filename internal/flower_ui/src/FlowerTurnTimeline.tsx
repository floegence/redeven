import { observeFlowerSequenceDisclosure } from './flowerSequenceDisclosure';
import { createFlowerKeyedSubscriptions, createFlowerMembershipSubscriptions, createFlowerEntrySubscriptions, createFlowerSequenceSubscriptions, createFlowerProcessSubscriptions } from './flowerPresentationSubscriptions';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack, type Accessor, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { AlertCircle, AlertTriangle, ChevronRight, CircleStop } from '@floegence/floe-webapp-core/icons';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import type { HistoryReadingGap } from './historyReadingWindow';
import type { FlowerTurnProcessCopy } from './copy';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerScrollTailController } from './flowerScrollTail';
import type { FlowerTurnDisclosureStore } from './flowerTurnDisclosure';
import { FlowerToolSequenceContext, FlowerToolSequenceNode } from './FlowerToolSequenceNode';
import { createFlowerSequenceTokens, projectFlowerToolSequences, type FlowerToolSequence, type FlowerToolSequenceProjection } from './flowerToolSequences';
import { createFlowerActivityDisclosureMotion, type FlowerActivityDisclosurePresentation } from './activityDisclosure';
import { createFlowerToolSequenceLayout } from './flowerToolSequenceLayout';
import { flowerDurationParts, projectFlowerTurnProcess, projectFlowerHistorySections, type FlowerHistorySection, type FlowerTurnProcessProjection } from './flowerTurnPresentation';
import { createFlowerActivityTitleReveal, FlowerActivityTitleRevealContext } from './flowerActivityTitleReveal';

type PendingSequenceContent = Readonly<{
  nodeKey: string;
  motionKey: string;
  presentation?: Pick<FlowerActivityDisclosurePresentation, 'opacity' | 'transform'>;
}>;

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
  receipt?: Readonly<{ live: boolean; restoration: number }>;
  copy: FlowerTurnProcessCopy;
  readingBreaks?: ReadonlySet<string>;
  sequenceGaps?: ReadonlyMap<string, HistoryReadingGap>;
  missingEvents?: readonly Readonly<{ after: number; before: number }>[];
  renderBefore?: (entry: Accessor<FlowerTimelineEntry>) => JSX.Element;
  onDisclosure?: () => void;
  onSequenceDemand?: (group: FlowerToolSequence, expanded: boolean) => void;
  renderInside?: (entry: Accessor<FlowerTimelineEntry>) => JSX.Element;
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
  let restoration = props.receipt?.restoration;
  const liveArrival = createMemo(() => {
    void props.thread;
    void props.entries;
    const restored = restoration !== props.receipt?.restoration;
    restoration = props.receipt?.restoration;
    return !restored && (props.receipt?.live ?? true) && (props.liveConfirmed?.() ?? false) && !props.scroll.isPreparing();
  });
  const sections = createMemo<FlowerHistorySection[]>((previous = []) => projectFlowerHistorySections(props.entries, props.thread, previous));
  const sectionKeys = createMemo(() => sections().map(section => section.key));
  const subscribeSection = createFlowerKeyedSubscriptions(() => new Map(sections().map(section => [section.key, section.entries])), Object.is, true);
  const subscribeEntry = createFlowerEntrySubscriptions(() => props.entries);
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
  const threadID = createMemo(() => props.thread?.thread_id);
  const identity = (turnID: string) => JSON.stringify([props.runtimeID, threadID(), turnID]);
  const contentID = (key: string) => `flower-process-${encodeURIComponent(`${props.scope}:${threadID()}:${key}`)}`;
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
    if (props.scroll.followingLatest()) { props.scroll.beginAutomaticFold(() => motions.size > 0); return; }
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
    const current = props.thread;
    const threadID = current?.thread_id;
    const value = projectFlowerTurnProcess(props.entries, current?.turns,
      current?.current_execution && ['running', 'waiting_user', 'waiting_approval'].includes(current.status)
        ? [current.current_execution.turn_id] : [], previousProjection && previousProjection.threadID === threadID ? previousProjection.value : undefined, {
        hasBefore: props.thread?.history_window?.has_before ?? false,
        hasAfter: props.thread?.history_window?.has_after ?? false,
        readingBreaks: props.readingBreaks, missingEvents: props.missingEvents,
      });
    // Protect newly classified process before any row can become inert or hidden.
    const previous = previousProjection;
    if (previous && previous.threadID === threadID) untrack(() => {
      for (const group of value.groups.values()) {
        const prior = previous.value.groups.get(group.turnID);
        if (prior === group) continue;
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
        const priorProcess = new Set(prior?.processKeys);
        const newlyFoldable = group.processKeys.filter((key) => previous.value.rows.has(key) && !priorProcess.has(key));
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
  // Runtime facts keep flowing. Only fresh prose waits for its mounted group's
  // presentation; the existing motion completion releases it without a timer.
  const [pendingSequenceContent, setPendingSequenceContent] = createSignal<ReadonlyMap<string, PendingSequenceContent>>(new Map());
  const releaseMotionContent = (motionKey: string) => setPendingSequenceContent(previous => {
    if (![...previous.values()].some(owner => owner.motionKey === motionKey)) return previous;
    return new Map([...previous].filter(([, owner]) => owner.motionKey !== motionKey));
  });
  const sequenceTokens = createFlowerSequenceTokens(() => props.entries);
  let previousSequences: { threadID?: string; value: FlowerToolSequenceProjection } | undefined;
  const sequences = createMemo(() => {
    const previous = previousSequences?.threadID === props.thread?.thread_id ? previousSequences?.value : undefined;
    const next = projectFlowerToolSequences(props.entries, props.thread?.thread_id, props.thread?.turns ?? [], previous, props.readingBreaks, {
      hasBefore: props.thread?.history_window?.has_before ?? false,
      hasAfter: props.thread?.history_window?.has_after ?? false,
      missingEvents: props.missingEvents,
      sequenceGaps: props.sequenceGaps, compactions: props.thread?.context_compactions,
    }, sequenceTokens);
    // The canonical first node may change on prepend. Share its choice so a
    // later navigation remount resolves the same manually controlled state.
    for (const group of next.groups.values()) props.choices.alias(sequenceIdentity(group.nodeKeys[0]), sequenceIdentity(group.key));
    if (previous) untrack(() => {
      for (const group of next.groups.values()) {
        // A mounted singleton may become a settled group in the same frame as
        // its final tool arrives. Let that row mount and claim its title reveal
        // before the existing automatic-disclosure observer settles the group.
        if (!previous.groups.has(group.key) && previous.headerKeys.has(group.nodeKeys[0])
          && sequenceLayout.element(group.nodeKeys[0]) && liveArrival()) {
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
    if (next !== previous) untrack(() => {
      if (previous) sequenceLayout.captureReading(next);
      const pending = new Map(pendingSequenceContent());
      const owners = new Set([...next.groups.values()].map(group => group.nodeKeys[0]));
      for (const [key, owner] of pending) if (!previous || !owners.has(owner.nodeKey)) pending.delete(key);
      if (previous && liveArrival() && !props.reducedMotion()) {
        for (const group of next.groups.values()) {
          const prior = previous.groups.get(group.key);
          const waiting = group.followingContentKeys.map(key => pending.get(key)).find(owner => owner?.nodeKey === group.nodeKeys[0]);
          if (waiting) for (const key of group.followingContentKeys) pending.set(key, waiting);
          else if (group.followingContentKeys.length && group.followingContentKeys[0] !== prior?.followingContentKeys[0]
            && group.disclosure === 'automatic' && previous.headerKeys.has(group.nodeKeys[0]) && sequenceLayout.element(group.nodeKeys[0])
            && props.choices.expanded(sequenceIdentity(group.key), prior?.disclosure ?? 'manual')
            && !props.choices.manuallyControlled(sequenceIdentity(group.key))) {
            const owner = { nodeKey: group.nodeKeys[0], motionKey: 'tools:' + group.nodeKeys[0] };
            for (const key of group.followingContentKeys) pending.set(key, owner);
            // New prose and folding share one layout owner. Suppress the
            // independent growth animation while fold geometry is moving.
            props.scroll.beginAutomaticFold(() => pendingSequenceContent().size > 0 || motions.size > 0);
          }
        }
      }
      setPendingSequenceContent(old => old.size === pending.size
        && [...old].every(([key, owner]) => pending.get(key) === owner) ? old : pending);
    });
    previousSequences = { threadID: props.thread?.thread_id, value: next };
    return next;
  });
  const sequenceLayout = createFlowerToolSequenceLayout(sequences, props.scroll);
  createEffect(() => {
    const groups = processes();
    const animate = liveArrival();
    const pending = pendingSequenceContent();
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
          () => inspectionProtected(group.turnID, group.processKeys, true), () => {
            preserveReadingAnchor(group.processKeys);
            // A terminal snapshot folds the enclosing process directly. Hand
            // the same pending prose to that row instead of first shrinking
            // its sequence and then abruptly deleting the remaining row.
            const owners = new Map<string, PendingSequenceContent>();
            if (pending.size) for (const sequence of sequences().groups.values()) {
              const nodeKey = sequence.nodeKeys[0];
              if (!group.processMembers.has(sequence.entryKeys[0])) continue;
              const viewport = sequenceLayout.element(nodeKey)?.querySelector<HTMLElement>(':scope > .flower-tool-sequence-viewport');
              // If completion interrupts an existing fold, carry its painted
              // opacity/transform into the outer owner before settling it.
              const style = viewport && motions.has('tools:' + nodeKey) ? getComputedStyle(viewport) : undefined;
              owners.set(nodeKey, { nodeKey, motionKey: sequence.entryKeys[0],
                ...(style ? { presentation: { opacity: Number(style.opacity), transform: style.transform } } : {}) });
            }
            if ([...pending.values()].some(owner => owners.has(owner.nodeKey))) {
              setPendingSequenceContent(previous => new Map([...previous].map(([key, owner]) =>
                [key, owners.get(owner.nodeKey) ?? owner])));
            }
          }, animate);
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
  const subscribeProcess = createFlowerProcessSubscriptions(processes);
  const subscribeContinuation = createFlowerMembershipSubscriptions(() => sequences().continuingEntries);
  const sequenceContext = {
    processManuallyExpanded: (turnID: string) => props.choices.manuallyExpanded(identity(turnID)),
    demand: (group: FlowerToolSequence, expanded: boolean) => props.onSequenceDemand?.(group, expanded),
    ...sequenceLayout,
    subscribeHeader: createFlowerMembershipSubscriptions(() => sequences().headerKeys),
    subscribeProcess,
    subscribe: createFlowerSequenceSubscriptions(sequences),
    preparing: props.scroll.isPreparing,
    motionEnabled: (group: FlowerToolSequence) => props.choices.motionEnabled(sequenceIdentity(group.key)),
    expanded: (group: FlowerToolSequence) => props.choices.expanded(sequenceIdentity(group.key), group.disclosure),
    manuallyExpanded: (group: FlowerToolSequence) => props.choices.manuallyExpanded(sequenceIdentity(group.key)),
    toggle: (group: FlowerToolSequence, button: HTMLButtonElement) => {
      props.onDisclosure?.();
      if (group.entryKeys.some(key => nodes.get(key)?.contains(document.activeElement))) button.focus({ preventScroll: true });
      layoutAnchor = button;
      props.scroll.activateDisclosure(button);
      props.choices.toggle(sequenceIdentity(group.key), group.disclosure);
    },
    contentID: (key: string) => `flower-tool-sequence-${encodeURIComponent(`${props.scope}:${threadID()}:${key}`)}`,
    onLayoutFrame: (key: string, moving: boolean) => {
      if (moving) motions.add(key);
      props.scroll.measureAfterLayout();
    },
    onMotionEnd: (key: string) => {
      finishMotion(key);
      releaseMotionContent(key);
    },
    contentPending: (key: string) => pendingSequenceContent().has(key),
    parentFolding: (group: FlowerToolSequence) => group.followingContentKeys.some(key => {
      const owner = pendingSequenceContent().get(key);
      return Boolean(owner && owner.motionKey !== 'tools:' + owner.nodeKey);
    }),
    processExpanded: (turnID: string, disclosure: Parameters<typeof props.choices.expanded>[1]) => props.choices.expanded(identity(turnID), disclosure),
    copy: () => props.copy,
    reducedMotion: props.reducedMotion,
  };
  const titleReveal = createFlowerActivityTitleReveal({
    thread: () => props.thread, entries: () => props.entries,
    liveConfirmed: () => Boolean(props.liveConfirmed?.()) && !props.scroll.isPreparing(), reducedMotion: props.reducedMotion,
    restoration: () => props.receipt?.restoration ?? 0,
    prepareArrival: key => Math.max(sequenceLayout.prepareArrival(key), props.scroll.prepareArrival()),
    isVisible: key => {
      const group = sequences().members.get(key)?.group;
      return !group || sequenceContext.expanded(group);
    },
  });
  observeFlowerSequenceDisclosure({
    groups: () => sequences().groups, pending: pendingSequenceContent,
    revealing: () => titleReveal.revealingEntries(), animate: liveArrival,
    observe: (group, animate) => {
      props.choices.observe(sequenceIdentity(group.key), group.disclosure, () => {
        const inspectedNodes = group.nodeKeys.flatMap(key => {
          const element = sequenceLayout.element(key);
          return element ? [element] : [];
        });
        const turnID = processes().rows.get(group.entryKeys[0])?.turnID ?? '';
        return inspectionProtected(turnID, group.entryKeys, true, inspectedNodes);
      }, () => preserveReadingAnchor(group.entryKeys), animate);
      if (props.choices.expanded(sequenceIdentity(group.key), group.disclosure) && !motions.has('tools:' + group.nodeKeys[0])) {
        releaseMotionContent('tools:' + group.nodeKeys[0]);
      }
    },
  });
  const row = (key: string, entry: Accessor<FlowerTimelineEntry>) => {
    const state = subscribeProcess(key);
    const continuation = subscribeContinuation(key);
    const sequenceMember = sequenceContext.subscribe(key);
    const group = () => processes().rows.get(key);
    const process = () => state()?.process ?? false;
    const turnExpanded = createMemo(() => !state() || props.choices.expanded(identity(state()!.turnID), state()!.disclosure));
    const expanded = createMemo(() => !process() || retainedRows().has(key) || turnExpanded());
    const ended = createMemo(() => {
      const current = state();
      const outcome = current?.outcome;
      if (current?.turnID === failureTurnID() && (outcome === 'failed' || outcome === 'interrupted')) return '';
      return outcome && outcome !== 'completed' ? props.copy[outcome] : '';
    });
    // Historical rows can skip offscreen layout immediately. A row that was
    // live keeps its measured layout until the next transcript mount, so
    // completion cannot move the reading anchor before disclosure settles.
    const historical = untrack(() => state()?.historical ?? false);
    const settled = createMemo(() => historical && !process());
    // Decide protection and capture the anchor before inserting summary height.
    const summary = createMemo(() => Boolean(state()?.summary) && state()?.disclosure !== 'none'
      && props.choices.settled(identity(state()!.turnID)));
    const summaryLabel = () => {
      const current = state()!.summary!;
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
      return state()?.interleavedInputs === true && current.type === 'message'
        && current.blocks.some((block) => block.type === 'input_response');
    });
    const rowReducedMotion = createMemo(() => props.reducedMotion() || props.scroll.isPreparing()
      || Boolean(state() && !props.choices.motionEnabled(identity(state()!.turnID))));
    const motion = createFlowerActivityDisclosureMotion(expanded, {
      initialOpen: untrack(expanded),
      reducedMotion: rowReducedMotion,
      closeDurationMs: 260,
      closeEasing: 'cubic-bezier(0.32, 0, 0.2, 1)',
      closePresentation: current => {
        const prior = [...pendingSequenceContent().values()].find(owner => owner.motionKey === key)?.presentation;
        return prior ? { ...current, opacity: current.opacity * prior.opacity, transform: prior.transform } : current;
      },
      onLayoutFrame: () => {
        if (motion.state() === 'opening' || motion.state() === 'closing') motions.add(key);
        props.scroll.measureAfterLayout();
      },
      onMotionEnd: () => {
        // Explicit reopening also retains the still-visible nested sequences;
        // their deferred automatic default must not start another fold after
        // prose has been released into the user's reading position.
        if (expanded() && pendingSequenceContent().size) for (const sequence of sequences().groups.values()) {
          if (sequence.entryKeys[0] !== key || !sequence.followingContentKeys.some(content =>
            pendingSequenceContent().get(content)?.motionKey === key)) continue;
          props.choices.observe(sequenceIdentity(sequence.key), 'manual');
          props.choices.reveal(sequenceIdentity(sequence.key));
        }
        finishMotion(key);
        releaseMotionContent(key);
      },
    });
    const toggle = (button: HTMLButtonElement) => {
      const current = group();
      if (!current || current.disclosure === 'none') return;
      props.onDisclosure?.();
      if (turnExpanded()) {
        const focus = document.activeElement;
        if (current.processKeys.some((id) => focus && nodes.get(id)?.contains(focus))) button.focus({ preventScroll: true });
      }
      layoutAnchor = button;
      props.scroll.activateDisclosure(button);
      props.choices.toggle(identity(current.turnID), current.disclosure);
      setRetainedRows(previous => new Set([...previous].filter(key => !current.processMembers.has(key))));
    };
    onCleanup(() => { nodes.delete(key); motions.delete(key); releaseMotionContent(key); });
    // Retain inspected content while folded: reopening must preserve nested
    // disclosure choices, selections and the internal reading offset.
    const [contentMounted, setContentMounted] = createSignal(untrack(expanded));
    createEffect(() => { if (expanded()) setContentMounted(true); });
    const Content = () => {
      const content = untrack(() => props.renderEntry(entry, expanded));
      return <Show when={entry().type === 'parent_event' && sequenceMember()} fallback={content}>
        <FlowerToolSequenceNode nodeKey={key}>{content}</FlowerToolSequenceNode>
      </Show>;
    };
    return (
      <div class="flower-turn-row" data-flower-turn-id={state()?.turnID} data-flower-turn-process={process() ? 'true' : undefined}
        data-flower-input-checkpoint={interactionCheckpoint() ? 'true' : undefined}
        data-flower-row-message-id={entry().type === 'message' ? (entry() as Extract<FlowerTimelineEntry, { type: 'message' }>).message.id : undefined}
        data-flower-row-event-id={entry().type === 'parent_event' ? (entry() as Extract<FlowerTimelineEntry, { type: 'parent_event' }>).event.id : undefined}
        data-flower-row-decoration-id={entry().type === 'context_compaction' ? (entry() as Extract<FlowerTimelineEntry, { type: 'context_compaction' }>).decoration.decoration_id : undefined}
        data-flower-sequence-continues={continuation() ? 'true' : undefined}
        data-flower-turn-settled={settled() ? 'true' : undefined}>
        <Show when={Boolean(state()?.summary)}>
          <div class="flower-turn-summary" data-reserved={!summary() ? 'true' : undefined} aria-hidden={!summary() ? 'true' : undefined}>
            <Show when={summary()}>
            <button type="button" class="flower-turn-summary-button" data-flower-disclosure-trigger
              aria-expanded={turnExpanded()} aria-controls={state()!.summary!.processKeys.map(contentID).join(' ')}
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
            onContextMenu={() => { menuOwner = state()?.turnID; }}>
            {props.renderInside?.(entry)}<Show when={contentMounted()}><Content /></Show>
          </div>
        </div>
        <Show when={ended()}>{(label) => (
          <div class="flower-turn-ended" role="status">
            <span class="flower-turn-ended-icon" aria-hidden="true">
              <Dynamic component={state()?.outcome === 'cancelled' ? CircleStop : state()?.outcome === 'interrupted' ? AlertCircle : AlertTriangle} size={16} />
            </span>
            <span class="flower-turn-ended-label">{label()}</span>
          </div>
        )}</Show>
      </div>
    );
  };
  return <FlowerActivityTitleRevealContext.Provider value={titleReveal}><FlowerToolSequenceContext.Provider value={sequenceContext}><div class="flower-turn-timeline" ref={timeline}>
    <For each={sectionKeys()}>{sectionKey => {
      const section = subscribeSection(sectionKey);
      const keys = createMemo(() => section()!.map(entry => entry.key));
      return <HistorySection sectionKey={sectionKey} entries={section()!} scroll={props.scroll}><For each={keys()}>{key => {
        const subscribed = subscribeEntry(key);
        const entry = () => subscribed()!;
        return <>{props.renderBefore?.(entry)}{row(key, entry)}</>;
      }}</For></HistorySection>;
    }}</For>
  </div></FlowerToolSequenceContext.Provider></FlowerActivityTitleRevealContext.Provider>;
}
