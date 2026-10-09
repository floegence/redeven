import { beforeEach } from 'vitest';
import { page } from 'vitest/browser';
import '../index.css';
import './flower-feature.css';
import './FlowerSurface.modelMenu.test.shared';
beforeEach(() => page.viewport(1280, 900));

import { expect, it } from 'vitest';
import { adapter, renderSurfaceWithAdapter, settingsSnapshot, waitFor } from './FlowerSurface.navigation.testHarness';

it.each([390, 1280])('keeps model search and management visible at %s px', async (width) => {
  await page.viewport(width, 900);
  const base = settingsSnapshot();
  const snapshot = { ...base, model_profile: { schema_version: 1 as const, current_model_id: 'local/agent-0', providers: [{
    id: 'local', name: 'Local models', type: 'ollama' as const, models: Array.from({ length: 40 }, (_, i) => ({
      model_name: `agent-${i}`, context_window: 131072, quantization: 'Q8_0',
    })),
  }] } };
  const surface = renderSurfaceWithAdapter({ ...adapter(), loadSettings: async () => snapshot, listThreads: async () => [] });
  surface.style.cssText = 'width:100%;height:100vh';
  await waitFor(() => surface.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('agent-0') === true);
  surface.querySelector<HTMLButtonElement>('.flower-model-reasoning-model-trigger')!.click();
  await waitFor(() => Boolean(document.querySelector('.flower-model-menu input')));
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  const menu = document.querySelector<HTMLElement>('.flower-model-menu')!;
  const list = menu.querySelector<HTMLElement>('.flower-model-menu-list')!;
  const bounds = menu.getBoundingClientRect();
  expect(bounds.left).toBeGreaterThanOrEqual(0);
  expect(bounds.right).toBeLessThanOrEqual(width);
  expect(bounds.top).toBeGreaterThanOrEqual(0);
  expect(bounds.bottom).toBeLessThanOrEqual(window.innerHeight);
  expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
  [...menu.querySelectorAll('button')].find((button) => button.textContent?.includes('Show all selected models'))!.click();
  expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
  const footer = menu.querySelector<HTMLElement>('.flower-model-menu-footer')!.getBoundingClientRect();
  expect(footer.bottom).toBeLessThanOrEqual(menu.getBoundingClientRect().bottom);
  expect(footer.top).toBeGreaterThanOrEqual(menu.getBoundingClientRect().top);
  await page.screenshot({ element: menu, path: `__screenshots__/model-menu-${width}.png` });
});
