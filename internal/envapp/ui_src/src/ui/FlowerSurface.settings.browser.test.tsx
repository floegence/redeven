import '../index.css';
import './flower-feature.css';

import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { adapter, renderSurfaceWithAdapter, waitFor } from './FlowerSurface.navigation.testHarness';

it('opens header settings in a dialog over the retained conversation and restores focus on Escape', async () => {
  await page.viewport(1280, 900);
  const surfaceAdapter = adapter(true);
  const runtime = renderSurfaceWithAdapter(surfaceAdapter);
  runtime.style.height = '760px';
  await waitFor(() => !!runtime.querySelector('.flower-composer textarea:not(:disabled)'));
  const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  await userEvent.fill(editor, 'Keep this conversation draft');
  editor.setSelectionRange(5, 9);
  const trigger = runtime.querySelector<HTMLButtonElement>('button[aria-label="Flower settings"]')!;
  await userEvent.click(trigger);
  await expect.element(page.getByRole('dialog', { name: 'Flower Settings', exact: true })).toBeVisible();
  expect(editor.isConnected).toBe(true);
  expect(editor.getBoundingClientRect().height).toBeGreaterThan(0);
  expect(runtime.querySelector<HTMLElement>('[data-flower-panel="chat"]')!.hidden).toBe(false);
  expect(editor.closest('[inert]')).not.toBeNull();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => !document.querySelector('.flower-settings-dialog'));
  expect(document.activeElement).toBe(trigger);
  expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
  expect(editor.value).toBe('Keep this conversation draft');
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([5, 9]);
  expect(surfaceAdapter.loadThread).not.toHaveBeenCalled();
});

it('loads settings on first use and retains the form after closing the dialog', async () => {
  const runtime = renderSurfaceWithAdapter(adapter(true));
  await waitFor(() => Boolean(runtime.querySelector('button[aria-label="Flower settings"]')));
  expect(document.querySelector('.flower-settings-providers-section')).toBeNull();

  (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
  await waitFor(() => Boolean(document.querySelector('.flower-settings-providers-section')));
  const providers = document.querySelector('.flower-settings-providers-section')!;
  expect(providers.textContent).toContain('OpenAI');

  await userEvent.click(page.getByRole('button', { name: 'Close', exact: true }));
  await waitFor(() => !document.querySelector('.flower-settings-dialog'));
  await waitFor(() => Boolean(runtime.querySelector('.flower-chat-shell')));
  expect(providers.isConnected).toBe(true);
  (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
  expect(document.querySelector('.flower-settings-providers-section')).toBe(providers);
});

it('opens the same computer dialog from global settings without a separate connection form', async () => {
  const management = { listCandidates: vi.fn().mockResolvedValue({ current_target_id: '', candidates: [] }), selectCandidate: vi.fn(),
    loadAccess: vi.fn(), saveAccess: vi.fn(),
  };
  const runtime = renderSurfaceWithAdapter({ ...adapter(true), computerManagement: management });
  await waitFor(() => !!runtime.querySelector('button[aria-label="Flower settings"]'));
  (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
  await waitFor(() => !![...document.querySelectorAll<HTMLButtonElement>('.flower-settings-computer-use-section button')].find(button => button.textContent === 'Browser and desktop'));
  expect(document.querySelector('.flower-settings-computer-use-section input[type="url"]')).toBeNull();
  ([...document.querySelectorAll<HTMLButtonElement>('.flower-settings-computer-use-section button')].find(button => button.textContent === 'Browser and desktop') as HTMLButtonElement).click();
  await waitFor(() => !!document.querySelector('[data-flower-computer-panel="overview"]'));
  expect(management.selectCandidate).not.toHaveBeenCalled();
});
