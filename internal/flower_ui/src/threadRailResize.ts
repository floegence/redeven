export const THREAD_RAIL_WIDTH_STORAGE_KEY = 'redeven.flower.threadRailWidth';
export const THREAD_RAIL_WIDTH_DEFAULT = 272;
export const THREAD_RAIL_WIDTH_MIN = 220;
export const THREAD_RAIL_WIDTH_MAX = 380;

export function clampThreadRailWidth(width: number): number {
  return Math.min(THREAD_RAIL_WIDTH_MAX, Math.max(THREAD_RAIL_WIDTH_MIN, Math.round(width)));
}

export function loadThreadRailWidth(): number {
  try {
    const stored = window.localStorage.getItem(THREAD_RAIL_WIDTH_STORAGE_KEY);
    const value = stored?.trim() ? Number(stored) : NaN;
    return Number.isFinite(value) ? clampThreadRailWidth(value) : THREAD_RAIL_WIDTH_DEFAULT;
  } catch { return THREAD_RAIL_WIDTH_DEFAULT; }
}

export function saveThreadRailWidth(width: number): void {
  try { window.localStorage.setItem(THREAD_RAIL_WIDTH_STORAGE_KEY, String(width)); } catch {
    // A blocked or full preference store must not interrupt local interaction.
  }
}

/** One transient gesture owns capture, the latest sample and its pending frame. */
export function createThreadRailResize(options: Readonly<{
  width: () => number;
  setWidth: (width: number) => void;
  save: (width: number) => void;
}>) {
  let finish: (() => void) | undefined;
  const stop = () => finish?.();
  const start = (event: PointerEvent) => {
    if (finish || !event.isPrimary || event.button !== 0) return;
    const handle = event.currentTarget as HTMLElement;
    const document = handle.ownerDocument;
    const window = document.defaultView!;
    const pointerID = event.pointerId;
    const startX = event.clientX;
    const startWidth = options.width();
    let latestX = startX;
    let frame: number | undefined;
    try { handle.setPointerCapture(pointerID); } catch { return; }
    event.preventDefault();
    // A local shield provides a stable cursor and blocks selection/iframes,
    // without changing inherited styles or classes on the conversation root.
    const shield = document.createElement('div');
    shield.className = 'flower-thread-rail-drag-shield';
    shield.setAttribute('aria-hidden', 'true');
    document.body.append(shield);
    handle.dataset.resizing = 'true';
    const flush = () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      frame = undefined;
      const width = clampThreadRailWidth(startWidth + latestX - startX);
      if (width !== options.width()) options.setWidth(width);
    };
    const preventSelection = (selection: Event) => selection.preventDefault();
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerID) return;
      latestX = next.clientX;
      if (frame === undefined) frame = window.requestAnimationFrame(flush);
    };
    const end = (next: PointerEvent) => {
      if (next.pointerId !== pointerID) return;
      if (next.type === 'pointerup') latestX = next.clientX;
      stop();
    };
    finish = () => {
      finish = undefined;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', stop);
      handle.removeEventListener('lostpointercapture', end);
      document.removeEventListener('selectstart', preventSelection, true);
      shield.remove();
      delete handle.dataset.resizing;
      if (handle.hasPointerCapture(pointerID)) handle.releasePointerCapture(pointerID);
      flush();
      if (options.width() !== startWidth) options.save(options.width());
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', stop);
    handle.addEventListener('lostpointercapture', end);
    document.addEventListener('selectstart', preventSelection, true);
  };
  const nudge = (delta: number) => {
    stop();
    const width = clampThreadRailWidth(options.width() + delta);
    if (width === options.width()) return;
    options.setWidth(width);
    options.save(width);
  };
  return { start, stop, nudge };
}
