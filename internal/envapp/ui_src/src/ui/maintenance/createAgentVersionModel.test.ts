import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/controlplaneApi', () => ({
  getAgentLatestVersion: vi.fn(),
}));

import { getAgentLatestVersion } from '../services/controlplaneApi';
import { createAgentVersionModel } from './createAgentVersionModel';

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function flushUntil(predicate: () => boolean, maxTurns: number = 8): Promise<void> {
  for (let index = 0; index < maxTurns; index += 1) {
    await flushAsync();
    if (predicate()) return;
  }
  throw new Error('Condition not met before timeout');
}

describe('createAgentVersionModel', () => {
  it('loads latest metadata only after runtime ping is available', async () => {
    const getLatestVersionMock = vi.mocked(getAgentLatestVersion);
    getLatestVersionMock.mockReset();
    getLatestVersionMock.mockResolvedValue({
      latest_version: 'v1.1.0',
      recommended_version: 'v1.1.0',
      upgrade_policy: 'self_upgrade',
    });

    const [envId] = createSignal('env_local');
    const [currentPingSource, setCurrentPingSource] = createSignal<unknown | null>(null);
    const ping = vi.fn(async () => ({ serverTimeMs: Date.now(), version: 'v1.0.0' }));

    let model!: ReturnType<typeof createAgentVersionModel>;
    const dispose = createRoot((disposeRoot) => {
      model = createAgentVersionModel({
        envId,
        currentPingSource,
        rpc: { sys: { ping } },
      });
      return disposeRoot;
    });

    try {
      await flushAsync();
      expect(getLatestVersionMock).not.toHaveBeenCalled();

      setCurrentPingSource({});
      await flushUntil(() => model.latestMeta()?.latest_version === 'v1.1.0');

      expect(ping).toHaveBeenCalledTimes(1);
      expect(getLatestVersionMock).toHaveBeenCalledTimes(1);
      expect(getLatestVersionMock).toHaveBeenCalledWith('env_local');
      expect(model.latestMeta()?.recommended_version).toBe('v1.1.0');
    } finally {
      dispose();
    }
  });

  it('does not treat null metadata as settled and retries on a later ensure call', async () => {
    const getLatestVersionMock = vi.mocked(getAgentLatestVersion);
    getLatestVersionMock.mockReset();
    getLatestVersionMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        latest_version: 'v1.2.0',
        recommended_version: 'v1.2.0',
        upgrade_policy: 'self_upgrade',
      });

    const [envId] = createSignal('env_local');
    const [currentPingSource] = createSignal<unknown | null>({});
    const ping = vi.fn(async () => ({ serverTimeMs: Date.now(), version: 'v1.0.0' }));

    let model!: ReturnType<typeof createAgentVersionModel>;
    const dispose = createRoot((disposeRoot) => {
      model = createAgentVersionModel({
        envId,
        currentPingSource,
        rpc: { sys: { ping } },
      });
      return disposeRoot;
    });

    try {
      await flushUntil(() => getLatestVersionMock.mock.calls.length === 1);
      expect(model.latestMeta()).toBeNull();

      const nextMeta = await model.ensureLatestVersionLoaded();
      await flushUntil(() => model.latestMeta()?.latest_version === 'v1.2.0');

      expect(getLatestVersionMock).toHaveBeenCalledTimes(2);
      expect(nextMeta?.latest_version).toBe('v1.2.0');
      expect(model.latestMeta()?.recommended_version).toBe('v1.2.0');
    } finally {
      dispose();
    }
  });

  it('exposes the runtime service snapshot from the current ping', async () => {
    const getLatestVersionMock = vi.mocked(getAgentLatestVersion);
    getLatestVersionMock.mockReset();
    getLatestVersionMock.mockResolvedValue(null);

    const [envId] = createSignal('env_local');
    const [currentPingSource] = createSignal<unknown | null>({});
    const ping = vi.fn(async () => ({
      serverTimeMs: Date.now(),
      version: 'v1.0.0',
      runtimeService: {
        runtimeVersion: 'v1.0.0',
        protocolVersion: 'redeven-runtime-v1',
        serviceOwner: 'desktop' as const,
        desktopManaged: true,
        effectiveRunMode: 'hybrid',
        remoteEnabled: true,
        compatibility: 'compatible' as const,
        activeWorkload: {
          terminalCount: 2,
          sessionCount: 1,
          taskCount: 0,
          portForwardCount: 1,
        },
      },
    }));

    let model!: ReturnType<typeof createAgentVersionModel>;
    const dispose = createRoot((disposeRoot) => {
      model = createAgentVersionModel({
        envId,
        currentPingSource,
        rpc: { sys: { ping } },
      });
      return disposeRoot;
    });

    try {
      await flushUntil(() => model.runtimeService()?.activeWorkload.terminalCount === 2);

      expect(model.runtimeService()).toMatchObject({
        runtimeVersion: 'v1.0.0',
        serviceOwner: 'desktop',
        desktopManaged: true,
        activeWorkload: {
          terminalCount: 2,
          sessionCount: 1,
          portForwardCount: 1,
        },
      });
    } finally {
      dispose();
    }
  });
});
