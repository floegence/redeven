import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import type { createActivityFieldReader } from './activityFieldReader';
import { readActivityRowSnapshot, readActivityValue } from './activityFieldValue';
import { ActivityFieldText } from './ActivityFieldText';
import type { FlowerActivityField, FlowerActivityItem, FlowerActivityTargetRef } from './contracts/flowerSurfaceContracts';
import type { FlowerSurfaceCopy } from './copy';
import { mapFlowerActivityItem } from './flowerLiveMapper';
import { presentFlowerActivityItem, type FlowerActivityStructuredRow } from './flowerActivityPresentation';
import { FlowerActivityRows } from './FlowerActivityRows';
import { retainEqualValue } from './presentationIdentity';
import { recoverableHistoryRead } from './historyReadRecovery';

type Row = { index: number; value?: FlowerActivityStructuredRow; raw?: unknown; content?: FlowerActivityField; revision: unknown };
const MAX_ROWS = 12;

// A collection owns a bounded reading interval plus exact protected islands. Row identity
// survives adjacent insertion and canonical source replacement. No page button
// or complete-presentation hydration is involved.
export function ActivityFieldRows(props: {
  reader: ReturnType<typeof createActivityFieldReader>;
  threadID: string;
  itemID: string;
  item: FlowerActivityItem;
  field: FlowerActivityField;
  section: 'inputs' | 'results';
  copy: FlowerSurfaceCopy['chat'];
  revision?: unknown;
  active?: boolean;
  connection?: unknown;
  inline?: boolean;
  renderValue?: (value: unknown, index: number) => JSX.Element;
  renderTargetActions?: (target: FlowerActivityTargetRef) => JSX.Element;
}) {
  let viewport!: HTMLDivElement;
  let scope = new AbortController();
  let frame = 0;
  let busy = false;
  let visible = false;
  let disposed = false;
  let direction: 'before' | 'after' = 'after';
  let previousTop = 0;
  let requestedRevision: unknown;
  let lastOperation: 'read' | 'refresh' = 'refresh';
  let ownerKey = '';
  let lifetime = '';
  let recoverable = false;
  let readingIndex = 0;
  type Gap = { first: number; last: number; height: number };
  const [gaps, setGaps] = createSignal<readonly Gap[]>([]);
  const [rows, setRows] = createSignal<readonly Row[]>([]);
  const [failed, setFailed] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  // Read JSX props under this component's owner. The scheduler runs outside
  // Solid's reactive scope and must not instantiate compiled prop memos.
  const active = createMemo(() => props.active !== false);
  const schedule = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; void fill(); });
  };
  const load = async (index: number, signal: AbortSignal, revision: unknown): Promise<Row> => {
    const path = props.field.path + '/' + index;
    const snapshot = props.renderValue ? undefined : await readActivityRowSnapshot(props.reader, props.threadID, props.itemID, path, signal);
    const raw = props.renderValue
      ? await readActivityValue(props.reader, props.threadID, props.itemID, path, signal, { maximumBytes: 192 << 10, maximumNodes: 256 })
      : snapshot!.value;
    if (props.renderValue) return { index, raw, revision };
    const field = props.section === 'inputs' ? 'inputs' : 'rows';
    // Reuse the public row validator and product normalization, including
    // language, safe resource targets, formatting and localized field labels.
    const item = mapFlowerActivityItem({ ...props.item, label: undefined, description: undefined, renderer: undefined, payload: undefined, chips: undefined, target_refs: undefined,
      presentation: { label: props.item.label, description: props.item.description, renderer: props.item.renderer ?? 'structured', chips: props.item.chips, target_refs: props.item.target_refs,
        payload: { ...props.item.payload, [field]: [raw], rows_provided: true } } });
    if (!item) throw new Error('Activity row is unavailable.');
    const presentation = presentFlowerActivityItem(item, { tools: props.copy.toolActivity });
    // Parent reports use a dedicated receipt block. The receipt remains owned
    // by the activity; its deferred message still belongs to the selected input
    // row and must not disappear because it is not a structured_rows block.
    if (item.tool_name === 'report_to_parent' && props.section === 'inputs') {
      const report = presentation.detailBlocks.find(block => block.kind === 'parent_report');
      return { index, revision, content: snapshot?.content, value: report?.kind === 'parent_report' && report.message
        ? { title: props.copy.toolActivity.parentReportContent, meta: '', content: report.message, format: 'text' } : undefined };
    }
    const block = presentation.detailBlocks.find(block => block.kind === 'structured_rows' && block.section === props.section);
    if (block?.kind === 'structured_rows' && block.rows.length > 1) throw new Error('Activity row did not preserve its display identity.');
    // Some legal rows are intentionally omitted by the existing presenter. Keep
    // their ordinal so scrolling advances without inventing display content.
    return { index, value: block?.kind === 'structured_rows' ? block.rows[0] : undefined,
      content: block?.kind === 'structured_rows' && block.rows.length ? snapshot?.content : undefined, revision };
  };
  const commit = (next: Row[]) => {
    const bounds = viewport.getBoundingClientRect();
    const anchor = [...viewport.querySelectorAll<HTMLElement>('[data-activity-row-index]')].find(node => {
      const box = node.getBoundingClientRect();
      return box.bottom > bounds.top && box.top < bounds.bottom;
    });
    const top = anchor?.getBoundingClientRect().top;
    const selection = document.getSelection();
    const selected = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : undefined;
    const pinned = (row: Row) => {
      const node = viewport.querySelector<HTMLElement>('[data-activity-row-index="' + row.index + '"]');
      if (!node) return false;
      const box = node.getBoundingClientRect();
      return box.bottom > bounds.top && box.top < bounds.bottom || node.contains(document.activeElement)
        || Boolean(selected?.intersectsNode(node));
    };
    const protectedRows = new Set(next.filter(pinned));
    const limit = Math.max(MAX_ROWS, protectedRows.size + 1);
    const candidates = next.filter(row => !protectedRows.has(row)).sort((a, b) => Math.abs(b.index - readingIndex) - Math.abs(a.index - readingIndex));
    for (const row of candidates) {
      if (next.length <= limit) break;
      next.splice(next.indexOf(row), 1);
    }
    const missing: Gap[] = [];
    for (let i = 1; i < next.length; i++) {
      const first = next[i - 1].index + 1, last = next[i].index;
      if (first >= last) continue;
      let height = 0;
      for (const gap of gaps()) {
        const overlap = Math.max(0, Math.min(last, gap.last) - Math.max(first, gap.first));
        height += gap.height * overlap / (gap.last - gap.first);
      }
      for (const node of viewport.querySelectorAll<HTMLElement>('[data-activity-row-index]')) {
        const index = Number(node.dataset.activityRowIndex);
        if (index >= first && index < last) height += node.getBoundingClientRect().height;
      }
      missing.push({ first, last, height });
    }
    setGaps(missing);
    setRows(next);
    if (anchor?.isConnected && top !== undefined) viewport.scrollTop += anchor.getBoundingClientRect().top - top;
    previousTop = viewport.scrollTop;
  };
  const fill = async () => {
    if (!visible || !active() || busy || failed() || disposed) return;
    const retained = rows();
    const bounds = viewport.getBoundingClientRect();
    const visibleRows = [...viewport.querySelectorAll<HTMLElement>('[data-activity-row-index]')].filter(node => {
      const box = node.getBoundingClientRect(); return box.bottom > bounds.top && box.top < bounds.bottom;
    });
    const focus = direction === 'before' ? visibleRows[0] : visibleRows.at(-1);
    if (focus) readingIndex = Number(focus.dataset.activityRowIndex);
    let start = retained.findIndex(row => row.index >= readingIndex);
    if (start < 0) start = retained.length - 1;
    let end = start;
    while (start > 0 && retained[start - 1].index + 1 === retained[start].index) start--;
    while (end >= 0 && end + 1 < retained.length && retained[end].index + 1 === retained[end + 1].index) end++;
    const before = retained[start]?.index ?? 0;
    const after = (retained[end]?.index ?? -1) + 1;
    const nearbyGaps = [...viewport.querySelectorAll<HTMLElement>('[data-activity-row-gap]')].filter(node => {
      const rect = node.getBoundingClientRect(); return rect.bottom > bounds.top - 400 && rect.top < bounds.bottom + 400;
    });
    const readingGap = !visibleRows.length ? nearbyGaps.find(node => {
      const box = node.getBoundingClientRect(); return box.top <= bounds.top && box.bottom > bounds.top;
    }) : undefined;
    const seek = readingGap ? (() => {
      const first = Number(readingGap.dataset.activityRowGap), last = Number(readingGap.dataset.activityRowGapEnd);
      const box = readingGap.getBoundingClientRect();
      return Math.min(last - 1, first + Math.floor((bounds.top - box.top) / box.height * (last - first)));
    })() : undefined;
    const needBefore = before > 0 && direction === 'before' && (viewport.scrollTop < 400
      || nearbyGaps.some(node => Number(node.dataset.activityRowGapEnd) <= before));
    const needAfter = after < (props.field.count ?? 0) && (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 400
      || nearbyGaps.some(node => Number(node.dataset.activityRowGap) >= after));
    const stale = rows().filter(row => {
      const node = viewport.querySelector<HTMLElement>('[data-activity-row-index="' + row.index + '"]');
      const box = node?.getBoundingClientRect();
      return row.revision !== requestedRevision && box && box.bottom > bounds.top - 400 && box.top < bounds.bottom + 400;
    });
    const refreshing = seek === undefined && stale.length > 0 && (!needBefore && !needAfter || lastOperation === 'read');
    if (seek === undefined && !needBefore && !needAfter && !refreshing) return;
    const signal = scope.signal;
    const revision = requestedRevision;
    busy = true; setLoading(true);
    try {
      if (refreshing) {
        const row = stale[0];
        const replacement = row.index < (props.field.count ?? 0) ? await load(row.index, signal, revision) : undefined;
        signal.throwIfAborted();
        commit(rows().filter(value => value.index < (props.field.count ?? 0)).map(value => value.index === row.index && replacement
          ? { ...replacement, value: retainEqualValue(value.value, replacement.value), raw: retainEqualValue(value.raw, replacement.raw) } : value));
        lastOperation = 'refresh';
      } else {
        const row = await load(seek ?? (needBefore ? before - 1 : after), signal, revision);
        signal.throwIfAborted();
        readingIndex = row.index;
        commit([...rows(), row].sort((a, b) => a.index - b.index));
        lastOperation = 'read';
      }
    } catch (error) {
      if (!signal.aborted) { recoverable = recoverableHistoryRead(error); setFailed(true); }
    } finally {
      if (signal === scope.signal) { busy = false; setLoading(false); schedule(); }
    }
  };
  createEffect(() => {
    const key = JSON.stringify([props.threadID, props.itemID, props.field.path]);
    const nextLifetime = JSON.stringify([key, active(), props.connection]);
    if (nextLifetime !== lifetime) {
      scope.abort(); scope = new AbortController(); lifetime = nextLifetime;
      busy = false; setLoading(false); recoverable = false;
    }
    if (key !== ownerKey) {
      ownerKey = key;
      busy = false; setRows([]); setGaps([]); setLoading(false); direction = 'after'; previousTop = 0; readingIndex = 0;
      if (viewport) viewport.scrollTop = 0;
    }
    requestedRevision = JSON.stringify([props.revision ?? props.field, props.connection]);
    setFailed(false);
    schedule();
  });
  onMount(() => {
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting);
      if (!visible) { scope.abort(); scope = new AbortController(); busy = false; setLoading(false); }
      else schedule();
    }, { rootMargin: '320px' });
    observer.observe(viewport);
    const resize = new ResizeObserver(schedule); resize.observe(viewport);
    const online = () => { if (recoverable) { recoverable = false; setFailed(false); schedule(); } };
    globalThis.addEventListener('online', online);
    onCleanup(() => { observer.disconnect(); resize.disconnect(); globalThis.removeEventListener('online', online); });
  });
  onCleanup(() => { disposed = true; scope.abort(); cancelAnimationFrame(frame); });
  return <section class="flower-activity-field-rows" data-activity-section={props.section} data-inline={props.inline || undefined}>
    <div ref={viewport} class="flower-activity-field-rows-viewport" tabindex={props.inline ? undefined : 0} role={props.inline ? undefined : 'region'}
      aria-label={props.inline ? undefined : props.section === 'inputs' ? props.copy.toolActivity.inputs : props.copy.toolActivity.results}
      style={{ 'max-height': '28rem', overflow: props.inline ? 'hidden' : 'auto', 'overflow-anchor': 'none' }}
      onScroll={() => {
        if (Math.abs(viewport.scrollTop - previousTop) > 1) direction = viewport.scrollTop < previousTop ? 'before' : 'after';
        previousTop = viewport.scrollTop; schedule();
      }}>
      <For each={rows().map(row => row.index)}>{index => {
        const row = createMemo(() => rows().find(row => row.index === index)!);
        return <><Show when={gaps().find(gap => gap.last === index)}>{gap =>
          <div aria-hidden="true" data-activity-row-gap={gap().first} data-activity-row-gap-end={gap().last}
            style={{ height: gap().height + 'px' }} />
        }</Show><div data-activity-row-index={index}><Show when={props.renderValue} fallback={<FlowerActivityRows continuous
          block={{ kind: 'structured_rows', section: props.section, rows: row().value ? [row().value!] : [] }}
          copy={props.copy} renderTargetActions={props.renderTargetActions}
          renderContent={row().content ? () => <ActivityFieldText reader={props.reader} threadID={props.threadID} itemID={props.itemID}
            field={row().content!} label={row().value?.title || props.copy.toolActivity.results} loadingLabel={props.copy.history.loading}
            failedLabel={props.copy.history.failed} active={active()} connection={props.connection} /> : undefined} />}>{render => render()(row().raw, index)}</Show></div></>;
      }}</For>
    </div>
    <Show when={failed()}><span role="status" title={props.inline ? props.copy.history.failed : undefined}>{props.copy.history.failed}</span></Show>
    <Show when={loading() && !rows().length}><span role="status" title={props.inline ? props.copy.history.loading : undefined}>{props.copy.history.loading}</span></Show>
  </section>;
}
