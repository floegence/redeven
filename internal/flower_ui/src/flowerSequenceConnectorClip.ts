// Only the connector crossing the viewport's upper edge can be orphaned.
// Hit testing keeps this work constant in sequence length, with no observer,
// timer, reactive scroll state or scan of the mounted activity list.
export function createFlowerSequenceConnectorClip() {
  let clipped: HTMLElement | undefined;
  const clear = () => { clipped?.removeAttribute('data-flower-connector-clipped'); clipped = undefined; };
  return {
    clear,
    update(body: HTMLElement) {
      const bounds = body.getBoundingClientRect();
      const hit = body.ownerDocument.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + 1);
      const content = hit?.closest<HTMLElement>('.flower-tool-sequence-content');
      let next: HTMLElement | undefined;
      if (content && body.contains(content)) {
        const row = content.closest<HTMLElement>('.flower-tool-sequence-node')!;
        // Only an icon clipped above the viewport can leave an orphan. A
        // partially clipped row with a visible icon keeps its outgoing line.
        if (content.getBoundingClientRect().top < bounds.top - 1) next = content;
        else if (row.parentElement === body) {
          const previous = row.previousElementSibling;
          next = previous?.matches('.flower-tool-sequence-content') ? previous as HTMLElement
            : previous?.querySelector<HTMLElement>('.flower-tool-sequence-content') ?? undefined;
        }
        const icon = next?.querySelector('.flower-activity-inline-icon, .flower-parent-event-avatar');
        if (!icon || icon.getBoundingClientRect().bottom > bounds.top) next = undefined;
      }
      if (clipped === next) return;
      clear();
      clipped = next;
      clipped?.setAttribute('data-flower-connector-clipped', '');
    },
  };
}
