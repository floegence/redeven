import '../index.css';
import './flower-feature.css';
import { For, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import { FlowerToolIcon } from '../../../../flower_ui/src/FlowerToolIcon';
import { flowerToolMotion } from '../../../../flower_ui/src/flowerToolMotion';
import { waitFor } from './FlowerSurface.navigation.testHarness';

const editTools = ['file.edit', 'file.write', 'apply_patch', 'tessiven.edit'];

it('keeps the pencil tip on the revealed stroke and lifts it for the return', async () => {
  await page.viewport(1000, 760);
  const media = commands as unknown as { emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  const host = document.createElement('div');
  host.className = 'flower-activity-inline';
  host.style.cssText = 'padding:28px;background:var(--background);color:var(--foreground);font:12px var(--font-sans)';
  document.body.append(host);
  const [running, setRunning] = createSignal(true);
  const dispose = render(() => <For each={editTools}>{name => <div data-tool={name} style="display:flex;align-items:center;gap:14px;min-height:44px">
    <FlowerToolIcon toolName={name} running={running()} /><span>{name}</span>
    <span style="margin-left:auto"><FlowerToolIcon toolName={name} running={false} /></span>
  </div>}</For>, host);
  try {
    const icons = [...host.querySelectorAll<HTMLElement>('[data-tool] > .flower-tool-icon')];
    const svgs = icons.map(icon => icon.querySelector('svg')!);
    const animations = icons.map(icon => icon.getAnimations({ subtree: true }));
    expect(animations.every(tracks => tracks.length === 2)).toBe(true);
    animations.flat().forEach(animation => animation.pause());
    const sample = (phase: number) => animations.flat().forEach(animation => { animation.currentTime = flowerToolMotion['file.edit'].cycle * phase; });
    const expectPencilInside = (svg: SVGSVGElement) => {
      const pencil = svg.querySelector<SVGPathElement>('[data-flower-writing-part="pencil"]')!;
      const box = pencil.getBBox();
      const bounds = svg.getBoundingClientRect();
      for (const corner of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const point = new DOMPoint(box.x + box.width * corner[0], box.y + box.height * corner[1]).matrixTransform(pencil.getScreenCTM()!);
        expect(point.x).toBeGreaterThanOrEqual(bounds.left);
        expect(point.x).toBeLessThanOrEqual(bounds.right);
        expect(point.y).toBeGreaterThanOrEqual(bounds.top);
        expect(point.y).toBeLessThanOrEqual(bounds.bottom);
      }
    };
    for (const phase of [0.12, 0.17, 0.22, 0.26, 0.30, 0.35, 0.40, 0.44, 0.48, 0.54, 0.60]) {
      sample(phase);
      for (const svg of svgs) {
        const ink = svg.querySelector<SVGPathElement>('[data-flower-writing-part="ink"]')!;
        const pencil = svg.querySelector<SVGPathElement>('[data-flower-writing-part="pencil"]')!;
        const progress = 1 - parseFloat(getComputedStyle(ink.parentElement!).strokeDashoffset);
        const endpoint = ink.getPointAtLength(ink.getTotalLength() * progress).matrixTransform(ink.getScreenCTM()!);
        const tip = new DOMPoint(12.5, 18.25).matrixTransform(pencil.getScreenCTM()!);
        expect(Math.hypot(tip.x - endpoint.x, tip.y - endpoint.y)).toBeLessThan(0.15);
        expectPencilInside(svg);
      }
    }
    for (const phase of [0, 0.06, 0.65, 0.70, 0.80, 0.90, 0.999]) {
      sample(phase);
      svgs.forEach(expectPencilInside);
    }
    sample(0.70);
    for (const svg of svgs) {
      const pencil = svg.querySelector<SVGPathElement>('[data-flower-writing-part="pencil"]')!;
      const tip = new DOMPoint(12.5, 18.25).matrixTransform(pencil.getScreenCTM()!);
      const baseline = new DOMPoint(12.5, 18.25).matrixTransform(svg.getScreenCTM()!);
      expect(tip.y).toBeLessThan(baseline.y - 0.7);
    }
    sample(0.35);
    await page.screenshot({ element: host, path: '__screenshots__/flower-pencil-writing-light.png' });
    document.documentElement.classList.add('dark');
    await page.screenshot({ element: host, path: '__screenshots__/flower-pencil-writing-dark.png' });
    await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    await waitFor(() => host.getAnimations({ subtree: true }).length === 0);
    expect(svgs.every(svg => svg.isConnected)).toBe(true);
    await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
    await waitFor(() => host.getAnimations({ subtree: true }).length === 8);
    setRunning(false);
    expect(host.getAnimations({ subtree: true })).toHaveLength(0);
    expect(icons.every(icon => icon.querySelectorAll('[data-flower-writing-part]').length === 3)).toBe(true);
    expect([...host.querySelectorAll('g')].every(group => !group.style.strokeDasharray && !group.style.opacity && !group.style.transform)).toBe(true);
  } finally {
    dispose(); host.remove(); document.documentElement.classList.remove('dark');
    await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
  }
});
