import { batch, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';
import { calculateFitScale, useResizeObserver, type Size } from '@floegence/floe-webapp-core';

export type PreviewZoomMode = 'contain' | 'width' | 'actual' | 'manual';

/** Product zoom policy shared by the three sized file renderers. */
export function createPreviewZoom(options: {
  viewport: Accessor<HTMLElement | undefined>;
  content: Accessor<Size | null>;
  step: number;
  min: number;
  max: number;
  labelHeight?: number;
  /** PDF page labels and gaps do not scale with the page bitmap. */
  pageLayouts?: Accessor<readonly { top: number; height: number }[]>;
}) {
  const viewportSize = useResizeObserver(options.viewport);
  const [mode, setMode] = createSignal<PreviewZoomMode>('contain');
  const [manualScale, setManualScale] = createSignal(1);
  const scale = createMemo(() => {
    const content = options.content();
    const viewport = viewportSize();
    if (!content || !viewport) return null;
    const fit = calculateFitScale({ content, viewport: {
      width: viewport.width,
      height: Math.max(0, viewport.height - (options.labelHeight ?? 0)),
    }, mode: mode() === 'width' ? 'width' : 'contain' });
    if (fit === null) return null;
    return mode() === 'actual' ? 1 : mode() === 'manual' ? manualScale() : fit;
  });
  let anchorRevision = 0;
  onCleanup(() => { anchorRevision++; });
  const change = (update: () => void) => {
    const el = options.viewport();
    const before = scale();
    const revision = ++anchorRevision;
    const frame = el?.querySelector<HTMLElement>('[data-preview-zoom-content]');
    const padding = el ? getComputedStyle(el) : null;
    const leftInset = Number.parseFloat(padding?.paddingLeft ?? '') || 0;
    const topInset = Number.parseFloat(padding?.paddingTop ?? '') || 0;
    const center = el && before ? {
      x: (el.scrollLeft + el.clientWidth / 2 - leftInset - (frame?.offsetLeft ?? 0)) / before,
      y: (el.scrollTop + el.clientHeight / 2 - topInset - (frame?.offsetTop ?? 0)) / before,
    } : null;
    const localY = center && before ? center.y * before : 0;
    const pages = options.pageLayouts?.();
    const pageIndex = pages?.findIndex(page => page.top + (options.labelHeight ?? 0) + page.height > localY) ?? -1;
    const pageAnchor = pageIndex >= 0 && pages && before ? {
      index: pageIndex,
      y: (localY - pages[pageIndex]!.top - (options.labelHeight ?? 0)) / before,
    } : null;
    batch(update);
    const after = scale();
    if (el && center && after) queueMicrotask(() => {
      if (revision !== anchorRevision || el !== options.viewport()) return;
      el.scrollLeft = Math.max(0, center.x * after + leftInset + (frame?.offsetLeft ?? 0) - el.clientWidth / 2);
      const nextPage = pageAnchor ? options.pageLayouts?.()[pageAnchor.index] : undefined;
      const nextY = nextPage && pageAnchor ? nextPage.top + (options.labelHeight ?? 0) + pageAnchor.y * after : center.y * after;
      el.scrollTop = Math.max(0, nextY + topInset + (frame?.offsetTop ?? 0) - el.clientHeight / 2);
    });
  };
  const step = (direction: 1 | -1) => {
    const current = scale();
    if (current === null) return;
    const bounded = Math.min(options.max, Math.max(options.min, current + options.step * direction));
    const next = direction > 0 ? Math.max(current, bounded) : Math.min(current, bounded);
    if (next === current) return;
    change(() => { setManualScale(next); setMode('manual'); });
  };
  return {
    mode, scale, viewportSize,
    percent: () => {
      const value = scale();
      if (value === null) return '--';
      const percent = value * 100;
      return `${percent < 1 ? Number(percent.toPrecision(2)) : Math.round(percent)}%`;
    },
    canZoomIn: () => scale() !== null && scale()! < options.max,
    canZoomOut: () => scale() !== null && scale()! > options.min,
    zoomIn: () => step(1),
    zoomOut: () => step(-1),
    selectMode: (next: Exclude<PreviewZoomMode, 'manual'>) => change(() => setMode(next)),
    reset: () => { anchorRevision++; batch(() => { setMode('contain'); setManualScale(1); }); },
  };
}

export type PreviewZoom = ReturnType<typeof createPreviewZoom>;
