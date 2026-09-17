import '../index.css';
import './flower-feature.css';

import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { describe, expect, it, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapter, runtimeCurrentView, thread, waitFor } from './FlowerSurface.navigation.testHarness';
import type { FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const evidence = commands as unknown as { inspectProgressShimmerPaint: (name: string, measurements: unknown) => Promise<{ changed: number; brightened: number; darkened: number; backgroundChanged: number }> };

function textContrast(element: HTMLElement) {
  const context = document.createElement('canvas').getContext('2d')!;
  const rgb = (value: string) => {
    context.clearRect(0, 0, 1, 1); context.fillStyle = value; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].map(v => v / 255);
  };
  const mix = (a: number[], b: number[], weight: number) => a.slice(0, 3).map((v, i) => v * (1 - weight) + b[i] * weight);
  const background = (el: Element | null): number[] => {
    if (!el) return [1, 1, 1];
    const value = rgb(getComputedStyle(el).backgroundColor);
    return mix(background(el.parentElement), value, value[3]);
  };
  const token = (name: string) => {
    const probe = document.createElement('span'); probe.style.color = `var(${name})`; element.append(probe);
    const value = rgb(getComputedStyle(probe).color); probe.remove(); return value;
  };
  const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  const luminance = (value: number[]) => value.slice(0, 3).map(linear).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const base = token('--floe-progress-text-base');
  const peak = token('--floe-progress-text-peak');
  const bg = luminance(background(element));
  const contrast = Math.min(...Array.from({ length: 33 }, (_, i) => {
    const ink = luminance(mix(base, peak, i / 32));
    return (Math.max(ink, bg) + 0.05) / (Math.min(ink, bg) + 0.05);
  }));
  const lab = (value: number[]) => {
    const [r, g, b] = value.slice(0, 3).map(linear);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const a = lab(base), b = lab(peak);
  return { contrast, luminanceGain: luminance(peak) - luminance(base), deltaEOK: Math.hypot(...a.map((v, i) => v - b[i])) };
}

describe('Flower progress shimmer', () => {
  it('clips running tool and progress flow to glyphs in every shell theme', async () => {
    await page.viewport(1200, 850);
    const threadID = 'thread-progress-shimmer';
    const runID = 'run-progress-shimmer';
    const statuses = ['running', 'running', 'waiting', 'success', 'error', 'canceled'] as const;
    const running = thread({
      thread_id: threadID, title: 'Progress visibility', status: 'running', active_run_id: runID,
      run_progress: { phase: 'tool_execution', run_id: runID, turn_id: 'turn-progress' },
      messages: [{
        id: 'message-progress', turn_id: 'turn-progress', role: 'assistant', content: '', status: 'streaming', created_at_ms: 1,
        blocks: [activityTimeline({ thread_id: threadID, run_id: runID, turn_id: 'turn-progress', status: 'running', items: statuses.map((status, i) => activityItem({
          item_id: `tool-${i}`, tool_id: `tool-${i}`, tool_name: i === 1 ? 'terminal.exec' : 'web_fetch', status, label: i === 1 ? 'Run command' : 'Web fetch', renderer: i === 1 ? 'terminal' : 'web_fetch',
          description: i === 1 ? 'node scripts/verify-progress.mjs --theme classic-light --material soft-neumorphic --include-long-translated-status' : undefined,
          payload: i === 1
            ? { operation: 'exec', command: 'node scripts/verify-progress.mjs --theme classic-light --material soft-neumorphic --include-long-translated-status', output: 'Verifying progress' }
            : { url: `https://example.com/long/forecast/path?location=changsha&request=${i}`, content_preview: 'Weather response' },
        })) })],
      }],
    });
    let settle: (event: FlowerLiveStreamEnvelope) => void = () => { throw new Error('Stream is not ready'); };
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: vi.fn(async () => [running]), loadThread: vi.fn(async () => liveBootstrap(running)),
      async *connectLiveStream({ signal }) {
        yield { schema_version: 1, kind: 'ready', summaries: [running] };
        const event = await new Promise<FlowerLiveStreamEnvelope | null>(resolve => {
          settle = resolve;
          signal.addEventListener('abort', () => resolve(null), { once: true });
        });
        if (event) yield event;
        if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    });
    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${threadID}"] button`)));
    (runtime.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-activity-inline-title').length === statuses.length);
    const titles = [...runtime.querySelectorAll<HTMLElement>('.flower-activity-inline-title')];
    titles.forEach((title, i) => expect(title.getAttribute('data-floe-progress-shimmer')).toBe(statuses[i] === 'running' ? 'text' : null));
    expect(titles[0].textContent).toContain('https://example.com/long/forecast/path');
    expect(titles[1].textContent).toContain('node scripts/verify-progress.mjs');
    const status = runtime.querySelector<HTMLElement>('.flower-model-status-text')!;
    expect(status.getAttribute('data-floe-progress-shimmer')).toBe('text');
    expect(runtime.querySelector('[data-floe-progress-shimmer="surface"]')).toBeNull();
    const root = document.documentElement;
    const originalClass = root.className;
    const originalPreset = root.getAttribute('data-floe-shell-theme');
    const originalMaterial = root.getAttribute('data-floe-surface-style');
    try {
      for (const material of ['standard', 'soft-neumorphic']) {
        root.dataset.floeSurfaceStyle = material;
        for (const theme of builtInShellThemePresets) {
          root.classList.toggle('dark', theme.mode === 'dark');
          root.classList.toggle('light', theme.mode === 'light');
          root.dataset.floeShellTheme = theme.name;
          const measurements = [];
          for (const text of [titles[0], titles[1], status]) {
            const style = getComputedStyle(text);
            expect(style.backgroundClip, theme.name).toBe('text');
            expect(style.backgroundColor, theme.name).toBe('rgba(0, 0, 0, 0)');
            expect(style.animationName, theme.name).toBe('floe-progress-shimmer');
            expect(getComputedStyle(text, '::before').content).toBe('none');
            expect(getComputedStyle(text, '::after').content).toBe('none');
            const measurement = textContrast(text);
            expect(measurement.luminanceGain, theme.name).toBeGreaterThan(0);
            expect(measurement.contrast, theme.name).toBeGreaterThanOrEqual(4.5);
            expect(measurement.deltaEOK, theme.name).toBeGreaterThanOrEqual(0.08);
            measurements.push(measurement);
          }
          for (const row of runtime.querySelectorAll('.flower-activity-inline-button')) {
            expect(getComputedStyle(row).backgroundImage).toBe('none');
            expect(getComputedStyle(row, '::before').content).toBe('none');
          }
          const pixels = await evidence.inspectProgressShimmerPaint(`${material}-${theme.name}`, measurements);
          expect(pixels.changed, `${theme.name}: glyph paint moves`).toBeGreaterThan(4);
          expect(pixels.brightened, `${theme.name}: actual glyphs brighten`).toBeGreaterThan(4);
          expect(pixels.darkened, `${theme.name}: no dark traveling glyphs`).toBe(0);
          expect(pixels.backgroundChanged, `${theme.name}: surrounding background stays untouched`).toBe(0);
          if (material === 'soft-neumorphic' && ['classic-light', 'classic-dark'].includes(theme.name)) {
            await new Promise(resolve => setTimeout(resolve, 2500));
          }
        }
      }
      const trigger = runtime.querySelector<HTMLButtonElement>('[data-flower-activity-item-id="tool-0"] [data-flower-disclosure-trigger]')!;
      expect(trigger).not.toBeNull();
      trigger.click();
      await waitFor(() => trigger.getAttribute('aria-expanded') === 'true');
      const range = document.createRange(); range.selectNodeContents(titles[0]);
      const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      expect(selection.toString().replace(/\s+/gu, '')).toBe(titles[0].textContent?.replace(/\s+/gu, ''));
      selection.removeAllRanges();
      const current = runtimeCurrentView(running, 2);
      settle({ schema_version: 1, kind: 'thread.batch', thread_id: threadID, current: {
        ...current, activity: 'idle', last_outcome: 'completed', run_progress: undefined,
        items: (current.items ?? []).map(item => {
          if (item.kind !== 'tool') return item;
          const { label, description, renderer, chips, target_refs, payload, ...activity } = item.activity ?? {};
          return { ...item, activity: { ...activity, status: 'success', presentation: { label, description, renderer, chips, target_refs, payload } } };
        }),
      } });
      await waitFor(() => runtime.querySelector('[data-floe-progress-shimmer]') === null);
      expect(runtime.querySelectorAll('.flower-activity-inline-title')).toHaveLength(statuses.length);
    } finally {
      root.className = originalClass;
      if (originalPreset === null) root.removeAttribute('data-floe-shell-theme'); else root.setAttribute('data-floe-shell-theme', originalPreset);
      if (originalMaterial === null) root.removeAttribute('data-floe-surface-style'); else root.setAttribute('data-floe-surface-style', originalMaterial);
    }
  }, 60000);
});
