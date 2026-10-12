import '../index.css';
import './flower-feature.css';

import { ThemeProvider } from '@floegence/floe-webapp-core';
import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FlowerContextSnapshotPreview } from './widgets/FlowerContextPreviewWindow';
import { adapter, renderSurfaceWithAdapterProps, waitFor } from './FlowerSurface.navigation.testHarness';

it.each([320, 720])('keeps the frozen page reference and native editor usable at %spx', async width => {
  await page.viewport(1280, 850);
  const snapshot = { label: 'Monitoring with a deliberately long localized page name', title: 'Monitor',
    content: JSON.stringify({ page: { id: 'monitor' }, captured_at: '2026-10-12T00:00:00Z', state: { sort: 'cpu' } }, null, 2) };
  const capture = vi.fn(() => snapshot);
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []) }, {
    presentation: 'companion', companionOpen: true, captureNewConversationContext: capture,
    layout: true, renderContextSnapshotPreview: props => <ThemeProvider><FlowerContextSnapshotPreview {...props} /></ThemeProvider>,
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
  await expect.poll(() => Array.from(document.querySelectorAll('.flower-context-preview-window .view-line')).map(line => line.textContent?.replace(/\u00a0/g, ' ')).join('\n'), { timeout: 10_000 }).toBe(snapshot.content);
  const windowRoot = document.querySelector<HTMLElement>('.flower-context-preview-window')!.closest<HTMLElement>('[data-floe-geometry-surface]')!;
  expect(Number(windowRoot.style.zIndex)).toBeGreaterThan(2000);
  expect(windowRoot.querySelector('[data-floe-floating-window-resize-handle]')).not.toBeNull();
  expect(reference.querySelector('[data-flower-context-icon="page_context"]')).not.toBeNull();
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.flower-context-preview-window')).toBeNull();
  expect(runtime.querySelector('textarea')).toBe(editor);
  expect(editor.value).toBe('Explain this page');
  expect(document.activeElement).toBe(preview);
  await userEvent.click(reference.querySelector<HTMLButtonElement>('.flower-composer-reference-chip-remove')!);
  await expect.poll(() => runtime.querySelector('[data-reference-kind="page_context"]')).toBeNull();
  await userEvent.fill(editor, 'Continue editing');
  expect(capture).toHaveBeenCalledTimes(1);
});
