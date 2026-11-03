import { createEffect, createSignal, onCleanup, untrack, type Accessor } from 'solid-js';
import type { FlowerScrollTailController } from './flowerScrollTail';
import type { FlowerToolSequenceProjection } from './flowerToolSequences';

export type FlowerToolSequenceElement = Readonly<{
  node: HTMLDivElement;
  slot: HTMLDivElement;
  body: HTMLDivElement;
  prepareArrival: () => number;
  prepareDestination: () => boolean;
  restore: (anchor: HTMLElement | undefined, top: number, offset: number) => void;
}>;

// Rendering remains with each canonical row's Solid owner. Only placement is
// shared, so a growing sequence gains one viewport without recreating details.
export function createFlowerToolSequenceLayout(projection: Accessor<FlowerToolSequenceProjection>, outerScroll: FlowerScrollTailController) {
  const elements = new Map<string, FlowerToolSequenceElement>();
  const [revision, setRevision] = createSignal(0);
  let disposed = false;
  let scheduled = false;
  const owners = new Map<string, { key: string; element: FlowerToolSequenceElement }>();
  const registrations = new Set<string>();
  let placed: FlowerToolSequenceProjection | undefined;
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
  const reading = new Map<string, { body: HTMLElement; bodyTop: number; anchor?: HTMLElement; top: number; offset: number }>();
  const captureReading = (current: FlowerToolSequenceProjection) => {
    for (const [key, value] of owners) {
      const next = current.groups.get(key);
      if (!next || next.nodeKeys[0] === value.key || reading.has(key)) continue;
      const owner = value.element;
      const bounds = owner.body.getBoundingClientRect();
      if (!bounds.height) continue;
      const focus = document.activeElement instanceof HTMLElement && owner.body.contains(document.activeElement)
        ? document.activeElement.closest<HTMLElement>('[data-flower-activity-item-id], [data-flower-message-id]') : undefined;
      const visible = document.elementFromPoint(Math.max(0, bounds.left + bounds.width / 2), Math.max(0, bounds.top + Math.min(12, bounds.height / 2)))
        ?.closest<HTMLElement>('[data-flower-activity-item-id], [data-flower-message-id]');
      const anchor = focus ?? (visible && owner.body.contains(visible) ? visible : undefined);
      reading.set(key, { body: owner.body, bodyTop: bounds.top, anchor, top: anchor?.getBoundingClientRect().top ?? 0, offset: owner.body.scrollTop });
    }
  };
  const place = () => {
    scheduled = false;
    if (disposed) return;
    const current = untrack(projection);
    // Projection facts are immutable. Status/title updates do not move rows;
    // append, prepend, split and registration affect only their own groups.
    const changed = new Set<string>();
    const rows = new Set(registrations);
    registrations.clear();
    for (const [key, prior] of current === placed ? [] : placed?.groups ?? []) {
      const next = current.groups.get(key);
      if (next === prior || next && next.nodeKeys.length === prior.nodeKeys.length
        && next.nodeKeys.every((node, index) => node === prior.nodeKeys[index])) continue;
      changed.add(key);
      for (const node of prior.nodeKeys) rows.add(node);
      if (next) for (const node of next.nodeKeys) rows.add(node);
    }
    for (const [key, group] of current === placed ? [] : current.groups) if (!placed?.groups.has(key)) {
      changed.add(key);
      for (const node of group.nodeKeys) rows.add(node);
    }
    for (const key of rows) {
      const group = current.members.get(key)?.group;
      if (group) changed.add(group.key);
    }
    placed = current;
    if (!rows.size && !changed.size) return;
    const selection = document.getSelection();
    const ranges = selection && !selection.isCollapsed
      ? Array.from({ length: selection.rangeCount }, (_, index) => {
        const range = selection.getRangeAt(index);
        return { start: range.startContainer, startOffset: range.startOffset, end: range.endContainer, endOffset: range.endOffset };
      }) : [];

    // Restore independent rows before grouping; never nest a group in itself.
    for (const key of rows) {
      const element = elements.get(key);
      if (!element) continue;
      const member = current.members.get(key);
      if (!member || member.first || !elements.has(member.group.nodeKeys[0])) move(element.slot, element.node, null);
    }
    for (const key of changed) {
      const group = current.groups.get(key);
      if (!group) { owners.delete(key); reading.delete(key); continue; }
      const first = elements.get(group.nodeKeys[0]);
      if (!first) { owners.delete(key); continue; }
      let next: ChildNode | null = null;
      for (let index = group.nodeKeys.length - 1; index > 0; index--) {
        const element = elements.get(group.nodeKeys[index]);
        if (!element) continue;
        move(first.body, element.node, next);
        next = element.node;
      }
      owners.set(key, { key: group.nodeKeys[0], element: first });
    }
    for (const [key, saved] of reading) {
      const first = owners.get(key)?.element;
      if (!first) continue;
      outerScroll.transferReadingAnchor(saved.body, first.body, saved.bodyTop);
      first.restore(saved.anchor, saved.top, saved.offset);
      reading.delete(key);
    }
    const selectionChanged = ranges.length && selection && (selection.rangeCount !== ranges.length || ranges.some((saved, index) => {
      const range = selection.getRangeAt(index);
      return range.startContainer !== saved.start || range.startOffset !== saved.startOffset
        || range.endContainer !== saved.end || range.endOffset !== saved.endOffset;
    }));
    if (selectionChanged && selection) {
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
  onCleanup(() => { disposed = true; elements.clear(); owners.clear(); reading.clear(); registrations.clear(); placed = undefined; });
  return {
    captureReading,
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
      registrations.add(key);
      setRevision(value => value + 1);
      return () => {
        if (elements.get(key) !== element) return;
        // Return borrowed children before disposing the owning row.
        for (const child of Array.from(element.body.children)) {
          const other = child instanceof HTMLElement ? elements.get(child.dataset.flowerToolRowIdentity ?? '') : undefined;
          if (other && other !== element && other.node === child) {
            move(other.slot, other.node, null);
            registrations.add(child.getAttribute('data-flower-tool-row-identity')!);
          }
        }
        elements.delete(key);
        registrations.add(key);
        element.node.remove();
        setRevision(value => value + 1);
      };
    },
  };
}
