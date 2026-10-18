import '../index.css';
import './flower-feature.css';
import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

it('keeps popup clicks out of composer blank-space focus handling', async () => {
  await page.viewport(1280, 900);
  const selected = thread({ messages: [], context_usage: { confirmed: {
    phase: 'provider_usage', pressure_status: 'stable', updated_at_ms: 1, input_tokens: 600, context_window_tokens: 1000,
    available: true, measured: true, characters_available: true,
    characters: { source: 'prepared_characters_v1', unit: 'unicode_code_points', total_characters: 600, categories: [
      { category: 'system', characters: 100 },
      { category: 'tool_definition', characters: 500, details: [
        { key: 'search', source: 'mcp', namespace: 'docs', characters: 300 },
        { key: 'read', source: 'mcp', namespace: 'docs', characters: 200 },
      ] },
    ] },
  } } });
  const surface = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: async () => [selected], loadThread: async () => liveBootstrap(selected) },
    { focusThreadRequest: { request_id: 'context-popup', thread_id: selected.thread_id } });
  Object.assign(surface.style, { width: '1200px', height: '800px' });
  await waitFor(() => Boolean(surface.querySelector('.flower-composer-context-progress')), 10000);
  const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  const trigger = surface.querySelector<HTMLElement>('.flower-composer-context-progress')!;
  await userEvent.click(editor);
  await userEvent.hover(trigger);
  const panel = document.getElementById(trigger.getAttribute('aria-controls')!)!;
  await expect.poll(() => getComputedStyle(panel).opacity).toBe('1');
  await userEvent.click(panel.querySelector<HTMLElement>('.flower-context-total')!, { delay: 160 });
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(panel.dataset.open).toBe('true');
  expect(document.activeElement).not.toBe(editor);
  const category = panel.querySelector<HTMLDetailsElement>('[data-category="mcp_tools"]')!;
  await userEvent.click(category.querySelector('summary')!, { delay: 160 });
  await expect.poll(() => category.open).toBe(true);
  await userEvent.click(category.querySelector<HTMLElement>('.flower-model-context-row .flower-model-context-label')!);
  expect(panel.dataset.open).toBe('true');
  expect(document.activeElement).not.toBe(editor);
  await userEvent.click(category.querySelector('summary')!);
  await expect.poll(() => category.open).toBe(false);
  await userEvent.keyboard('{Escape}');
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  expect(document.activeElement).toBe(trigger);
  await userEvent.click(surface.querySelector<HTMLElement>('.flower-composer')!, { position: { x: 4, y: 4 } });
  expect(document.activeElement).toBe(editor);
});
