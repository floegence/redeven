// Virtual list hook using Fenwick tree (Binary Indexed Tree) for O(log n) prefix sum queries.

import { createSignal, createEffect, createMemo, onMount, onCleanup, untrack } from 'solid-js';
import type { VirtualListConfig } from '../types';

export interface VirtualItem {
  index: number;
  start: number;
  size: number;
  key: string;
}

export interface UseVirtualListOptions {
  count: () => number;
  getItemKey: (index: number) => string;
  getItemHeight: (index: number) => number;
  config: VirtualListConfig;
}

export interface UseVirtualListReturn {
  containerRef: (el: HTMLElement) => void;
  scrollRef: (el: HTMLElement) => void;
  onScroll: () => void;
  virtualItems: () => VirtualItem[];
  totalHeight: () => number;
  paddingTop: () => number;
  paddingBottom: () => number;
  scrollToIndex: (index: number, align?: 'start' | 'center' | 'end') => void;
  scrollToBottom: () => void;
  isAtBottom: () => boolean;
  visibleRange: () => { start: number; end: number };
  setItemHeight: (index: number, height: number) => void;
  getItemOffset: (index: number) => number;
}

// Fenwick tree (Binary Indexed Tree) utilities for O(log n) prefix sum queries.

/** Update the BIT by adding `delta` at 1-indexed position `i`. */
function bitUpdate(bit: number[], i: number, delta: number): void {
  for (; i < bit.length; i += i & -i) {
    bit[i] += delta;
  }
}

/** Query prefix sum for 1-indexed range [1..i]. */
function bitQuery(bit: number[], i: number): number {
  let sum = 0;
  for (; i > 0; i -= i & -i) {
    sum += bit[i];
  }
  return sum;
}

/** Build the BIT from a heights array (0-indexed). */
function bitBuild(heights: number[]): number[] {
  const n = heights.length;
  const bit = new Array(n + 1).fill(0);
  for (let i = 0; i < n; i++) {
    bitUpdate(bit, i + 1, heights[i]);
  }
  return bit;
}

/**
 * Compute the prefix sum of heights[0..i-1].
 * If i <= 0, returns 0.
 */
function prefixSum(bit: number[], i: number): number {
  if (i <= 0) return 0;
  return bitQuery(bit, i);
}

/**
 * Binary search in the BIT to find the index of the item at a given scroll offset.
 * Returns the 0-indexed item index whose cumulative height bracket contains `scrollTop`.
 */
function findIndex(bit: number[], scrollTop: number, count: number): number {
  if (count === 0 || scrollTop <= 0) return 0;

  let idx = 0;
  let bitMask = 1;
  // Find highest power of 2 <= count
  while (bitMask <= count) bitMask <<= 1;
  bitMask >>= 1;

  let sum = 0;
  while (bitMask > 0) {
    const next = idx + bitMask;
    if (next <= count && sum + bit[next] < scrollTop) {
      idx = next;
      sum += bit[next];
    }
    bitMask >>= 1;
  }

  // idx is now the 1-indexed position; convert to 0-indexed
  return Math.min(idx, count - 1);
}

export function useVirtualList(options: UseVirtualListOptions): UseVirtualListReturn {
  const { count, getItemKey, getItemHeight, config } = options;

  let containerEl: HTMLElement | null = null;
  let scrollEl: HTMLElement | null = null;

  const [scrollTop, setScrollTop] = createSignal(0);
  const [containerHeight, setContainerHeight] = createSignal(0);
  const [atBottom, setAtBottom] = createSignal(true);

  // Per-item height tracking
  let heights: number[] = [];
  let bit: number[] = [0];
  let prevCount = 0;

  // Pending rAF for batched updates
  let rafId: number | null = null;

  /** Normalize observed heights to reduce sub-pixel measurement noise. */
  function normalizeHeight(height: number): number {
    if (!Number.isFinite(height) || height <= 0) {
      return 0;
    }
    return Math.max(1, Math.round(height));
  }

  /** Ensure the BIT is sized for the current item count. */
  function ensureSize(n: number): void {
    if (n === prevCount) return;

    if (n > prevCount) {
      // Expand: add new items with default heights
      for (let i = prevCount; i < n; i++) {
        const h = getItemHeight(i);
        heights.push(h);
      }
    } else {
      // Shrink
      heights.length = n;
    }

    // Rebuild the BIT from scratch (simpler and safer on resize)
    bit = bitBuild(heights);
    prevCount = n;
  }

  // React to count changes
  createEffect(() => {
    const n = count();
    untrack(() => ensureSize(n));
  });

  // Compute the visible range with overscan
  const visibleRange = createMemo<{ start: number; end: number }>(() => {
    const n = count();
    if (n === 0) return { start: 0, end: 0 };

    ensureSize(n);

    const top = scrollTop();
    const viewHeight = containerHeight();

    const startIdx = findIndex(bit, top, n);
    const start = Math.max(0, startIdx - config.overscan);

    // Find end index: walk forward from startIdx until cumulative height exceeds top + viewHeight
    const endOffset = top + viewHeight;
    let endIdx = startIdx;
    while (endIdx < n && prefixSum(bit, endIdx + 1) < endOffset) {
      endIdx++;
    }
    const end = Math.min(n, endIdx + 1 + config.overscan);

    return { start, end };
  });

  // Map the visible range to VirtualItem array
  const virtualItems = createMemo<VirtualItem[]>(() => {
    const n = count();
    if (n === 0) return [];

    ensureSize(n);

    const { start, end } = visibleRange();
    const items: VirtualItem[] = [];

    for (let i = start; i < end && i < n; i++) {
      items.push({
        index: i,
        start: prefixSum(bit, i),
        size: heights[i] ?? config.defaultItemHeight,
        key: getItemKey(i),
      });
    }

    return items;
  });

  // Total height of all items
  const totalHeight = createMemo(() => {
    const n = count();
    if (n === 0) return 0;
    ensureSize(n);
    return prefixSum(bit, n);
  });

  // Padding before visible items
  const paddingTopMemo = createMemo(() => {
    const { start } = visibleRange();
    return prefixSum(bit, start);
  });

  // Padding after visible items
  const paddingBottomMemo = createMemo(() => {
    const total = totalHeight();
    const { end } = visibleRange();
    const endSum = prefixSum(bit, end);
    return Math.max(0, total - endSum);
  });

  // Scroll event handler
  function onScroll(): void {
    if (!scrollEl) return;

    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }

    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (!scrollEl) return;

      const newScrollTop = scrollEl.scrollTop;
      setScrollTop(newScrollTop);

      // Check if at bottom (within 50px threshold)
      const scrollHeight = scrollEl.scrollHeight;
      const clientHeight = scrollEl.clientHeight;
      setAtBottom(scrollHeight - newScrollTop - clientHeight < 50);
    });
  }

  // Update a single item height and propagate the delta to the BIT
  function setItemHeight(index: number, height: number): void {
    const n = count();
    ensureSize(n);

    if (index < 0 || index >= n) return;
    const normalizedHeight = normalizeHeight(height);
    if (normalizedHeight <= 0) return;

    const oldHeight = heights[index] ?? config.defaultItemHeight;
    if (Math.abs(oldHeight - normalizedHeight) < 1) return;

    const delta = normalizedHeight - oldHeight;
    heights[index] = normalizedHeight;
    bitUpdate(bit, index + 1, delta);

    // Trigger reactivity by touching scrollTop (read + write same value via rAF)
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
    }
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (scrollEl) {
        setScrollTop(scrollEl.scrollTop);
      }
    });
  }

  function getItemOffset(index: number): number {
    const n = count();
    ensureSize(n);
    const clampedIndex = Math.max(0, Math.min(index, n));
    return prefixSum(bit, clampedIndex);
  }

  // Scroll to a specific item index with alignment
  function scrollToIndex(index: number, align: 'start' | 'center' | 'end' = 'start'): void {
    if (!scrollEl) return;

    const n = count();
    ensureSize(n);

    const clampedIndex = Math.max(0, Math.min(index, n - 1));
    const itemStart = prefixSum(bit, clampedIndex);
    const itemSize = heights[clampedIndex] ?? config.defaultItemHeight;
    const viewHeight = containerHeight();

    let targetScroll: number;

    switch (align) {
      case 'start':
        targetScroll = itemStart;
        break;
      case 'center':
        targetScroll = itemStart - (viewHeight - itemSize) / 2;
        break;
      case 'end':
        targetScroll = itemStart - viewHeight + itemSize;
        break;
      default:
        targetScroll = itemStart;
    }

    scrollEl.scrollTop = Math.max(0, targetScroll);
    setScrollTop(scrollEl.scrollTop);
  }

  // Scroll to the bottom of the list
  function scrollToBottom(): void {
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    setScrollTop(scrollEl.scrollTop);
    setAtBottom(true);
  }

  // Container ref setter — also sets up ResizeObserver
  let resizeObserver: ResizeObserver | null = null;

  function containerRef(el: HTMLElement): void {
    containerEl = el;
    setContainerHeight(normalizeHeight(el.clientHeight));

    resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height =
          entry.contentBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const normalizedHeight = normalizeHeight(height);
        if (normalizedHeight > 0) {
          setContainerHeight(normalizedHeight);
        }
      }
    });
    resizeObserver.observe(el);
  }

  // Scroll ref setter
  function scrollRefSetter(el: HTMLElement): void {
    scrollEl = el;
  }

  // Cleanup on unmount
  onCleanup(() => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  });

  return {
    containerRef,
    scrollRef: scrollRefSetter,
    onScroll,
    virtualItems,
    totalHeight,
    paddingTop: paddingTopMemo,
    paddingBottom: paddingBottomMemo,
    scrollToIndex,
    scrollToBottom,
    isAtBottom: atBottom,
    visibleRange,
    setItemHeight,
    getItemOffset,
  };
}
