// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createThreadRailResize, loadThreadRailWidth, saveThreadRailWidth, THREAD_RAIL_WIDTH_STORAGE_KEY as key } from './threadRailResize';

let cleanup: (() => void) | undefined;
beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: vi.fn((key: string) => values.get(key) ?? null), setItem: vi.fn((key: string, value: string) => { values.set(key, value); }) });
});
afterEach(() => { cleanup?.(); cleanup = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

function harness() {
  let width = 272;
  let next = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++next, callback); return next; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
  const handle = document.createElement('button');
  document.body.append(handle);
  const capture = vi.fn();
  const release = vi.fn();
  Object.assign(handle, { setPointerCapture: capture, hasPointerCapture: () => true, releasePointerCapture: release });
  const setWidth = vi.fn(value => { width = value; });
  const save = vi.fn();
  const owner = createThreadRailResize({ width: () => width, setWidth, save });
  handle.addEventListener('pointerdown', owner.start);
  cleanup = owner.stop;
  const pointer = (type: string, x: number, extra: Partial<PointerEventInit> = {}, target: EventTarget = type === 'pointerdown' || type === 'lostpointercapture' ? handle : window) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, button: extra.button ?? 0, buttons: 1 });
    Object.assign(event, { pointerId: extra.pointerId ?? 7, isPrimary: extra.isPrimary ?? true });
    target.dispatchEvent(event);
    return event;
  };
  return { owner, handle, capture, release, setWidth, save, pointer, frames, width: () => width,
    flush() { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(0)); } };
}

describe('sidebar resize gesture', () => {
  it('applies only the latest sample once per frame and flushes release coordinates', () => {
    const h = harness();
    expect(h.pointer('pointerdown', 272).defaultPrevented).toBe(true);
    expect(h.capture).toHaveBeenCalledWith(7);
    for (let x = 273; x < 330; x++) h.pointer('pointermove', x);
    expect(h.frames.size).toBe(1);
    expect(h.setWidth).not.toHaveBeenCalled();
    h.flush();
    expect(h.setWidth.mock.calls).toEqual([[329]]);
    expect(h.save).not.toHaveBeenCalled();
    h.pointer('pointermove', 340);
    h.pointer('pointerup', 351);
    expect(h.width()).toBe(351);
    expect(h.save.mock.calls).toEqual([[351]]);
    expect(h.frames.size).toBe(0);
    expect(h.release).toHaveBeenCalledOnce();
    expect(document.querySelector('.flower-thread-rail-drag-shield')).toBeNull();
    h.pointer('pointermove', 220); h.pointer('pointerup', 220); h.owner.stop();
    expect(h.save).toHaveBeenCalledOnce();
  });

  it.each(['pointercancel', 'lostpointercapture', 'blur', 'dispose'])('settles %s without leaking a frame, selection blocker or listeners', ending => {
    const h = harness();
    h.pointer('pointerdown', 272); h.pointer('pointermove', 310);
    const selection = new Event('selectstart', { bubbles: true, cancelable: true });
    document.dispatchEvent(selection); expect(selection.defaultPrevented).toBe(true);
    if (ending === 'blur') window.dispatchEvent(new Event('blur'));
    else if (ending === 'dispose') h.owner.stop();
    else h.pointer(ending, 0);
    expect(h.width()).toBe(310);
    expect(h.frames.size).toBe(0);
    expect(h.handle.dataset.resizing).toBeUndefined();
    expect(document.querySelector('.flower-thread-rail-drag-shield')).toBeNull();
    const nextSelection = new Event('selectstart', { cancelable: true });
    document.dispatchEvent(nextSelection); expect(nextSelection.defaultPrevented).toBe(false);
    h.pointer('pointermove', 370); h.flush();
    expect(h.width()).toBe(310); expect(h.save.mock.calls).toEqual([[310]]);
  });

  it('ignores secondary pointers, buttons and competing gestures', () => {
    const h = harness();
    h.pointer('pointerdown', 272, { button: 2 }); h.pointer('pointerdown', 272, { isPrimary: false });
    expect(h.capture).not.toHaveBeenCalled();
    h.pointer('pointerdown', 272); h.pointer('pointerdown', 300, { pointerId: 8 });
    h.pointer('pointermove', 360, { pointerId: 8 }); h.pointer('pointerup', 360, { pointerId: 8 });
    expect(h.frames.size).toBe(0); expect(h.save).not.toHaveBeenCalled();
    expect(h.capture).toHaveBeenCalledOnce();
    h.pointer('pointermove', 300); h.pointer('pointerup', 300);
    expect(h.width()).toBe(300);
  });

  it('clamps both limits, reverses correctly and skips unchanged writes', () => {
    const h = harness(); h.pointer('pointerdown', 272);
    h.pointer('pointermove', 900); h.flush(); expect(h.width()).toBe(380);
    h.pointer('pointermove', 800); h.flush(); expect(h.setWidth).toHaveBeenCalledOnce();
    h.pointer('pointermove', 250); h.flush(); expect(h.width()).toBe(250);
    h.pointer('pointerup', -200); expect(h.width()).toBe(220);
    expect(h.save.mock.calls).toEqual([[220]]);
    h.owner.nudge(-16); expect(h.save).toHaveBeenCalledOnce();
    h.owner.nudge(16); expect(h.width()).toBe(236); expect(h.save).toHaveBeenLastCalledWith(236);
  });

  it('does not start a gesture when pointer capture fails', () => {
    const h = harness(); h.capture.mockImplementation(() => { throw new Error('Inactive pointer'); });
    h.pointer('pointerdown', 272); h.pointer('pointermove', 320);
    expect(h.frames.size).toBe(0); expect(h.handle.dataset.resizing).toBeUndefined();
    expect(document.querySelector('.flower-thread-rail-drag-shield')).toBeNull();
  });

  it('does not persist a click or a drag returning to its initial width', () => {
    const h = harness(); h.pointer('pointerdown', 272); h.pointer('pointerup', 272);
    h.pointer('pointerdown', 272); h.pointer('pointermove', 350); h.flush(); h.pointer('pointerup', 272);
    expect(h.width()).toBe(272); expect(h.save).not.toHaveBeenCalled();
  });
});

describe('sidebar width preference', () => {
  it.each([[null, 272], ['', 272], ['  ', 272], ['invalid', 272], ['Infinity', 272], ['310', 310], ['12', 220], ['900', 380]])('loads %s as %i', (stored, expected) => {
    if (stored !== null) window.localStorage.setItem(key, String(stored));
    expect(loadThreadRailWidth()).toBe(expected);
  });
  it('keeps interaction available with inaccessible or full storage', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Full'); });
    expect(loadThreadRailWidth()).toBe(272);
    expect(() => saveThreadRailWidth(320)).not.toThrow();
  });
});
