import { children, createEffect, createRoot, getOwner, onCleanup, untrack, type JSX } from 'solid-js';

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
  keys: readonly string[];
  render: (key: string) => JSX.Element;
}>): JSX.Element {
  const owner = getOwner();
  const mounted = new Map<string, { element: HTMLElement; dispose: () => void }>();
  const container = <div class="flower-thread-rows" /> as HTMLDivElement;
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
