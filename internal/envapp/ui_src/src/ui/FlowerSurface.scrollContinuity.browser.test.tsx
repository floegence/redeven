import '../index.css';
import './flower-feature.css';
import { commands, page } from 'vitest/browser';
import { createRoot } from 'solid-js';
import { expect, it } from 'vitest';
import { createFlowerScrollTailController } from '../../../../flower_ui/src/flowerScrollTail';

it.each(['flower-chat-transcript', 'flower-subagent-detail-transcript'])(
  'keeps native downward scrolling continuous across offscreen contraction in %s', async className => {
    await page.viewport(1280, 900);
    const viewport = document.createElement('div');
    viewport.className = className;
    viewport.dataset.scrollContinuityTest = '';
    viewport.style.cssText = 'position:fixed;inset:0 auto auto 0;width:600px;height:500px;display:block;padding:0;overflow-anchor:none;';
    const stack = document.createElement('div');
    const preceding = document.createElement('div');
    preceding.style.height = '600px';
    const message = document.createElement('div');
    message.dataset.flowerMessageId = 'continuity-answer';
    const paragraph = document.createElement('p');
    paragraph.textContent = 'Reading must advance with every downward wheel gesture.';
    paragraph.style.cssText = 'height:1000px;margin:0;';
    const following = document.createElement('div');
    following.style.height = '2400px';
    message.append(paragraph); stack.append(preceding, message, following);
    viewport.append(stack); document.body.append(viewport);
    const root = createRoot(dispose => ({ dispose, scroll: createFlowerScrollTailController({
      reducedMotionPreferred: () => false, requestAnimationFrame: callback => requestAnimationFrame(callback),
      cancelAnimationFrame: id => cancelAnimationFrame(id),
    }) }));
    const frames: { top: number; paragraphTop: number }[] = [];
    let sampling = false;
    let contractionPending = false;
    let contractions = 0;
    let frameID = 0;
    let nativeTop = 0;
    const sample = () => {
      if (!sampling) return;
      frames.push({ top: viewport.scrollTop, paragraphTop: paragraph.getBoundingClientRect().top });
      frameID = requestAnimationFrame(sample);
    };
    const onScroll = () => {
      if (contractionPending && viewport.scrollTop > nativeTop) {
        contractionPending = false;
        contractions++;
        // A section leaving the measured region can change total extent
        // before the scroll owner receives the same native scroll event.
        following.style.height = 2400 - contractions * 40 + 'px';
      }
      nativeTop = viewport.scrollTop;
      root.scroll.onScroll();
      root.scroll.flushLayout(false);
    };
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    try {
      root.scroll.bind(viewport); root.scroll.stopFollowing();
      viewport.scrollTop = 580; root.scroll.onScroll(); root.scroll.flushLayout();
      viewport.addEventListener('wheel', root.scroll.onWheel);
      viewport.addEventListener('scroll', onScroll);
      await frame(); await frame();
      nativeTop = viewport.scrollTop;
      const initial = nativeTop;
      sampling = true; sample();
      const wheel = commands as unknown as { wheelScrollRegion: (input: { regionSelector: string; deltaY: number; preserveScroll: boolean }) => Promise<unknown> };
      for (let gesture = 0; gesture < 4; gesture++) {
        const before = viewport.scrollTop;
        contractionPending = true;
        await wheel.wheelScrollRegion({ regionSelector: '[data-scroll-continuity-test]', deltaY: 80, preserveScroll: true });
        await frame();
        expect(viewport.scrollTop - before).toBeCloseTo(80, 0);
      }
      await frame();
      expect(contractions).toBe(4);
      expect(frames.length).toBeGreaterThan(5);
      expect(viewport.scrollTop - initial).toBeCloseTo(320, 0);
      for (let index = 1; index < frames.length; index++) {
        expect(frames[index].top - frames[index - 1].top).toBeGreaterThanOrEqual(-1);
        expect(frames[index].paragraphTop - frames[index - 1].paragraphTop).toBeLessThanOrEqual(1);
      }
      expect(root.scroll.followingLatest()).toBe(false);
      expect(viewport.style.getPropertyValue('--flower-reading-tail-space')).toBe('');
      // Once the gesture ends, asynchronous content above still preserves
      // the reader. Native movement must be consumed exactly once.
      viewport.dispatchEvent(new Event('scrollend'));
      const top = paragraph.getBoundingClientRect().top;
      preceding.style.height = '720px';
      await frame(); await frame();
      expect(Math.abs(paragraph.getBoundingClientRect().top - top)).toBeLessThanOrEqual(1);
    } finally {
      sampling = false; cancelAnimationFrame(frameID);
      viewport.removeEventListener('wheel', root.scroll.onWheel);
      viewport.removeEventListener('scroll', onScroll);
      root.scroll.dispose(); root.dispose(); viewport.remove();
    }
  },
);
