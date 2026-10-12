import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { projectCanvas } from '../../../../tessiven_ui/src/projection';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { toRenderVersion } from '../../../../tessiven_ui/src/presentation';
import { repeatedCallsVersion } from './tessiven-relation-summary.fixture';

const metrics = commands as unknown as { recordCanvasScale: (metric: { count: number; grouped: boolean; [key: string]: unknown }) => Promise<void> };
let host: HTMLDivElement, dispose: (() => void) | undefined, observer: PerformanceObserver | undefined, frameId = 0;
afterEach(() => { cancelAnimationFrame(frameId); observer?.disconnect(); dispose?.(); host?.remove(); });

describe('single large pool qualification', () => {
  for (const count of [100, 500, 1000]) it(`bounds repeated calls and interaction costs for ${count} nodes`, async () => {
    await page.viewport(1440, 960);
    const version = repeatedCallsVersion(count), start = performance.now();
    const projection = projectCanvas(version.document, new Set(), {});
    const projectionMs = performance.now() - start;
    expect(projection.groupRelations.get('pool')).toHaveLength(2);
    const tasks: number[] = [];
    observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration)));
    observer.observe({ type: 'longtask' });
    host = document.createElement('div'); host.className = 'tessiven'; host.style.cssText = 'width:1400px;height:900px;position:relative'; document.body.append(host);
    const mountStart = performance.now();
    dispose = render(() => <TessivenGraph version={toRenderVersion(version)} historical={false} t={tessivenText('en-US')} onAsk={() => {}} onInspect={() => {}} />, host);
    await expect.poll(() => host.querySelectorAll('[data-relation-summary]').length).toBe(2);
    await expect.poll(() => host.querySelector('[aria-label="Arranging canvas"]')).toBeNull();
    const readyMs = performance.now() - mountStart, layoutLongTaskMax = Math.max(0, ...tasks);
    const relationRows = host.querySelectorAll('[data-relation-summary]').length;
    const frames: number[] = []; let running = true, last = performance.now();
    const frame = (now: number) => { if (running) { frames.push(now - last); last = now; frameId = requestAnimationFrame(frame); } };
    frameId = requestAnimationFrame(frame); tasks.length = 0;
    page.getByRole('region', { name: 'Canvas overview', exact: true }).element().focus();
    for (let i = 0; i < 40; i++) await userEvent.keyboard('{ArrowRight}');
    running = false;
    const ordered = frames.sort((a, b) => a - b), p95 = ordered[Math.floor(ordered.length * .95)] ?? 0;
    const report = { count, grouped: true, scenario: 'single-pool-repeated-calls', projectionMs, readyMs, layoutLongTaskMax,
      panFrameP95: p95, panLongTaskMax: Math.max(0, ...tasks), relationRows,
      worldHeight: projection.graph.nodes[0].height, preservedRelations: count * 2 };
    await metrics.recordCanvasScale(report);
    expect(projectionMs).toBeLessThan(100); expect(readyMs).toBeLessThan(15000);
    expect(layoutLongTaskMax).toBeLessThan(100); expect(frames.length).toBeGreaterThan(5);
    expect(p95).toBeLessThan(50); expect(report.panLongTaskMax).toBeLessThan(100);
    await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Expand group', exact: true }).click();
      await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(1);
      expect(host.querySelectorAll('.tessiven-pool-relations')).toHaveLength(1);
      await page.getByRole('button', { name: 'Collapse group', exact: true }).click();
      await expect.poll(() => host.querySelectorAll('[data-relation-summary]').length).toBe(2);
      expect(host.querySelectorAll('.tessiven-node')).toHaveLength(0);
    }
    expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
  }, 60000);
});
