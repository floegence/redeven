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
    // Native movement retains embedded content and focus, but selection ranges
    // still need explicit restoration when a prepended group adopts old rows.
    const target = parent as HTMLElement & { moveBefore?: (node: Node, before: Node | null) => void };
    const focus = node.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
    if (target.moveBefore && parent.isConnected && node.isConnected) target.moveBefore(node, before);
    else parent.insertBefore(node, before);
    if (focus && document.activeElement !== focus) focus.focus({ preventScroll: true });
  };
  const place = () => {
    scheduled = false;
    if (disposed) return;
    const current = untrack(projection);
    const selection = document.getSelection();
    const ranges = selection && !selection.isCollapsed
      ? Array.from({ length: selection.rangeCount }, (_, index) => {
        const range = selection.getRangeAt(index);
        return { start: range.startContainer, startOffset: range.startOffset, end: range.endContainer, endOffset: range.endOffset };
      }) : [];

    // Restore independent rows before grouping; never nest a group in itself.
    for (const [key, element] of elements) {
      const member = current.members.get(key);
      if (!member || member.first || !elements.has(member.group.nodeKeys[0])) move(element.slot, element.node, null);
    }
    for (const group of current.groups.values()) {
      const first = elements.get(group.nodeKeys[0]);
      if (!first) continue;
      let next: ChildNode | null = null;
      for (const key of [...group.nodeKeys.slice(1)].reverse()) {
        const element = elements.get(key);
        if (!element) continue;
        move(first.body, element.node, next);
        next = element.node;
      }
    }
    const changed = ranges.length && selection && (selection.rangeCount !== ranges.length || ranges.some((saved, index) => {
      const range = selection.getRangeAt(index);
      return range.startContainer !== saved.start || range.startOffset !== saved.startOffset
        || range.endContainer !== saved.end || range.endOffset !== saved.endOffset;
    }));
    if (changed && selection) {
      selection.removeAllRanges();
      ranges.forEach(saved => {
        const range = document.createRange();
        range.setStart(saved.start, saved.startOffset);
        range.setEnd(saved.end, saved.endOffset);
        selection.addRange(range);
      });
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
      if (scheduled) return false;
      const latest = [...untrack(projection).groups.values()].at(-1);
      if (!latest || latest.disclosure !== 'manual') return true;
      return elements.get(latest.nodeKeys[0])?.prepareDestination() ?? false;
    },
    prepareArrival: (key: string) => {
      const member = untrack(projection).members.get(key);
      return member ? elements.get(member.group.nodeKeys[0])?.prepareArrival() ?? 0 : 0;
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
