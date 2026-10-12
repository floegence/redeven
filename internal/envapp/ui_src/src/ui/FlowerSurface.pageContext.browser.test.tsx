import '../index.css';
import './flower-feature.css';

import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adapter, renderSurfaceWithAdapterProps, waitFor } from './FlowerSurface.navigation.testHarness';

it.each([320, 720])('keeps the frozen page reference and native editor usable at %spx', async width => {
  await page.viewport(1280, 850);
  const snapshot = { label: 'Monitoring with a deliberately long localized page name', title: 'Monitor',
    content: JSON.stringify({ page: { id: 'monitor' }, captured_at: '2026-10-12T00:00:00Z', state: { sort: 'cpu' } }, null, 2) };
  const capture = vi.fn(() => snapshot);
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []) }, {
    presentation: 'companion', companionOpen: true, captureNewConversationContext: capture,
  });
  Object.assign(runtime.style, { width: `${width}px`, height: '720px' });
  await waitFor(() => Boolean(runtime.querySelector('textarea:not(:disabled)')));
  const editor = runtime.querySelector<HTMLTextAreaElement>('textarea')!;
  await userEvent.fill(editor, 'Explain this page');
  const reference = runtime.querySelector<HTMLElement>('[data-reference-kind="page_context"]')!;
  const composer = runtime.querySelector<HTMLElement>('.flower-composer')!;
  expect(reference.getBoundingClientRect().right).toBeLessThanOrEqual(composer.getBoundingClientRect().right);
  expect(composer.scrollWidth).toBeLessThanOrEqual(composer.clientWidth + 1);
  const preview = reference.querySelector<HTMLButtonElement>('.flower-composer-reference-chip-preview')!;
  expect(getComputedStyle(preview).cursor).toBe('pointer');
  await userEvent.click(preview);
  await expect.poll(() => document.querySelector('.flower-page-context-preview pre')?.textContent).toBe(snapshot.content);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.flower-page-context-preview')).toBeNull();
  expect(runtime.querySelector('textarea')).toBe(editor);
  expect(editor.value).toBe('Explain this page');
  await userEvent.click(reference.querySelector<HTMLButtonElement>('.flower-composer-reference-chip-remove')!);
  await expect.poll(() => runtime.querySelector('[data-reference-kind="page_context"]')).toBeNull();
  await userEvent.fill(editor, 'Continue editing');
  expect(capture).toHaveBeenCalledTimes(1);
});
