import { createEffect, createSignal, onCleanup, untrack, type Accessor } from 'solid-js';
import type { FlowerToolSequenceProjection } from './flowerToolSequences';

export type FlowerToolSequenceElement = Readonly<{
  node: HTMLDivElement;
  slot: HTMLDivElement;
  body: HTMLDivElement;
  prepareArrival: () => number;
  prepareDestination: () => boolean;
}>;

// Rendering remains with each canonical row's Solid owner. Only placement is
// shared, so a growing sequence gains one viewport without recreating details.
export function createFlowerToolSequenceLayout(projection: Accessor<FlowerToolSequenceProjection>) {
  const elements = new Map<string, FlowerToolSequenceElement>();
  const [revision, setRevision] = createSignal(0);
  let disposed = false;
  let scheduled = false;
  const move = (parent: HTMLElement, node: HTMLElement, before: ChildNode | null) => {
    if (node.parentNode === parent && node.nextSibling === before) return;
    // Chromium preserves focus, selection and embedded content during a move.
    // Other supported browsers retain the same DOM with focus/ranges restored.
    const target = parent as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
    if (target.moveBefore && parent.isConnected && node.isConnected) {
      target.moveBefore(node, before);
      return;
    }
    const focus = node.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
    const selection = document.getSelection();
    const ranges = selection && !selection.isCollapsed
      ? Array.from({ length: selection.rangeCount }, (_, index) => {
        const range = selection.getRangeAt(index);
        return { start: range.startContainer, startOffset: range.startOffset, end: range.endContainer, endOffset: range.endOffset };
      }) : [];
    parent.insertBefore(node, before);
    focus?.focus({ preventScroll: true });
    if (ranges.length && selection) {
      selection.removeAllRanges();
      ranges.forEach(saved => {
        const range = document.createRange();
        range.setStart(saved.start, saved.startOffset);
        range.setEnd(saved.end, saved.endOffset);
        selection.addRange(range);
      });
    }
  };
  const place = () => {
    scheduled = false;
    if (disposed) return;
    const current = untrack(projection);
    // Restore independent rows before grouping; never nest a group in itself.
    for (const [key, element] of elements) {
      const member = current.members.get(key);
      if (!member || member.first || !elements.has(member.group.key)) move(element.slot, element.node, null);
    }
    for (const group of current.groups.values()) {
      const first = elements.get(group.key);
      if (!first) continue;
      let next: ChildNode | null = null;
      for (const key of [...group.nodeKeys.slice(1)].reverse()) {
        const element = elements.get(key);
        if (!element) continue;
        move(first.body, element.node, next);
        next = element.node;
      }
    }
  };
  createEffect(() => {
    projection();
    revision();
    if (!scheduled) { scheduled = true; queueMicrotask(place); }
  });
  onCleanup(() => { disposed = true; elements.clear(); });
  return {
    prepareDestination: () => {
      const latest = [...untrack(projection).groups.values()].at(-1);
      if (!latest || latest.disclosure !== 'manual') return true;
      if (scheduled) return false;
      return elements.get(latest.key)?.prepareDestination() ?? false;
    },
    prepareArrival: (key: string) => {
      const member = untrack(projection).members.get(key);
      return member ? elements.get(member.group.key)?.prepareArrival() ?? 0 : 0;
    },
    element: (key: string) => elements.get(key)?.node,
    register: (key: string, element: FlowerToolSequenceElement) => {
      elements.set(key, element);
      setRevision(value => value + 1);
      return () => {
        if (elements.get(key) !== element) return;
        // Return borrowed children before disposing the owning row.
        for (const other of elements.values()) {
          if (other !== element && other.node.parentNode === element.body) move(other.slot, other.node, null);
        }
        elements.delete(key);
        element.node.remove();
        setRevision(value => value + 1);
      };
    },
  };
}
