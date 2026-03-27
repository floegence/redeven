import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

const DEFAULT_ROW_HEIGHT = 52;
const DEFAULT_OVERSCAN = 8;

export interface GitVirtualTableProps<T> {
  items: T[];
  totalCount?: number;
  header: JSX.Element;
  renderRow: (item: T, index: number) => JSX.Element;
  colSpan: number;
  tableClass: string;
  viewportClass?: string;
  rowHeight?: number;
  overscan?: number;
}

export function GitVirtualTable<T>(props: GitVirtualTableProps<T>) {
  let viewportEl: HTMLDivElement | undefined;

  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);

  const rowHeight = () => Math.max(1, Math.round(props.rowHeight ?? DEFAULT_ROW_HEIGHT));
  const overscan = () => Math.max(1, Math.round(props.overscan ?? DEFAULT_OVERSCAN));
  const loadedCount = () => props.items.length;
  const totalCount = () => {
    const count = props.totalCount;
    return Number.isFinite(count) ? Math.max(0, Math.round(count ?? 0)) : loadedCount();
  };
  const virtualCount = () => Math.max(loadedCount(), totalCount());

  const visibleRange = createMemo(() => {
    const count = virtualCount();
    if (count <= 0) return { start: 0, end: 0 };
    const start = Math.max(0, Math.floor(scrollTop() / rowHeight()) - overscan());
    const visibleCount = Math.max(1, Math.ceil(Math.max(viewportHeight(), rowHeight()) / rowHeight()));
    const end = Math.min(count, start + visibleCount + overscan() * 2);
    return { start, end };
  });

  const renderedRange = createMemo(() => {
    const { start, end } = visibleRange();
    const count = loadedCount();
    const renderStart = Math.min(start, count);
    const renderEnd = Math.min(end, count);
    return { start: renderStart, end: renderEnd };
  });

  const visibleItems = createMemo(() => {
    const { start, end } = renderedRange();
    return props.items.slice(start, end).map((item, offset) => ({
      item,
      index: start + offset,
    }));
  });

  const topSpacerHeight = createMemo(() => visibleRange().start * rowHeight());
  const bottomSpacerHeight = createMemo(() => {
    const renderedCount = Math.max(0, renderedRange().end - renderedRange().start);
    return Math.max(0, (virtualCount() - visibleRange().start - renderedCount) * rowHeight());
  });

  const syncViewport = () => {
    if (!viewportEl) return;
    setScrollTop(viewportEl.scrollTop);
    setViewportHeight(viewportEl.clientHeight);
  };

  onMount(() => {
    syncViewport();
    const onResize = () => syncViewport();
    window.addEventListener('resize', onResize);
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => syncViewport())
      : null;
    if (viewportEl && resizeObserver) {
      resizeObserver.observe(viewportEl);
    }
    onCleanup(() => {
      window.removeEventListener('resize', onResize);
      resizeObserver?.disconnect();
    });
  });

  return (
    <div
      ref={viewportEl}
      onScroll={syncViewport}
      class={cn('min-h-0 flex-1 overflow-auto', props.viewportClass)}
    >
      <table class={props.tableClass}>
        <thead>{props.header}</thead>
        <tbody>
          <Show when={topSpacerHeight() > 0}>
            <tr aria-hidden="true">
              <td colSpan={props.colSpan} style={{ height: `${topSpacerHeight()}px`, padding: '0', border: '0' }} />
            </tr>
          </Show>

          <For each={visibleItems()}>
            {({ item, index }) => props.renderRow(item, index)}
          </For>

          <Show when={bottomSpacerHeight() > 0}>
            <tr aria-hidden="true">
              <td colSpan={props.colSpan} style={{ height: `${bottomSpacerHeight()}px`, padding: '0', border: '0' }} />
            </tr>
          </Show>
        </tbody>
      </table>
    </div>
  );
}
