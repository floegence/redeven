import { afterEach, describe, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';

import { FlowerCompanionTailMotionController } from '../../../../flower_ui/src';

const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{
    reducedMotion?: null | 'reduce' | 'no-preference';
  }>) => Promise<void>;
}>;

function mountTail() {
  const button = document.createElement('button');
  const prefix = document.createElement('span');
  const viewport = document.createElement('span');
  const value = document.createElement('span');
  prefix.textContent = '…';
  prefix.setAttribute('aria-hidden', 'true');
  viewport.setAttribute('aria-hidden', 'true');
  Object.assign(viewport.style, {
    display: 'block',
    width: '240px',
    overflowX: 'hidden',
    whiteSpace: 'nowrap',
    font: '14px sans-serif',
  });
  Object.assign(value.style, {
    display: 'block',
    width: 'max-content',
    whiteSpace: 'nowrap',
  });
  viewport.append(value);
  button.append(prefix, viewport);
  document.body.append(button);
  return {
    button,
    prefix,
    viewport,
    value,
    controller: new FlowerCompanionTailMotionController({ viewport, value }),
  };
}

async function settleFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

afterEach(async () => {
  document.body.replaceChildren();
  await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
});

describe('Flower companion live-tail motion', () => {
  it('smoothly follows rolling-window appends while the newest text remains visible', async () => {
    await page.viewport(800, 600);
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    const tail = mountTail();
    const initial = `${'smooth Flower output '.repeat(18)}initial ending`;
    const initialWindow = Array.from(initial).slice(-320).join('');
    tail.button.setAttribute('aria-label', initialWindow);
    tail.controller.update({ identity: 'thread/run/message/block', text: initialWindow });
    expect(tail.viewport.scrollWidth).toBeGreaterThan(tail.viewport.clientWidth);
    expect(Math.abs(
      tail.viewport.scrollLeft - (tail.viewport.scrollWidth - tail.viewport.clientWidth),
    )).toBeLessThanOrEqual(1);

    const nextWindow = Array.from(`${initial} newest words`).slice(-320).join('');
    tail.button.setAttribute('aria-label', nextWindow);
    const before = tail.viewport.scrollLeft;
    tail.controller.update({ identity: 'thread/run/message/block', text: nextWindow });
    const positions = [tail.viewport.scrollLeft];
    for (let index = 0; index < 12; index += 1) {
      await settleFrame();
      positions.push(tail.viewport.scrollLeft);
    }
    expect(positions[0]).toBeCloseTo(before, 0);
    expect(positions.every((position, index) => index === 0 || position >= positions[index - 1])).toBe(true);
    expect(positions.at(-1)).toBeGreaterThan(before);
    expect(tail.value.textContent?.endsWith('newest words')).toBe(true);
    expect(tail.button.getAttribute('aria-label')).toBe(nextWindow);
    expect(tail.viewport.getAttribute('aria-hidden')).toBe('true');
    expect(tail.prefix.getAttribute('aria-hidden')).toBe('true');
    tail.viewport.style.width = '280px';
    tail.controller.resize();
    expect(Math.abs(
      tail.viewport.scrollLeft - (tail.viewport.scrollWidth - tail.viewport.clientWidth),
    )).toBeLessThanOrEqual(1);
    tail.controller.dispose();
  });

  it('keeps the visible edge continuous across the hard cap and compacts after settling', async () => {
    await page.viewport(3_200, 600);
    const tail = mountTail();
    tail.viewport.style.width = '2000px';
    let windowText = 'x'.repeat(320);
    tail.controller.update({ identity: 'long-stream', text: windowText });
    let compensatedTrimObserved = false;
    for (let index = 0; index < 520; index += 1) {
      const lengthBefore = Array.from(tail.value.textContent ?? '').length;
      const rightGapBefore = tail.value.getBoundingClientRect().right - tail.viewport.getBoundingClientRect().right;
      windowText = `${windowText.slice(1)}${index % 10}`;
      tail.controller.update({ identity: 'long-stream', text: windowText });
      const lengthAfter = Array.from(tail.value.textContent ?? '').length;
      if (lengthAfter < lengthBefore) {
        compensatedTrimObserved = true;
        const rightGapAfter = tail.value.getBoundingClientRect().right - tail.viewport.getBoundingClientRect().right;
        expect(Math.abs(rightGapAfter - rightGapBefore)).toBeLessThan(24);
      }
      await settleFrame();
    }
    expect(compensatedTrimObserved).toBe(true);
    expect(Array.from(tail.value.textContent ?? '').length).toBeLessThanOrEqual(800);
    for (let index = 0; index < 60; index += 1) await settleFrame();
    expect(Array.from(tail.value.textContent ?? '').length).toBeLessThanOrEqual(480);
    expect(tail.value.textContent?.endsWith(windowText)).toBe(true);
    expect(Math.abs(
      tail.viewport.scrollLeft - (tail.viewport.scrollWidth - tail.viewport.clientWidth),
    )).toBeLessThanOrEqual(1);
    tail.controller.dispose();
  });

  it('snaps an in-flight append when reduced motion is requested', async () => {
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    const tail = mountTail();
    const initial = 'x'.repeat(80);
    tail.controller.update({ identity: 'stream', text: initial });
    tail.controller.update({ identity: 'stream', text: `${initial} newest` });
    expect(tail.viewport.scrollLeft).toBeLessThan(tail.viewport.scrollWidth - tail.viewport.clientWidth);
    await mediaCommands.emulateMediaPreferences({ reducedMotion: 'reduce' });
    tail.controller.reducedMotionChanged();
    expect(Math.abs(
      tail.viewport.scrollLeft - (tail.viewport.scrollWidth - tail.viewport.clientWidth),
    )).toBeLessThanOrEqual(1);
    tail.controller.dispose();
  });
});
