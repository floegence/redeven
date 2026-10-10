import type { TessivenViewportControl } from '../TessivenGraph';

type Point = { x: number; y: number };

// Touch has one viewport owner. Do not also start InfiniteCanvas's mouse drag,
// which holds a private viewport and defers external zoom until pointer release.
export function attachTouchViewport(host: HTMLElement, control: () => TessivenViewportControl | undefined) {
  const points = new Map<number, Point>();
  let rendered: Point[] = [];
  let frame: number | undefined;
  let moved = false;
  let suppressClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  const center = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const flush = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    const next = [...points.values()];
    const viewport = control();
    if (viewport && rendered.length === next.length) {
      if (next.length === 1) viewport.pan(next[0].x - rendered[0].x, next[0].y - rendered[0].y);
      else if (next.length === 2) {
        const before = center(rendered[0], rendered[1]), after = center(next[0], next[1]);
        viewport.zoom(distance(next[0], next[1]) / Math.max(1, distance(rendered[0], rendered[1])), before.x, before.y, after.x - before.x, after.y - before.y);
      }
    }
    rendered = next;
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !control()) return;
    const target = event.target instanceof Element ? event.target : undefined;
    if (!points.size && (!target?.closest('.floe-infinite-canvas') || target.closest('button, a, input, select, textarea'))) return;
    // A third finger cannot replace either active anchor.
    if (points.size >= 2) { event.stopPropagation(); return; }
    if (!points.size) { moved = false; suppressClick = false; }
    flush();
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    rendered = [...points.values()];
    event.stopPropagation();
  };
  const move = (event: PointerEvent) => {
    const previous = points.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    if (!moved && Math.hypot(next.x - previous.x, next.y - previous.y) < 3) return;
    moved = true;
    points.set(event.pointerId, next);
    event.preventDefault();
    event.stopPropagation();
    if (frame === undefined) frame = requestAnimationFrame(flush);
  };
  const up = (event: PointerEvent) => {
    if (!points.has(event.pointerId)) return;
    flush();
    points.delete(event.pointerId);
    rendered = [...points.values()];
    if (!points.size && moved) {
      suppressClick = true;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => { suppressClick = false; }, 0);
    }
    event.stopPropagation();
  };
  const reset = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    points.clear();
    rendered = [];
    moved = false;
  };
  const click = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  host.addEventListener('pointerdown', down, true);
  host.addEventListener('click', click, true);
  document.addEventListener('pointermove', move, { capture: true, passive: false });
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', reset, true);
  window.addEventListener('blur', reset);
  document.addEventListener('visibilitychange', reset);
  const dispose = () => {
    reset();
    clearTimeout(clickTimer);
    host.removeEventListener('pointerdown', down, true);
    host.removeEventListener('click', click, true);
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', reset, true);
    window.removeEventListener('blur', reset);
    document.removeEventListener('visibilitychange', reset);
  };
  return { reset, dispose };
}
