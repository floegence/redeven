import { For, Show, batch, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { FlowerActivityField } from './contracts/flowerSurfaceContracts';
import { activityFieldIdentity, type createActivityFieldReader } from './activityFieldReader';
import { createActivityTextWindow, type ActivityTextChunk } from './activityTextWindow';
import { recoverableHistoryRead } from './historyReadRecovery';

// The enclosing tool owns disclosure. Within a visible text field, navigation
// is ordinary scrolling; no action downloads or replaces the entire field.
export function ActivityFieldText(props: {
  reader: ReturnType<typeof createActivityFieldReader>;
  threadID: string;
  itemID: string;
  field: FlowerActivityField;
  label: string;
  loadingLabel: string;
  failedLabel: string;
  maximumBytes?: number;
  active?: boolean;
  connection?: unknown;
  viewportClass?: string;
  tail?: string;
  onEndVisible?: (visible: boolean) => void;
  prepareSource?: (field: FlowerActivityField, signal: AbortSignal) => Promise<{ publish: () => void; release: () => void }>;
}) {
  let viewport!: HTMLDivElement;
  let scope = new AbortController();
  let window: ReturnType<typeof createActivityTextWindow> | undefined;
  let ownerKey = '';
  let acceptedSource = '';
  let sourcePrepared = false;
  let pendingField: FlowerActivityField | undefined;
  let lastOperation: 'read' | 'replace' = 'read';
  let frame = 0;
  let tailFrame = 0;
  let followingTail = false;
  let busy = false;
  let visible = false;
  let disposed = false;
  let lastTop = 0;
  let direction: 'before' | 'after' = 'after';
  let recoverable = false;
  let lifetime = '';
  const active = createMemo(() => props.active !== false);
  const [chunks, setChunks] = createSignal<readonly ActivityTextChunk[]>([]);
  type Gap = { first: number; last: number; height: number };
  const [gaps, setGaps] = createSignal<readonly Gap[]>([]);
  const [atEnd, setAtEnd] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const elements = () => [...viewport.querySelectorAll<HTMLElement>('[data-field-offset]')];
  const schedule = () => {
    if (frame || disposed) return;
    frame = requestAnimationFrame(() => { frame = 0; void fill(); });
  };
  const fill = async () => {
    if (!window || !visible || !active() || busy || failed() || scope.signal.aborted) return;
    const bounds = viewport.getBoundingClientRect();
    const current = elements();
    const visibleNodes = current.filter(node => { const rect = node.getBoundingClientRect(); return rect.bottom > bounds.top && rect.top < bounds.bottom; });
    const focus = direction === 'before' ? visibleNodes[0] : visibleNodes.at(-1);
    if (focus) window.focus(Number(focus.dataset.fieldOffset));
    const nearbyGaps = [...viewport.querySelectorAll<HTMLElement>('[data-field-gap]')].filter(node => {
      const rect = node.getBoundingClientRect(); return rect.bottom > bounds.top - 320 && rect.top < bounds.bottom + 320;
    });
    const directGap = !focus ? nearbyGaps.find(node => {
      const box = node.getBoundingClientRect(); return box.top <= bounds.top && box.bottom > bounds.top;
    }) : undefined;
    const seek = directGap ? Math.min(Number(directGap.dataset.fieldGapEnd) - 1, Number(directGap.dataset.fieldGap)
      + Math.floor((Number(directGap.dataset.fieldGapEnd) - Number(directGap.dataset.fieldGap))
        * (bounds.top - directGap.getBoundingClientRect().top) / directGap.getBoundingClientRect().height)) : undefined;
    const beforeGap = nearbyGaps.find(node => Number(node.dataset.fieldGapEnd) <= Number(focus?.dataset.fieldOffset ?? 0));
    const afterGap = nearbyGaps.find(node => Number(node.dataset.fieldGap) >= Number(focus?.dataset.fieldEnd ?? 0));
    const before = window.hasBefore && (viewport.scrollTop < 320 || Boolean(beforeGap));
    props.onEndVisible?.(!window.hasAfter && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 320);
    const after = window.hasAfter && (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 320 || Boolean(afterGap));
    const edge = seek !== undefined ? 'after' : before && direction === 'before' ? 'before' : after ? 'after' : undefined;
    const replacement = pendingField && (!edge || lastOperation === 'read') ? pendingField : undefined;
    if (!edge && !replacement && sourcePrepared) return;
    const owned = window;
    const signal = scope.signal;
    const pin = () => {
      const bounds = viewport.getBoundingClientRect();
      const selection = document.getSelection();
      const selected = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : undefined;
      return elements().filter(node => {
        const box = node.getBoundingClientRect();
        return box.bottom > bounds.top && box.top < bounds.bottom || node.contains(document.activeElement) || selected?.intersectsNode(node);
      }).map(node => ({ first: Number(node.dataset.fieldOffset), last: Number(node.dataset.fieldEnd) }));
    };
    busy = true; setLoading(true);
    let releaseSource: (() => void) | undefined;
    try {
      const preparedSource = (replacement || !sourcePrepared) && props.prepareSource
        ? await props.prepareSource(replacement ?? props.field, signal) : undefined;
      releaseSource = preparedSource?.release;
      signal.throwIfAborted();
      if (replacement) {
        await owned.replace(replacement, signal);
        acceptedSource = activityFieldIdentity(replacement);
        if (pendingField === replacement) pendingField = undefined;
        lastOperation = 'replace';
      } else if (edge) {
        await owned.read(edge, signal, pin, seek);
        lastOperation = 'read';
      }
      signal.throwIfAborted();
      // Capture at commit so movement while transport is pending stays owned
      // by the user. Existing chunk objects keep their DOM nodes and selection.
      const now = viewport.getBoundingClientRect();
      const anchor = elements().find(node => { const box = node.getBoundingClientRect(); return box.bottom > now.top && box.top < now.bottom; });
      const top = anchor?.getBoundingClientRect().top;
      const retained = owned.chunks;
      const missing: Gap[] = [];
      for (let index = 1; index < retained.length; index++) {
        const first = retained[index - 1].next, last = retained[index].offset;
        if (first >= last) continue;
        let height = 0;
        for (const gap of gaps()) {
          const overlap = Math.max(0, Math.min(last, gap.last) - Math.max(first, gap.first));
          height += gap.height * overlap / (gap.last - gap.first);
        }
        for (const node of elements()) {
          const start = Number(node.dataset.fieldOffset), end = Number(node.dataset.fieldEnd);
          if (start >= first && end <= last) height += node.getBoundingClientRect().height;
        }
        missing.push({ first, last, height });
      }
      batch(() => {
        setGaps(missing);
        setChunks([...retained]);
        setAtEnd(!owned.hasAfter);
        preparedSource?.publish();
      });
      sourcePrepared = true;
      if (anchor?.isConnected && top !== undefined) viewport.scrollTop += anchor.getBoundingClientRect().top - top;
      lastTop = viewport.scrollTop;
    } catch (error) {
      if (!signal.aborted) { recoverable = recoverableHistoryRead(error); setFailed(true); }
    } finally {
      releaseSource?.();
      if (owned === window && signal === scope.signal) { busy = false; setLoading(false); schedule(); }
    }
  };
  createEffect(() => {
    const field = props.field;
    const identity = activityFieldIdentity(field);
    const key = JSON.stringify([props.threadID, props.itemID, field.path, props.maximumBytes]);
    const nextLifetime = JSON.stringify([key, active(), props.connection]);
    if (lifetime !== nextLifetime) {
      scope.abort(); scope = new AbortController(); lifetime = nextLifetime;
      busy = false; recoverable = false; setLoading(false); setFailed(false);
      schedule();
    }
    if (window && ownerKey === key) {
      if (identity !== acceptedSource) { pendingField = field; schedule(); }
      return;
    }
    scope.abort(); scope = new AbortController();
    ownerKey = key; acceptedSource = identity; pendingField = undefined; sourcePrepared = false;
    window = createActivityTextWindow(props.reader, props.threadID, props.itemID, field, props.maximumBytes);
    busy = false; recoverable = false; direction = 'after'; lastTop = 0; followingTail = false;
    setGaps([]); setChunks([]); setAtEnd(false); setFailed(false); setLoading(false);
    if (viewport) viewport.scrollTop = 0;
    schedule();
  });
  createEffect(() => {
    void props.tail; atEnd(); active();
    if (!followingTail || !active() || !atEnd() || tailFrame) return;
    tailFrame = requestAnimationFrame(() => {
      tailFrame = 0;
      if (disposed || !followingTail || !active() || !atEnd()) return;
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      lastTop = viewport.scrollTop;
      schedule();
    });
  });
  onMount(() => {
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (!visible) { scope.abort(); scope = new AbortController(); busy = false; setLoading(false); }
      else schedule();
    }, { rootMargin: '160px' });
    observer.observe(viewport);
    const resize = new ResizeObserver(schedule); resize.observe(viewport);
    const online = () => { if (recoverable) { recoverable = false; setFailed(false); schedule(); } };
    globalThis.addEventListener('online', online);
    onCleanup(() => { observer.disconnect(); resize.disconnect(); globalThis.removeEventListener('online', online); });
  });
  onCleanup(() => { disposed = true; scope.abort(); cancelAnimationFrame(frame); cancelAnimationFrame(tailFrame); });
  return <div class="flower-activity-field" data-field-path={props.field.path}>
    <div ref={viewport} class={['flower-activity-field-viewport', props.viewportClass].filter(Boolean).join(' ')} tabindex={0} role="region" aria-label={props.label}
      style={{ 'max-height': props.viewportClass ? undefined : '20rem', overflow: 'auto', 'overflow-anchor': 'none', 'white-space': 'pre-wrap', 'overflow-wrap': 'anywhere' }}
      onWheel={event => { if (event.deltaY < 0) followingTail = false; }}
      onScroll={() => {
        if (Math.abs(viewport.scrollTop - lastTop) > 1) {
          direction = viewport.scrollTop < lastTop ? 'before' : 'after';
          followingTail = atEnd() && viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 24;
        }
        lastTop = viewport.scrollTop; schedule();
      }}>
      <For each={chunks()}>{chunk => <>
        <Show when={gaps().find(gap => gap.last === chunk.offset)}>{gap =>
          <span aria-hidden="true" data-field-gap={gap().first} data-field-gap-end={gap().last}
            style={{ display: 'block', height: gap().height + 'px' }} />
        }</Show>
        <span data-field-offset={chunk.offset} data-field-end={chunk.next}>{chunk.text}</span>
      </>}</For>
      <Show when={atEnd() && props.tail}>{tail => <span data-field-live-output>{tail()}</span>}</Show>
    </div>
    <Show when={failed()}><span role="status">{props.failedLabel}</span></Show>
    <Show when={loading() && !chunks().length}><span role="status">{props.loadingLabel}</span></Show>
  </div>;
}
