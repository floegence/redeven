import { describe, expect, it, vi } from 'vitest';

import type { FlowerProviderType, FlowerSettingsSnapshot, FlowerTurnLaunchInput } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  flowerSurfaceNotifications,
  liveBootstrap,
  launchReceipt,
  renderSurfaceWithAdapter,
  settingsSnapshot,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

async function setupProvider(type: FlowerProviderType, keyConfigured: boolean | undefined, existingThread = false, otherProviderReady = false) {
  const other = settingsSnapshot();
  const snapshot: FlowerSettingsSnapshot = {
    ...other,
    model_profile: {
      schema_version: 1,
      current_model_id: 'local/agent',
      providers: [
        { id: 'local', type, models: [{ model_name: 'agent', context_window: 32768 }] },
        ...(otherProviderReady ? other.model_profile!.providers : []),
      ],
    },
    provider_secrets: [
      ...(keyConfigured === undefined ? [] : [{
        provider_id: 'local', provider_api_key_configured: keyConfigured, web_search_api_key_configured: false,
      }]),
      ...(otherProviderReady ? other.provider_secrets : []),
    ],
  };
  const currentThread = thread({ model_id: 'local/agent' });
  const launches: FlowerTurnLaunchInput[] = [];
  const host = {
    ...adapter(),
    launchTurn: async (input: FlowerTurnLaunchInput) => {
      launches.push(input);
      return launchReceipt(input.thread_id ?? 'thread-1', 'turn-launch', 'start', input.client_request_id);
    },
    loadSettings: vi.fn(async () => snapshot),
    listThreads: vi.fn(async () => existingThread ? [currentThread] : []),
    loadThread: vi.fn(async () => liveBootstrap(currentThread)),
  };
  const surface = renderSurfaceWithAdapter(host);
  await waitFor(() => Boolean(surface.querySelector('.flower-setup-inline'))
    || surface.querySelector('.flower-model-reasoning-model-label')?.textContent?.includes('agent') === true);
  if (existingThread) {
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="thread-1"] button')));
    surface.querySelector<HTMLButtonElement>('[data-thread-id="thread-1"] button')!.click();
    await waitFor(() => surface.querySelector('[data-flower-selected-thread-loading="false"]') !== null
      && surface.querySelector('.flower-chat-header-title')?.textContent === currentThread.title);
  }
  const editor = surface.querySelector<HTMLTextAreaElement>('textarea')!;
  editor.value = 'Hello from the local model';
  editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
  const send = () => editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  return { surface, snapshot, send, launches };
}

describe('Flower provider credential readiness', () => {
  for (const type of ['ollama', 'openai_compatible'] as const) {
    for (const existingThread of [false, true]) {
      it.each([false, undefined, true])(`sends with ${type} and optional credentials (%s), existing thread: ${existingThread}`, async (keyConfigured) => {
        const { launches, surface, snapshot, send } = await setupProvider(type, keyConfigured, existingThread);
        expect(surface.querySelector('.flower-setup-welcome')).toBeNull();
        expect(surface.querySelector('.flower-setup-inline')).toBeNull();
        expect(surface.querySelector('.flower-model-reasoning-warning')).toBeNull();
        send();
        await waitFor(() => launches.length === 1);
        expect(launches[0]).toEqual(expect.objectContaining({
          prompt: 'Hello from the local model',
          ...(existingThread ? { thread_id: 'thread-1' } : { model_id: 'local/agent' }),
        }));
        expect(flowerSurfaceNotifications()).toEqual([]);
        expect(snapshot.provider_secrets[0]?.provider_api_key_configured).toBe(keyConfigured);
      });
    }
  }

  it.each(['openai', 'anthropic', 'google', 'moonshot', 'chatglm', 'deepseek', 'qwen', 'openrouter', 'xai', 'groq'] as const)('requires credentials for %s even with a local provider ID', async (type) => {
    const { launches, surface, send } = await setupProvider(type, false);
    expect(surface.querySelector('.flower-setup-inline')).not.toBeNull();
    send();
    expect(launches).toEqual([]);
    expect(flowerSurfaceNotifications()).toEqual(expect.arrayContaining([
      expect.objectContaining({ message: 'Set up a model provider to start chatting.' }),
    ]));
  });

  it('sends with a required-key provider after credentials are configured', async () => {
    const { launches, send } = await setupProvider('openai', true);
    send();
    await waitFor(() => launches.length === 1);
    expect(flowerSurfaceNotifications()).toEqual([]);
  });

  it('keeps keyless Ollama ready when another provider is also configured', async () => {
    const { launches, surface, send } = await setupProvider('ollama', false, false, true);
    expect(surface.querySelector('.flower-model-reasoning-model-label')?.textContent).toContain('local / agent');
    expect(surface.querySelector('.flower-model-reasoning-warning')).toBeNull();
    send();
    await waitFor(() => launches.length === 1);
    expect(launches[0]).toEqual(expect.objectContaining({ model_id: 'local/agent' }));
  });
});
