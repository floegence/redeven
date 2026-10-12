import { toRenderVersion } from '../../../../tessiven_ui/src/presentation';
import '../index.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => { cancelAnimationFrame(animationFrame); observer?.disconnect(); dispose?.(); host?.remove(); vi.restoreAllMocks(); });


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
      const messages = vi.spyOn(Worker.prototype, 'postMessage');
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
      const layouts = () => messages.mock.calls.filter(([request]) => request.kind === 'layout').length;
      const routes = () => messages.mock.calls.filter(([request]) => request.kind === 'route').length;
      const geometry = () => JSON.stringify({
        nodes: [...host.querySelectorAll<HTMLElement>('.floe-graph__node,.floe-graph__group')].map(node => [node.dataset.graphObject, node.style.cssText]),
        viewport: getComputedStyle(host.querySelector('.floe-infinite-canvas__viewport')!).transform,
        overview: host.querySelector('.floe-graph__minimap-edges')!.outerHTML,
      });
      const before = geometry(), layoutCount = layouts();
      const candidates = [...host.querySelectorAll<HTMLElement>('.floe-graph__node')].map(node => node.dataset.graphObject!);
      expect(candidates.length).toBeGreaterThanOrEqual(3);
      const focus = (id: string) => host.querySelector<HTMLElement>(`[data-graph-object="${id}"]`)!.focus({ preventScroll: true });
      const settled = async () => {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        await expect.poll(() => host.querySelector('[data-connections-pending]'), { timeout: 15000 }).toBeNull();
      };
      tasks.length = 0;
      const coldStart = performance.now(); focus(candidates[0]); await settled();
      const coldRouteMs = performance.now() - coldStart;
      expect(geometry()).toBe(before);
      const computed = routes();
      focus(candidates[1]); await settled();
      const cacheStart = performance.now(); focus(candidates[0]); await settled();
      const cacheMs = performance.now() - cacheStart;
      expect(routes()).toBe(computed + 1);
      const sweepStart = performance.now();
      const sweep = candidates.slice(1, 41), finalFocus = sweep.at(-1)!;
      for (const id of sweep) focus(id);
      await settled();
      expect(host.querySelector('.tessiven-canvas')!.getAttribute('data-connection-focus')).toBe(finalFocus);
      const edgeIds = [...host.querySelectorAll('.floe-graph__edge')].map(edge => edge.parentElement!.getAttribute('data-graph-object'));
      expect(edgeIds.every(id => id!.split('/').slice(1).includes(finalFocus))).toBe(true);
      expect(edgeIds.length).toBeGreaterThan(0);
      expect(layouts()).toBe(layoutCount); expect(geometry()).toBe(before);
      const hover = { coldRouteMs, cacheMs, sweepMs: performance.now() - sweepStart,
        requests: routes() - computed, cancellations: messages.mock.calls.filter(([request]) => request.cancel).length,
        longTaskMax: Math.max(0, ...tasks) };
      expect(hover.longTaskMax).toBeLessThan(100);
      host.querySelector<HTMLElement>(`[data-graph-object="${finalFocus}"]`)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await settled();
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
      await scaleCommands.recordCanvasScale({ count, grouped, projectionMs, readyMs, initial, layoutLongTaskMax, hover, panFrameP95: p95, panLongTaskMax: Math.max(0, ...tasks) });
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
