import { toRenderVersion } from '../../../../tessiven_ui/src/presentation';
import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { projectCanvas } from '../../../../tessiven_ui/src/projection';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { scaleDocument } from './tessiven-scale.fixture';
import type { Version } from '../../../../tessiven_ui/src/types';

const scaleCommands = commands as unknown as {
  recordCanvasScale: (metric: { count: number; grouped: boolean; [key: string]: unknown }) => Promise<void>;
};

let host: HTMLDivElement;
let dispose: (() => void) | undefined;
let observer: PerformanceObserver | undefined;
let animationFrame = 0;
afterEach(() => { cancelAnimationFrame(animationFrame); observer?.disconnect(); dispose?.(); host?.remove(); });


describe('Tessiven actual host scale qualification', () => {
  for (const grouped of [false, true]) for (const count of [100, 500, 1000]) {
    it(`keeps ${count} physical hosts responsive with groups=${grouped}`, async () => {
      await page.viewport(1440, 960);
      const document = scaleDocument(count, grouped);
      const started = performance.now();
      const projected = projectCanvas(document, new Set(document.presentation!.initiallyExpanded), {});
      const projectionMs = performance.now() - started;
      expect([...projected.cards.values()].filter(card => card.kind === 'node')).toHaveLength(count);
      expect(projected.graph.edges).toHaveLength(count - 1);
      const tasks: number[] = [];
      observer = new PerformanceObserver(list => tasks.push(...list.getEntries().map(entry => entry.duration)));
      observer.observe({ type: 'longtask' });
      host = window.document.createElement('div');
      host.className = 'tessiven';
      host.style.cssText = 'width:1400px;height:900px;position:relative';
      window.document.body.append(host);
      const version: Version = { canvas_id: 'scale', number: 1, document_yaml: '', document, digest: 'fixture', created_at: 0, source: 'example', summary: '' };
      const mounted = performance.now();
      dispose = render(() => <TessivenGraph version={toRenderVersion(version)} historical={false} t={tessivenText('en-US')}
        onAsk={() => {}} onInspect={() => {}} />, host);
      await expect.poll(() => host.querySelectorAll('.tessiven-node').length, { timeout: 60000 }).toBeGreaterThan(0);
      await expect.poll(() => host.querySelector('[aria-label="Arranging canvas"]'), { timeout: 60000 }).toBeNull();
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      const readyMs = performance.now() - mounted;
      const initial = { nodes: host.querySelectorAll('.tessiven-node').length, edges: host.querySelectorAll('.floe-graph__edge').length };
      const overviewNodes = [...host.querySelectorAll('.floe-graph__minimap-nodes')]
        .reduce((count, path) => count + (path.getAttribute('d')!.match(/M/g)?.length ?? 0), 0);
      expect(overviewNodes).toBe(projected.graph.nodes.filter(node => node.kind !== 'group').length);
      const layoutLongTaskMax = Math.max(0, ...tasks);
      const overview = page.getByRole('region', { name: 'Canvas overview', exact: true });
      overview.element().focus();
      const frames: number[] = [];
      let running = true, previous = performance.now();
      const frame = (now: number) => { if (running) { frames.push(now - previous); previous = now; animationFrame = requestAnimationFrame(frame); } };
      animationFrame = requestAnimationFrame(frame);
      tasks.length = 0;
      for (let index = 0; index < 40; index++) await userEvent.keyboard('{ArrowRight}');
      running = false;
      const sorted = frames.sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * .95)] ?? 0;
      await scaleCommands.recordCanvasScale({ count, grouped, projectionMs, readyMs, initial, layoutLongTaskMax, panFrameP95: p95, panLongTaskMax: Math.max(0, ...tasks) });
      expect(projectionMs).toBeLessThan(100);
      expect(readyMs).toBeLessThan(15000);
      expect(layoutLongTaskMax).toBeLessThan(100);
      expect(frames.length).toBeGreaterThan(5);
      expect(p95).toBeLessThan(50);
      expect(Math.max(0, ...tasks)).toBeLessThan(100);
      expect(host.querySelectorAll('[role="alert"]')).toHaveLength(0);
      expect(host.querySelectorAll('.floe-graph__minimap path').length).toBeLessThanOrEqual(grouped ? 6 : 2);
      if (grouped) {
        await page.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Collapse all', exact: true }).click();
        await expect.poll(() => host.querySelectorAll('.tessiven-node').length, { timeout: 60000 }).toBe(0);
        await page.getByRole('button', { name: 'Fit canvas', exact: true }).click();
        await page.screenshot({ path: `../../.vitest-attachments/tessiven-scale-${count}-collapsed.png` });
      }
      observer.disconnect();
    }, 120000);
  }
});
