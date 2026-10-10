import type { TessivenViewportControl } from '../TessivenGraph';

type Point = { x: number; y: number };

// The fixed native renderer owns touch input; mouse and minimap retain Floe's owner.
export function attachTouchViewport(host: HTMLElement, control: () => TessivenViewportControl | undefined) {
  const points = new Map<number, Point>();
  let rendered: Point[] = [];
  let origin: Point | undefined;
  let bounds = { left: 0, top: 0 };
  let frame: number | undefined;
  let moving = false;
  let suppressUntil = 0;
  let velocity = { x: 0, y: 0 };
  let lastFrame = 0;
  let lastMove = 0;
  let coastStart = 0;
  const center = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const local = (event: PointerEvent) => ({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  const stopFrame = () => { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; };
  const flush = (now = performance.now()) => {
    stopFrame();
    const next = [...points.values()];
    const viewport = control();
    if (viewport && moving && rendered.length === next.length) {
      if (next.length === 1) {
        const dx = next[0].x - rendered[0].x, dy = next[0].y - rendered[0].y;
        if (dx || dy) {
          viewport.pan(dx, dy);
          const dt = Math.max(8, now - lastFrame);
          velocity = { x: velocity.x * 0.25 + dx / dt * 0.75, y: velocity.y * 0.25 + dy / dt * 0.75 };
        }
      } else if (next.length === 2) {
        const before = center(rendered[0], rendered[1]), after = center(next[0], next[1]);
        viewport.zoom(distance(next[0], next[1]) / Math.max(1, distance(rendered[0], rendered[1])), before.x, before.y, after.x - before.x, after.y - before.y);
      }
      rendered = next;
      lastFrame = now;
    }
  };
  const coast = (now: number) => {
    frame = undefined;
    const dt = Math.min(32, now - lastFrame), decay = Math.exp(-dt / 240);
    control()?.pan(velocity.x * 240 * (1 - decay), velocity.y * 240 * (1 - decay));
    velocity = { x: velocity.x * decay, y: velocity.y * decay };
    lastFrame = now;
    if (now - coastStart < 900 && Math.hypot(velocity.x, velocity.y) > 0.025) frame = requestAnimationFrame(coast);
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' || !control()) return;
    const target = event.target instanceof Element ? event.target : undefined;
    const surface = target?.closest<HTMLElement>('.floe-infinite-canvas');
    if (!points.size) {
      stopFrame();
      suppressUntil = 0;
      if (!surface || target?.closest('.floe-graph__minimap, .tessiven-popup, input, select, textarea')) return;
      bounds = surface.getBoundingClientRect();
      origin = local(event);
      moving = false;
    }
    if (points.size >= 2) { event.stopPropagation(); return; }
    flush();
    points.set(event.pointerId, local(event));
    rendered = [...points.values()];
    if (points.size === 2) moving = true;
    velocity = { x: 0, y: 0 };
    lastFrame = lastMove = performance.now();
    event.stopPropagation();
  };
  const move = (event: PointerEvent) => {
    if (!points.has(event.pointerId)) return;
    const next = local(event);
    points.set(event.pointerId, next);
    if (!moving && origin && distance(origin, next) < 4) return;
    moving = true;
    lastMove = performance.now();
    event.preventDefault();
    event.stopPropagation();
    if (frame === undefined) frame = requestAnimationFrame(flush);
  };
  const up = (event: PointerEvent) => {
    if (!points.has(event.pointerId)) return;
    points.set(event.pointerId, local(event));
    const now = performance.now();
    flush(now);
    const wasPan = points.size === 1;
    points.delete(event.pointerId);
    rendered = [...points.values()];
    if (!points.size && moving) {
      suppressUntil = now + 500;
      if (wasPan && now - lastMove < 80 && !matchMedia('(prefers-reduced-motion: reduce)').matches && Math.hypot(velocity.x, velocity.y) > 0.15) {
        const speed = Math.hypot(velocity.x, velocity.y), cap = Math.min(1, 3 / speed);
        velocity = { x: velocity.x * cap, y: velocity.y * cap };
        coastStart = lastFrame = now;
        frame = requestAnimationFrame(coast);
      }
    } else { velocity = { x: 0, y: 0 }; lastFrame = now; }
    event.stopPropagation();
  };
  const reset = () => {
    stopFrame();
    if (moving) suppressUntil = performance.now() + 500;
    points.clear(); rendered = []; origin = undefined; moving = false; velocity = { x: 0, y: 0 };
  };
  const click = (event: MouseEvent) => {
    if (performance.now() >= suppressUntil || event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
  };
  host.addEventListener('pointerdown', down, true);
  host.addEventListener('click', click, true);
  document.addEventListener('pointermove', move, { capture: true, passive: false });
  document.addEventListener('pointerup', up, true);
  document.addEventListener('pointercancel', reset, true);
  window.addEventListener('blur', reset);
  window.addEventListener('resize', reset);
  document.addEventListener('visibilitychange', reset);
  const dispose = () => {
    reset();
    host.removeEventListener('pointerdown', down, true);
    host.removeEventListener('click', click, true);
    document.removeEventListener('pointermove', move, true);
    document.removeEventListener('pointerup', up, true);
    document.removeEventListener('pointercancel', reset, true);
    window.removeEventListener('blur', reset);
    window.removeEventListener('resize', reset);
    document.removeEventListener('visibilitychange', reset);
  };
  return { reset, dispose };
}
