import '../index.css';
import './flower-feature.css';

import { expect, it, vi } from 'vitest';
import { adapter, renderSurfaceWithAdapter, waitFor } from './FlowerSurface.navigation.testHarness';

it('loads settings on first use and preserves the mounted panel when returning to chat', async () => {
  const runtime = renderSurfaceWithAdapter(adapter(true));
  await waitFor(() => Boolean(runtime.querySelector('button[aria-label="Flower settings"]')));
  expect(runtime.querySelector('.flower-settings-providers-section')).toBeNull();

  (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
  await waitFor(() => Boolean(runtime.querySelector('.flower-settings-providers-section')));
  const providers = runtime.querySelector('.flower-settings-providers-section')!;
  expect(providers.textContent).toContain('OpenAI');

  (runtime.querySelector('button[aria-label="Back to chat"]') as HTMLButtonElement).click();
  await waitFor(() => Boolean(runtime.querySelector('.flower-chat-shell')));
  expect(providers.isConnected).toBe(true);
  (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
  expect(runtime.querySelector('.flower-settings-providers-section')).toBe(providers);
});

it('opens the same computer dialog from global settings without a separate connection form', async () => {
  const management = { listCandidates: vi.fn().mockResolvedValue({ current_target_id: '', candidates: [] }), selectCandidate: vi.fn(),
    loadAccess: vi.fn(), saveAccess: vi.fn(),
  };
  const runtime = renderSurfaceWithAdapter({ ...adapter(true), computerManagement: management });
  await waitFor(() => !!runtime.querySelector('button[aria-label="Flower settings"]'));
  (runtime.querySelector('button[aria-label="Flower settings"]') as HTMLButtonElement).click();
  await waitFor(() => !![...runtime.querySelectorAll<HTMLButtonElement>('.flower-settings-computer-use-section button')].find(button => button.textContent === 'Browser and desktop'));
  expect(runtime.querySelector('.flower-settings-computer-use-section input[type="url"]')).toBeNull();
  ([...runtime.querySelectorAll<HTMLButtonElement>('.flower-settings-computer-use-section button')].find(button => button.textContent === 'Browser and desktop') as HTMLButtonElement).click();
  await waitFor(() => !!document.querySelector('[data-flower-computer-panel="overview"]'));
  expect(management.selectCandidate).not.toHaveBeenCalled();
});
