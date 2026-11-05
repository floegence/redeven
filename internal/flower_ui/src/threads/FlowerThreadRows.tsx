import { children, createEffect, createRoot, getOwner, onCleanup, untrack, type JSX } from 'solid-js';

// Only explicit list interactions retain departing rows. Background updates and
// search never acquire motion ownership or delay removal.
const animatedChanges = new WeakMap<HTMLElement, 'layout' | 'disclosure'>();

/** Animate an explicit disclosure without remounting retained conversation rows. */
export function animateFlowerThreadRowsChange(container: HTMLElement | null | undefined, change: () => void, motion: 'layout' | 'disclosure' = 'layout'): void {
  if (!container || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    change();
    return;
  }
  if (motion === 'disclosure') {
    animatedChanges.set(container, motion);
    try { change(); } finally { animatedChanges.delete(container); }
    return;
  }
  const bounds = container.getBoundingClientRect();
  const viewport = container.closest('.flower-scroll, .flower-workspaces-scroll')?.getBoundingClientRect() ?? bounds;
  const style = getComputedStyle(container);
  const duration = parseFloat(style.getPropertyValue('--floe-duration-base')) || 200;
  const easing = style.getPropertyValue('--floe-ease-out').trim() || 'ease-out';
  const before = new Map(Array.from(container.children).filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map(element => [element, { rect: element.getBoundingClientRect(), opacity: getComputedStyle(element).opacity }] as const));
  animatedChanges.set(container, motion);
  try { change(); } finally { animatedChanges.delete(container); }
  const after = container.getBoundingClientRect();
  for (const element of Array.from(container.children)) {
    if (!(element instanceof HTMLElement) || element.dataset.flowerThreadExiting) continue;
    const previous = before.get(element);
    for (const animation of element.getAnimations()) if (animation.id === 'flower-thread-layout') animation.cancel();
    const target = element.getBoundingClientRect();
    const wasVisible = previous && previous.rect.bottom >= viewport.top && previous.rect.top <= viewport.bottom;
    if (!wasVisible && (target.bottom < viewport.top || target.top > viewport.bottom)) continue;
    const offsetX = previous ? previous.rect.left - bounds.left - (target.left - after.left) : 0;
    const offsetY = previous ? previous.rect.top - bounds.top - (target.top - after.top) : -4;
    if (previous && Math.abs(offsetX) < 1 && Math.abs(offsetY) < 1 && Number(previous.opacity) >= 1) continue;
    const animation = element.animate([
      { opacity: previous?.opacity ?? 0, transform: `translate(${offsetX}px, ${offsetY}px)` },
      { opacity: 1, transform: 'translate(0, 0)' },
    ], { duration, easing });
    animation.id = 'flower-thread-layout';
  }
}

/** Move a retained row without restarting its live wave or losing keyboard focus. */
export function moveFlowerThreadRow(parent: HTMLElement, row: HTMLElement, before: Node | null): void {
  if (row.parentNode === parent && row.nextSibling === before) return;
  const moveBefore = (parent as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }).moveBefore;
  if (row.isConnected && parent.isConnected && typeof moveBefore === 'function') {
    moveBefore.call(parent, row, before);
    return;
  }
  // Older browser engines lack state-preserving DOM moves. Preserve only the
  // Flower-owned animation, not unrelated animations elsewhere in the shell.
  const focus = row.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
  const waves = Array.from(row.querySelectorAll<HTMLElement>('.flower-thread-wave-bar')).map((element) => ({
    element,
    time: element.getAnimations?.()[0]?.currentTime,
  }));
  parent.insertBefore(row, before);
  for (const { element, time } of waves) {
    const animation = element.getAnimations?.()[0];
    if (animation && time != null) animation.currentTime = time;
  }
  if (focus?.isConnected && document.activeElement !== focus) focus.focus({ preventScroll: true });
}

/**
 * One owner retains row elements across order, group and workspace-container changes.
 * Solid's ordinary keyed insertion retains nodes but restarts CSS animations on moves.
 */
export function FlowerThreadRows(props: Readonly<{
  class?: string;
  keys: readonly string[];
  targets?: ReadonlyMap<string, HTMLElement>;
  render: (key: string) => JSX.Element;
}>): JSX.Element {
  const owner = getOwner();
  type MountedRow = { element: HTMLElement; dispose: () => void; exit?: Animation; enter?: Animation; style?: string | null };
  const mounted = new Map<string, MountedRow>();
  const container = <div class={props.class ?? 'flower-thread-rows'} /> as HTMLDivElement;
  const remove = (key: string, row: MountedRow) => {
    row.exit?.cancel();
    row.enter?.cancel();
    row.dispose();
    row.element.remove();
    mounted.delete(key);
  };
  const restoreStyle = (row: MountedRow) => {
    if (row.style == null) row.element.removeAttribute('style'); else row.element.setAttribute('style', row.style);
    row.style = undefined;
  };
  type Disclosure = { row: MountedRow; height: number; opacity: string; exiting: boolean; removeRow?: () => void };
  const disclose = (changes: Disclosure[]) => {
    // One reveal edge traverses the batch. Earlier rows keep their natural
    // spacing instead of every line being compressed at the same time.
    const naturalHeights = changes.map(({ row }) => row.element.getBoundingClientRect().height);
    const initial = changes.reduce((sum, change) => sum + change.height, 0);
    const target = changes[0].exiting ? 0 : naturalHeights.reduce((sum, height) => sum + height, 0);
    let offset = 0;
    changes.forEach(({ row, height, opacity, exiting, removeRow }, index) => {
      row.style ??= row.element.getAttribute('style');
      const naturalHeight = naturalHeights[index];
      const targetHeight = exiting ? 0 : naturalHeight;
      Object.assign(row.element.style, { minHeight: '0', overflow: 'clip', flexShrink: '0' });
      const style = getComputedStyle(row.element);
      const boundaries = [offset, offset + naturalHeight]
        .map(edge => ({ progress: (edge - initial) / (target - initial), height: edge - offset }))
        .filter(edge => edge.progress > 0 && edge.progress < 1)
        .sort((a, b) => a.progress - b.progress);
      const keyframes: Keyframe[] = [
        { height: `${height}px`, opacity, offset: 0 },
        ...boundaries.map(edge => ({ height: `${edge.height}px`, opacity: edge.height === 0 ? 0 : 1, offset: edge.progress })),
        { height: `${targetHeight}px`, opacity: exiting ? 0 : 1, offset: 1 },
      ];
      offset += naturalHeight;
      const animation = row.element.animate(keyframes, { duration: parseFloat(style.getPropertyValue('--floe-duration-slow')) || 280,
        easing: style.getPropertyValue('--floe-ease-in-out').trim() || 'ease-in-out', fill: 'both' });
      animation.id = exiting ? 'flower-thread-exit' : 'flower-thread-disclosure';
      if (exiting) row.exit = animation; else row.enter = animation;
      animation.onfinish = () => {
        if (exiting) { if (row.exit === animation) removeRow?.(); }
        else if (row.enter === animation) { row.enter = undefined; animation.cancel(); restoreStyle(row); }
      };
    });
  };
  createEffect(() => {
    const keys = props.keys;
    const targets = props.targets;
    untrack(() => {
      const retained = new Set(keys);
      const entering = new Map<string, { height: number; opacity: string }>();
      const departing: Disclosure[] = [];
      const exitingParents = new Set<HTMLElement>();
      for (const [key, row] of mounted) {
        const parent = row.element.parentElement!;
        if (retained.has(key)) {
          if (row.exit) {
            const snapshot = { height: row.element.getBoundingClientRect().height, opacity: getComputedStyle(row.element).opacity };
            row.exit.cancel(); row.exit = undefined; restoreStyle(row);
            delete row.element.dataset.flowerThreadExiting;
            row.element.inert = false; row.element.removeAttribute('aria-hidden');
            if (animatedChanges.get(parent) === 'disclosure') entering.set(key, snapshot);
          }
          continue;
        }
        if (row.exit) {
          if (!animatedChanges.has(parent)) remove(key, row);
          else exitingParents.add(parent);
          continue;
        }
        if (row.element.contains(document.activeElement)) {
          (row.element.nextElementSibling ?? row.element.previousElementSibling)?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
        }
        if (animatedChanges.get(parent) !== 'disclosure') { remove(key, row); continue; }
        const height = row.element.getBoundingClientRect().height, opacity = getComputedStyle(row.element).opacity;
        row.enter?.cancel(); row.enter = undefined;
        if (row.style !== undefined) restoreStyle(row);
        row.element.inert = true; row.element.setAttribute('aria-hidden', 'true');
        row.element.dataset.flowerThreadExiting = 'true';
        departing.push({ row, height, opacity, exiting: true, removeRow: () => remove(key, row) });
        exitingParents.add(parent);
      }
      if (departing.length) {
        // Mounted insertion order can differ from the current displayed order.
        departing.sort((a, b) => a.row.element.compareDocumentPosition(b.row.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
        disclose(departing);
      }
      // Exiting rows keep their original slots until their height reaches zero.
      // Absolute positioning would collapse the group immediately and overlap
      // the next directory while the outgoing conversations are still visible.
      const keyByElement = exitingParents.size ? new Map(Array.from(mounted, ([key, row]) => [row.element, key])) : undefined;
      const exitsBefore = new Map<string | undefined, string[]>();
      for (const parent of exitingParents) {
        let next: string | undefined;
        for (const element of Array.from(parent.children).reverse()) {
          const key = keyByElement!.get(element as HTMLElement);
          if (!key) continue;
          if (retained.has(key)) next = key;
          else if (mounted.get(key)?.exit) {
            const pending = exitsBefore.get(next) ?? []; pending.unshift(key); exitsBefore.set(next, pending);
          }
        }
      }
      const ordered = exitingParents.size
        ? keys.flatMap(key => [...(exitsBefore.get(key) ?? []), key]).concat(exitsBefore.get(undefined) ?? [])
        : keys;
      const beforeByParent = new Map<HTMLElement, Node>();
      for (let index = ordered.length - 1; index >= 0; index--) {
        const key = ordered[index];
        let row = mounted.get(key);
        const parent = row?.exit ? row.element.parentElement! : targets?.get(key) ?? container;
        if (!row) {
          row = createRoot((dispose) => {
            const element = children(() => props.render(key))();
            if (!(element instanceof HTMLElement)) throw new Error('A Flower sidebar row must have one root element.');
            return { element, dispose };
          }, owner);
          mounted.set(key, row);
          if (animatedChanges.get(parent) === 'disclosure') entering.set(key, { height: 0, opacity: '0' });
        }
        moveFlowerThreadRow(parent, row.element, beforeByParent.get(parent) ?? null);
        beforeByParent.set(parent, row.element);
      }
      const arrivals = keys.filter(key => entering.has(key)).map(key => ({ row: mounted.get(key)!, ...entering.get(key)!, exiting: false }));
      if (arrivals.length) disclose(arrivals);
    });
  });
  onCleanup(() => { for (const [key, row] of mounted) remove(key, row); });
  return container;
}
