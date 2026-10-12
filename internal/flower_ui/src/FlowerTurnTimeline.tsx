import { For, Show, createEffect, createMemo, onCleanup, untrack, type Accessor, type JSX } from 'solid-js';
import { ChevronRight } from '@floegence/floe-webapp-core/icons';
import type { FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import type { FlowerTurnProcessCopy } from './copy';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';
import type { FlowerScrollTailController } from './flowerScrollTail';
import type { FlowerTurnDisclosureStore } from './flowerTurnDisclosure';
import { createFlowerActivityDisclosureMotion } from './activityDisclosure';
import { flowerDurationParts, projectFlowerTurnProcess } from './flowerTurnPresentation';

export function FlowerTurnTimeline(props: Readonly<{
  thread: FlowerThreadSnapshot | null | undefined;
  entries: readonly FlowerTimelineEntry[];
  runtimeID: string;
  scope: string;
  choices: FlowerTurnDisclosureStore;
  scroll: FlowerScrollTailController;
  reducedMotion: Accessor<boolean>;
  copy: FlowerTurnProcessCopy;
  renderEntry: (entry: Accessor<FlowerTimelineEntry>) => JSX.Element;
}>) {
  const keys = createMemo(() => props.entries.map((entry) => JSON.stringify([props.thread?.thread_id, entry.key])));
  const entries = createMemo(() => new Map(props.entries.map((entry) => [entry.key, entry])));
  const processes = createMemo(() => projectFlowerTurnProcess(props.entries, props.thread?.turns,
    props.thread?.current_execution && ['running', 'waiting_user', 'waiting_approval'].includes(props.thread.status)
      ? [props.thread.current_execution.turn_id] : []));
  const nodes = new Map<string, HTMLElement>();
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

  const inspectionProtected = (turnID: string, processKeys: readonly string[]) => {
    const viewport = props.scroll.viewport();
    const visible = viewport?.getBoundingClientRect();
    const selection = document.getSelection();
    return processKeys.some((key) => {
      const row = nodes.get(key);
      if (!row) return false;
      if (row.contains(document.activeElement) || gestureTarget && row.contains(gestureTarget)) return true;
      if (menuOwner === turnID && document.querySelector('[role="menu"]')) return true;
      if (row.querySelector('details[open], [data-flower-thinking-view="expanded"]')) return true;
      for (const button of row.querySelectorAll('[aria-expanded="true"]')) {
        if (!button.closest('.flower-thinking-disclosure')) return true;
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
  createEffect(() => {
    const groups = processes();
    const threadID = props.thread?.thread_id;
    untrack(() => {
      if (!threadID) return;
      for (const group of groups.values()) {
        // The protection decision runs once, after final content has committed.
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

  const row = (key: string, entry: Accessor<FlowerTimelineEntry>) => {
    const group = createMemo(() => {
      const value = entry();
      return value.type === 'message' ? processes().get(value.message.turn_id ?? '') : undefined;
    });
    const process = createMemo(() => group()?.processKeys.includes(key) ?? false);
    const expanded = createMemo(() => !process() || props.choices.expanded(identity(group()!.turnID), group()!.disclosure));
    const ended = createMemo(() => {
      const current = group();
      const outcome = current?.turn?.outcome;
      return current?.terminalKey === key && outcome && outcome !== 'completed' ? props.copy[outcome] : '';
    });
    // Decide protection and capture the anchor before inserting summary height.
    const summary = createMemo(() => group()?.disclosure !== 'none' && group()?.summaryKey === key
      && props.choices.settled(identity(group()!.turnID)));
    const finishMotion = () => {
      motions.delete(key);
      if (motions.size === 0 && layoutAnchor) {
        props.scroll.finishDisclosure(layoutAnchor);
        layoutAnchor = undefined;
      }
      props.scroll.measureAfterLayout();
    };
    const motion = createFlowerActivityDisclosureMotion(expanded, {
      initialOpen: untrack(expanded),
      reducedMotion: props.reducedMotion,
      onLayoutFrame: () => {
        if (motion.state() === 'opening' || motion.state() === 'closing') motions.add(key);
        props.scroll.measureAfterLayout();
      },
      onMotionEnd: finishMotion,
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
    // Render once per stable row. Entry changes flow through its accessor;
    // calling the renderer from a reactive insertion would replace the tree.
    const content = untrack(() => props.renderEntry(entry));
    return (
      <div class="flower-turn-row" data-flower-turn-id={group()?.turnID} data-flower-turn-process={process() ? 'true' : undefined}>
        <Show when={summary()}>
          <div class="flower-turn-summary">
            <button type="button" class="flower-turn-summary-button" data-flower-disclosure-trigger
              aria-expanded={expanded()} aria-controls={group()!.processKeys.map(contentID).join(' ')}
              aria-label={`${expanded() ? props.copy.collapse : props.copy.expand}: ${props.copy.worked(duration(group()!.turn!.work_duration_ms))}`}
              onClick={(event) => toggle(event.currentTarget)}>
              <span>{props.copy.worked(duration(group()!.turn!.work_duration_ms))}</span>
              <ChevronRight class="flower-turn-summary-chevron" aria-hidden="true" />
            </button>
          </div>
        </Show>
        <div id={contentID(key)} class="flower-turn-row-viewport" ref={motion.bindViewport}
          data-state={motion.state()} aria-hidden={!expanded() ? 'true' : undefined} inert={!expanded()}
          style={{ height: motion.height(), display: motion.state() === 'closed' ? 'none' : undefined }}>
          <div class="flower-turn-row-content" ref={(node) => { motion.bindContent(node); nodes.set(key, node); }}
            onPointerDown={(event) => startGesture(event.target as Element)}
            onKeyDown={(event) => startGesture(event.target as Element)}
            onContextMenu={() => { menuOwner = group()?.turnID; }}>
            {content}
          </div>
        </div>
        <Show when={ended()}>{(label) => <div class="flower-turn-ended" role="status">{label()}</div>}</Show>
      </div>
    );
  };
  return <div class="flower-turn-timeline"><For each={keys()}>{(token) => {
    const key = (JSON.parse(token) as [string, string])[1];
    const entry = createMemo(() => entries().get(key)!);
    return row(key, entry);
  }}</For></div>;
}
