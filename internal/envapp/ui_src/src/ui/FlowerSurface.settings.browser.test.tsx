import '../index.css';
import './flower-feature.css';

import { expect, it } from 'vitest';
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
