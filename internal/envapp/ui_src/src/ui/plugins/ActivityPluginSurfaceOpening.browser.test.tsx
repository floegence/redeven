import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { LayoutProvider } from '@floegence/floe-webapp-core';
import { ActivityPluginSurfaceWindow } from './ActivityPluginSurfaceWindow';
import { createPluginConfirmationQueue } from './PluginConfirmationQueue';
import type { PluginSurfacePlacementCoordinator } from './pluginPlatform';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
it('keeps the first visible plugin window at its final geometry', async () => {
  await page.viewport(1440, 900);
  const host = document.createElement('div');
  document.body.append(host);
  const samples: Array<{ x: number; y: number; width: number; height: number; opacity: number; padding: string; state: string | null }> = [];
  let observing = true;
  const observe = () => {
    const root = document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]');
    const panel = root?.querySelector<HTMLElement>('[data-floe-floating-window-surface]');
    if (root && panel) {
      const rect = root.getBoundingClientRect();
      samples.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        opacity: Number(getComputedStyle(panel).opacity), state: panel.dataset.floatingPresence ?? null,
        padding: getComputedStyle(root.querySelector('[data-floe-floating-window-content]')!).padding });
    }
    if (observing) requestAnimationFrame(observe);
  };
  requestAnimationFrame(observe);
  const coordinator = { open: () => new Promise(() => {}), setVisible: vi.fn(), release: async () => {} } as unknown as PluginSurfacePlacementCoordinator;
  dispose = render(() => <LayoutProvider><ActivityPluginSurfaceWindow
    instanceID="opening-fixture" target={{ pluginID: 'dev.opening', pluginInstanceID: 'opening', surfaceID: 'main', expectedManagementRevision: 1 }}
    coordinator={coordinator} confirmationQueue={createPluginConfirmationQueue()} visible active focusRequest={1}
    onActivate={vi.fn()} onClosed={vi.fn()} onEndPluginSession={async () => true} onRetirementError={vi.fn()}
  /></LayoutProvider>, host);
  for (let index = 0; index < 24; index++) await new Promise(requestAnimationFrame);
  observing = false;
  const visible = samples.filter(sample => sample.opacity > 0.01);
  expect(visible.length).toBeGreaterThan(1);
  const final = visible.at(-1)!;
  for (const sample of visible) {
    expect(sample.x).toBe(final.x);
    expect(sample.y).toBe(final.y);
    expect(sample.width).toBe(final.width);
    expect(sample.height).toBe(final.height);
    expect(sample.padding).toBe('0px');
  }
});
