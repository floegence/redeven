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
  it.each(['wheel', 'touch', 'keyboard'])('keeps following short content after a %s input that cannot scroll', (source) => {
    const { controller, viewport, frame, grow } = harness();
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 100 });
    viewport.scrollTop = 0;
    controller.startFollowing();
    if (source === 'wheel') viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
    if (source === 'touch') { pointer(viewport, 'pointerdown', 'touch'); touchMove(viewport, 300); }
    if (source === 'keyboard') viewport.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    pointer(viewport, 'pointerup');
    frame(); frame(); frame();
    expect(controller.followingLatest()).toBe(true);
    grow();
    expect(viewport.scrollTop).toBe(520);
    expect(controller.showLatest()).toBe(false);
  });

  it('preserves an explicit reading pause when short content receives upward input', () => {
    const { controller, viewport, frame, grow } = harness();
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 100 });
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
    frame(); frame();
    grow();
    expect(controller.followingLatest()).toBe(false);
    expect(viewport.scrollTop).toBe(0);
  });

  it.each(['wheel', 'touch', 'scrollbar', 'keyboard'])('resumes when a %s scroll reaches the bottom during streamed growth', (source) => {
    const { controller, viewport, grow } = harness();
    if (source === 'wheel') viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 220 }));
    if (source === 'touch') { pointer(viewport, 'pointerdown', 'touch'); touchMove(viewport, 100); }
    if (source === 'scrollbar') pointer(viewport, 'pointerdown');
    if (source === 'keyboard') viewport.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'End' }));
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 580 });
    viewport.scrollTop = 480;
    viewport.dispatchEvent(new Event('scroll'));
    expect(controller.followingLatest()).toBe(true);
    pointer(viewport, 'pointerup');
    grow();
    expect(viewport.scrollTop).toBe(520);
    expect(controller.showLatest()).toBe(false);
  });

  it('schedules the final catch-up when content grows again before a return-to-bottom scroll event', () => {
    const { controller, viewport, frame } = harness();
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 220 }));
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 580 });
    viewport.scrollTop = 480;
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 780 });
    viewport.dispatchEvent(new Event('scroll'));
    expect(controller.followingLatest()).toBe(true);
    frame();
    expect(viewport.scrollTop).toBe(680);
  });

  it('does not resume an upward gesture when content growth and browser positioning move it forward', () => {
    const { controller, viewport, grow } = harness();
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -20 }));
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 580 });
    viewport.scrollTop = 480;
    viewport.dispatchEvent(new Event('scroll'));
    grow();
    expect(controller.followingLatest()).toBe(false);
    expect(viewport.scrollTop).toBe(480);
  });

  it('does not resume a partial downward scroll while content grows', () => {
    const { controller, viewport, grow } = harness();
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 40 }));
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, value: 580 });
    viewport.scrollTop = 340;
    viewport.dispatchEvent(new Event('scroll'));
    grow();
    expect(controller.followingLatest()).toBe(false);
    expect(viewport.scrollTop).toBe(340);
  });

  it('keeps following after clicking transcript whitespace without scrolling', () => {
    const { controller, viewport, frame, grow } = harness();
    controller.scrollToBottom();
    pointer(viewport, 'pointerdown');
    pointer(viewport, 'pointerup');
    frame(); frame(); frame();
    expect(controller.followingLatest()).toBe(true);
    grow();
    expect(viewport.scrollTop).toBe(520);
  });

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

  it.each(['wheel', 'touch', 'keyboard'])('pauses transcript following when %s leaves the top of a tool sequence', source => {
    const { controller, viewport, grow } = harness();
    const sequence = document.createElement('div');
    sequence.className = 'flower-tool-sequence-scroll';
    sequence.style.overflowY = 'auto';
    Object.defineProperties(sequence, { scrollHeight: { value: 500 }, clientHeight: { value: 100 } });
    const row = document.createElement('button');
    sequence.append(row);
    viewport.append(sequence);
    controller.startFollowing();
    if (source === 'wheel') row.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
    if (source === 'touch') { pointer(row, 'pointerdown', 'touch'); touchMove(row, 300); }
    if (source === 'keyboard') row.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    expect(controller.followingLatest()).toBe(false);
    viewport.scrollTop = 200;
    viewport.dispatchEvent(new Event('scroll'));
    pointer(row, 'pointerup');
    grow();
    expect(viewport.scrollTop).toBe(200);
  });

  it('resumes transcript following when scrolling past the last tool reaches the conversation tail', () => {
    const { controller, viewport, grow } = harness();
    const sequence = document.createElement('div');
    sequence.className = 'flower-tool-sequence-scroll';
    sequence.style.overflowY = 'auto';
    Object.defineProperties(sequence, { scrollHeight: { value: 500 }, clientHeight: { value: 100 } });
    sequence.scrollTop = 400;
    viewport.append(sequence);
    sequence.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 100 }));
    viewport.scrollTop = 400;
    viewport.dispatchEvent(new Event('scroll'));
    expect(controller.followingLatest()).toBe(true);
    grow();
    expect(viewport.scrollTop).toBe(520);
  });

  it('keeps interior tool scrolling and embedded terminal boundaries out of transcript following', () => {
    const { controller, viewport } = harness();
    const sequence = document.createElement('div');
    sequence.className = 'flower-tool-sequence-scroll';
    sequence.style.overflowY = 'auto';
    Object.defineProperties(sequence, { scrollHeight: { value: 500 }, clientHeight: { value: 100 } });
    sequence.scrollTop = 200;
    viewport.append(sequence);
    controller.startFollowing();
    sequence.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
    expect(controller.followingLatest()).toBe(true);
    const terminal = document.createElement('div');
    terminal.style.overflowY = 'auto';
    Object.defineProperties(terminal, { scrollHeight: { value: 300 }, clientHeight: { value: 100 } });
    sequence.append(terminal);
    sequence.scrollTop = 0;
    terminal.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 }));
    expect(controller.followingLatest()).toBe(true);
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
