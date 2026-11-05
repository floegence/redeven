import { children, createEffect, createRoot, getOwner, onCleanup, untrack, type JSX } from 'solid-js';

/** Animate an explicit disclosure without remounting retained conversation rows. */
export function animateFlowerThreadRowsChange(container: HTMLElement | null | undefined, change: () => void): void {
  if (!container || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    change();
    return;
  }
  const bounds = container.getBoundingClientRect();
  const before = new Map(Array.from(container.children).filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map(element => [element, element.getBoundingClientRect()] as const));
  change();
  const after = container.getBoundingClientRect();
  for (const [element, rect] of before) {
    if (element.parentElement !== container || !element.isConnected) continue;
    for (const animation of element.getAnimations()) {
      if (animation.id === 'flower-thread-layout') animation.cancel();
    }
    const target = element.getBoundingClientRect();
    const offsetX = rect.left - bounds.left - (target.left - after.left);
    const offsetY = rect.top - bounds.top - (target.top - after.top);
    if (Math.abs(offsetX) < 1 && Math.abs(offsetY) < 1) continue;
    const animation = element.animate([{ transform: `translate(${offsetX}px, ${offsetY}px)` }, { transform: 'translate(0, 0)' }], {
      duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
    animation.id = 'flower-thread-layout';
  }
  for (const element of Array.from(container.children)) {
    if (!(element instanceof HTMLElement) || before.has(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue;
    const animation = element.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'translateY(0)' }], {
      duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
    animation.id = 'flower-thread-layout';
  }
}

/** Move a retained row without restarting its live wave or losing keyboard focus. */
export function moveFlowerThreadRow(parent: HTMLElement, row: HTMLElement, before: Node | null): void {
  if (row.parentNode === parent && row.nextSibling === before) return;
  const moveBefore = (parent as HTMLElement & { moveBefore?: (node: Node, child: Node | null) => void }).moveBefore;
  if (row.parentNode === parent && typeof moveBefore === 'function') {
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
 * One sidebar owner retains root row elements across both order and group changes.
 * Solid's ordinary keyed insertion retains nodes but restarts CSS animations on moves.
 */
export function FlowerThreadRows(props: Readonly<{
  class?: string;
  keys: readonly string[];
  render: (key: string) => JSX.Element;
}>): JSX.Element {
  const owner = getOwner();
  const mounted = new Map<string, { element: HTMLElement; dispose: () => void }>();
  const container = <div class={props.class ?? 'flower-thread-rows'} /> as HTMLDivElement;
  createEffect(() => {
    const keys = props.keys;
    untrack(() => {
      const retained = new Set(keys);
      for (const [key, row] of mounted) {
        if (retained.has(key)) continue;
        const hadFocus = row.element.contains(document.activeElement);
        const neighbour = row.element.nextElementSibling ?? row.element.previousElementSibling;
        row.dispose();
        row.element.remove();
        mounted.delete(key);
        if (hadFocus) neighbour?.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
      }
      let before: Node | null = null;
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
        moveFlowerThreadRow(container, row.element, before);
        before = row.element;
      }
    });
  });
  onCleanup(() => { for (const row of mounted.values()) row.dispose(); mounted.clear(); });
  return container;
}
