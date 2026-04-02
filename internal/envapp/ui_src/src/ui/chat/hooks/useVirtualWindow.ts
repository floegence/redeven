import { createMemo, createSignal, onCleanup } from 'solid-js';
import type { Accessor } from 'solid-js';

export interface VirtualRange {
  start: number;
  end: number;
}

export interface UseVirtualWindowOptions {
  count: Accessor<number>;
  itemSize: Accessor<number>;
  overscan?: number;
}

export interface UseVirtualWindowReturn {
  scrollRef: (element: HTMLElement | null) => void;
  onScroll: () => void;
  range: Accessor<VirtualRange>;
  paddingTop: Accessor<number>;
  paddingBottom: Accessor<number>;
  totalSize: Accessor<number>;
}

export function useVirtualWindow(options: UseVirtualWindowOptions): UseVirtualWindowReturn {
  const overscan = options.overscan ?? 8;

  let scrollElement: HTMLElement | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let rafId: number | null = null;

  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportSize, setViewportSize] = createSignal(0);

  const readScrollState = () => {
    if (!scrollElement) return;
    setScrollTop(scrollElement.scrollTop);
    setViewportSize(scrollElement.clientHeight);
  };

  const onScroll = () => {
    if (!scrollElement) return;
    if (rafId !== null) return;

    if (typeof requestAnimationFrame !== 'function') {
      readScrollState();
      return;
    }

    rafId = requestAnimationFrame(() => {
      rafId = null;
      readScrollState();
    });
  };

  const range = createMemo<VirtualRange>(() => {
    const count = options.count();
    const itemSize = options.itemSize();
    const top = scrollTop();
    const viewport = viewportSize();

    if (count <= 0 || itemSize <= 0) {
      return { start: 0, end: 0 };
    }

    const start = Math.max(0, Math.floor(top / itemSize) - overscan);
    const end = Math.min(count, Math.ceil((top + viewport) / itemSize) + overscan);
    return { start, end };
  });

  const paddingTop = createMemo(() => range().start * options.itemSize());
  const paddingBottom = createMemo(() => Math.max(0, options.count() - range().end) * options.itemSize());
  const totalSize = createMemo(() => options.count() * options.itemSize());

  const scrollRef = (element: HTMLElement | null) => {
    if (scrollElement === element) return;

    resizeObserver?.disconnect();
    resizeObserver = null;
    scrollElement = element;

    if (!scrollElement) {
      return;
    }

    readScrollState();

    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    resizeObserver = new ResizeObserver(() => readScrollState());
    resizeObserver.observe(scrollElement);
  };

  onCleanup(() => {
    resizeObserver?.disconnect();
    if (rafId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  });

  return {
    scrollRef,
    onScroll,
    range,
    paddingTop,
    paddingBottom,
    totalSize,
  };
}
