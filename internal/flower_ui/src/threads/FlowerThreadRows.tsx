import { children, createEffect, createRoot, getOwner, onCleanup, untrack, type JSX } from 'solid-js';

// Only explicit list interactions retain departing rows. Background updates and
// search never acquire motion ownership or delay removal.
const animatedChanges = new WeakSet<HTMLElement>();

/** Animate an explicit disclosure without remounting retained conversation rows. */
export function animateFlowerThreadRowsChange(container: HTMLElement | null | undefined, change: () => void): void {
  if (!container || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    change();
    return;
  }
  const bounds = container.getBoundingClientRect();
  const viewport = container.closest('.flower-scroll, .flower-workspaces-scroll')?.getBoundingClientRect() ?? bounds;
  const style = getComputedStyle(container);
  const duration = parseFloat(style.getPropertyValue('--floe-duration-base')) || 200;
  const easing = style.getPropertyValue('--floe-ease-out').trim() || 'ease-out';
  const before = new Map(Array.from(container.children).filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map(element => [element, { rect: element.getBoundingClientRect(), opacity: getComputedStyle(element).opacity }] as const));
  animatedChanges.add(container);
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
  type MountedRow = { element: HTMLElement; dispose: () => void; exit?: Animation; style?: string | null };
  const mounted = new Map<string, MountedRow>();
  const container = <div class={props.class ?? 'flower-thread-rows'} /> as HTMLDivElement;
  const remove = (key: string, row: MountedRow) => {
    row.exit?.cancel();
    row.dispose();
    row.element.remove();
    mounted.delete(key);
  };
  createEffect(() => {
    const keys = props.keys;
    const targets = props.targets;
    untrack(() => {
      const retained = new Set(keys);
      const departing = new Map(Array.from(mounted.entries())
        .filter(([key, row]) => !retained.has(key) && !row.exit && animatedChanges.has(row.element.parentElement!))
        .map(([key, row]) => [key, { rect: row.element.getBoundingClientRect(), opacity: getComputedStyle(row.element).opacity }] as const));
      for (const [key, row] of mounted) {
        const container = row.element.parentElement!;
        if (retained.has(key)) {
          if (row.exit) {
            row.exit.cancel();
            row.exit = undefined;
            if (row.style == null) row.element.removeAttribute('style'); else row.element.setAttribute('style', row.style);
            delete row.element.dataset.flowerThreadExiting;
            row.element.inert = false;
            row.element.removeAttribute('aria-hidden');
          }
          continue;
        }
        if (row.exit) {
          if (!animatedChanges.has(container)) remove(key, row);
          continue;
        }
        const hadFocus = row.element.contains(document.activeElement);
        const neighbour = row.element.nextElementSibling ?? row.element.previousElementSibling;
        if (hadFocus) neighbour?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
        const snapshot = departing.get(key);
        if (!snapshot) { remove(key, row); continue; }
        const { rect, opacity } = snapshot;
        const viewport = container.closest('.flower-scroll, .flower-workspaces-scroll')?.getBoundingClientRect();
        if (!animatedChanges.has(container) || (viewport && (rect.bottom < viewport.top || rect.top > viewport.bottom))) {
          remove(key, row);
          continue;
        }
        const bounds = container.getBoundingClientRect();
        for (const animation of row.element.getAnimations()) if (animation.id === 'flower-thread-layout') animation.cancel();
        row.style = row.element.getAttribute('style');
        Object.assign(row.element.style, { position: 'absolute', left: `${rect.left - bounds.left}px`, top: `${rect.top - bounds.top}px`, width: `${rect.width}px`, margin: '0', pointerEvents: 'none' });
        row.element.inert = true;
        row.element.setAttribute('aria-hidden', 'true');
        row.element.dataset.flowerThreadExiting = 'true';
        const style = getComputedStyle(container);
        const exit = row.element.animate([{ opacity, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-4px)' }], {
          duration: parseFloat(style.getPropertyValue('--floe-duration-fast')) || 140,
          easing: style.getPropertyValue('--floe-ease-out').trim() || 'ease-out', fill: 'forwards',
        });
        row.exit = exit;
        exit.id = 'flower-thread-exit';
        exit.onfinish = () => { if (row.exit === exit) remove(key, row); };
      }
      const beforeByParent = new Map<HTMLElement, Node>();
      for (let index = keys.length - 1; index >= 0; index--) {
        const key = keys[index];
        let row = mounted.get(key);
        if (!row) {
          row = createRoot((dispose) => {
            const element = children(() => props.render(key))();
            if (!(element instanceof HTMLElement)) throw new Error('A Flower sidebar row must have one root element.');
            return { element, dispose };
          }, owner);
          mounted.set(key, row);
        }
        const parent = targets?.get(key) ?? container;
        moveFlowerThreadRow(parent, row.element, beforeByParent.get(parent) ?? null);
        beforeByParent.set(parent, row.element);
      }
    });
  });
  onCleanup(() => { for (const [key, row] of mounted) remove(key, row); });
  return container;
}
