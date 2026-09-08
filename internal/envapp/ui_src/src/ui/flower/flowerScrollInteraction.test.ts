// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { createFlowerScrollTailController } from '../../../../../flower_ui/src/flowerScrollTail';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); });

function harness() {
  const frames = new Map<number, FrameRequestCallback>();
  let nextID = 0;
  const viewport = document.createElement('div');
  const title = document.createElement('button');
  title.setAttribute('data-flower-disclosure-trigger', '');
  viewport.append(title);
  document.body.append(viewport);
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, writable: true, value: 500 },
  });
  viewport.scrollTop = 300;
  const controller = createFlowerScrollTailController({
    reducedMotionPreferred: () => true,
    requestAnimationFrame: (callback) => { frames.set(++nextID, callback); return nextID; },
    cancelAnimationFrame: (id) => { frames.delete(id); },
  });
  controller.bind(viewport);
  controller.stopFollowing();
  viewport.addEventListener('wheel', controller.onWheel);
  viewport.addEventListener('scroll', controller.onScroll);
  viewport.addEventListener('pointerdown', controller.onPointerDown);
  viewport.addEventListener('touchmove', controller.onTouchMove);
  viewport.addEventListener('keydown', controller.onKeyDown);
  title.addEventListener('click', () => controller.activateDisclosure(title));
  const frame = () => {
    const batch = [...frames.entries()];
    for (const [id, callback] of batch) {
      if (!frames.delete(id)) continue;
      callback(id * 16);
    }
  };
  const grow = () => {
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 620 });
    controller.measureAfterLayout();
    frame(); frame();
  };
  cleanups.push(() => { controller.dispose(); viewport.remove(); expect(frames.size).toBe(0); });
  return { controller, viewport, title, frame, grow };
}

function pointer(target: Element, type: string, pointerType = 'mouse') {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientY: 200 });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: pointerType } });
  target.dispatchEvent(event);
}
function touchMove(target: Element, clientY: number) {
  const event = new Event('touchmove', { bubbles: true });
  Object.defineProperty(event, 'touches', { value: [{ clientY }] });
  target.dispatchEvent(event);
}

describe('Flower viewport input ownership', () => {
  it.each(['wheel', 'touch', 'scrollbar', 'keyboard'])('resumes only after a %s gesture actually returns to the bottom', (source) => {
    const { viewport, title, controller, frame, grow } = harness();
    if (source === 'wheel') viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    if (source === 'touch') { pointer(viewport, 'pointerdown', 'touch'); touchMove(viewport, 100); }
    if (source === 'scrollbar') { pointer(viewport, 'pointerdown'); frame(); frame(); frame(); }
    if (source === 'keyboard') title.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    viewport.scrollTop = 400;
    viewport.dispatchEvent(new Event('scroll'));
    pointer(viewport, 'pointerup');
    grow();
    expect(viewport.scrollTop).toBe(520);
    expect(controller.showLatest()).toBe(false);
  });

  it('does not treat layout clamping during a user gesture as scrolling to latest', () => {
    const { viewport, grow } = harness();
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 20 }));
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 450 });
    viewport.scrollTop = 350;
    viewport.dispatchEvent(new Event('scroll'));
    grow();
    expect(viewport.scrollTop).toBe(350);
  });

  it('expires a wheel input that did not scroll before later layout events', () => {
    const { viewport, frame, grow } = harness();
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 20 }));
    frame(); frame();
    viewport.scrollTop = 400;
    viewport.dispatchEvent(new Event('scroll'));
    grow();
    expect(viewport.scrollTop).toBe(400);
  });

  it('leaves wheel and keyboard input in a nested terminal with its own viewport', () => {
    const { viewport, grow } = harness();
    const terminal = document.createElement('div');
    terminal.style.overflowY = 'auto';
    Object.defineProperties(terminal, { scrollHeight: { value: 500 }, clientHeight: { value: 100 } });
    viewport.append(terminal);
    terminal.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    terminal.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    viewport.scrollTop = 400;
    viewport.dispatchEvent(new Event('scroll'));
    grow();
    expect(viewport.scrollTop).toBe(400);
  });

  it('holds hidden float visibility through pointerup until native activation finishes', () => {
    const { controller, viewport, title, frame, grow } = harness();
    controller.scrollToBottom();
    pointer(title, 'pointerdown');
    grow();
    expect(viewport.scrollTop).toBe(400);
    expect(controller.showLatest()).toBe(false);
    expect(controller.latestPointerBlocked()).toBe(true);
    pointer(title, 'pointerup');
    expect(controller.showLatest()).toBe(false);
    title.click();
    frame();
    expect(controller.showLatest()).toBe(true);
    expect(controller.latestPointerBlocked()).toBe(false);
    controller.finishDisclosure(title);
  });

  it('keeps a visible float available when it is the original pointer target', () => {
    const { controller, viewport, frame } = harness();
    const latest = document.createElement('button');
    latest.setAttribute('data-flower-scroll-to-latest', '');
    latest.addEventListener('click', () => controller.scrollToBottom());
    viewport.append(latest);
    pointer(latest, 'pointerdown');
    viewport.scrollTop = 400;
    controller.onScroll();
    expect(controller.showLatest()).toBe(true);
    expect(controller.latestPointerBlocked()).toBe(false);
    pointer(latest, 'pointerup');
    latest.click();
    expect(controller.showLatest()).toBe(true);
    frame();
    expect(controller.showLatest()).toBe(false);
  });

  it.each(['pointercancel', 'blur', 'removed'])('restores prior following after an unactivated %s gesture', (reason) => {
    const { controller, viewport, title, frame, grow } = harness();
    controller.scrollToBottom();
    pointer(title, 'pointerdown');
    grow();
    if (reason === 'pointercancel') pointer(title, reason);
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'removed') title.remove();
    frame(); frame(); frame();
    expect(viewport.scrollTop).toBe(520);
    expect(controller.latestPointerBlocked()).toBe(false);
  });

  it('keeps reading after a touch pan cancels disclosure activation', () => {
    const { controller, viewport, title, frame, grow } = harness();
    controller.scrollToBottom();
    pointer(title, 'pointerdown', 'touch');
    touchMove(title, 300);
    viewport.scrollTop = 200;
    controller.onScroll();
    pointer(title, 'pointercancel', 'touch');
    frame();
    grow();
    expect(viewport.scrollTop).toBe(200);
  });

  it('protects a Space press until keyboard activation and releases on keyup', () => {
    const { controller, viewport, title, frame, grow } = harness();
    controller.scrollToBottom();
    title.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ' ' }));
    grow();
    expect(viewport.scrollTop).toBe(400);
    title.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    title.click();
    frame();
    expect(controller.latestPointerBlocked()).toBe(false);
    expect(controller.showLatest()).toBe(true);
    controller.finishDisclosure(title);
  });
});
