// @vitest-environment jsdom

import { createRoot, createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRuntimeUpdatePromptCoordinator } from './createRuntimeUpdatePromptCoordinator';

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? String(store.get(key)) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

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
}

function createCoordinatorHarness(options: Readonly<{
  latestMeta?: {
    latest_version: string;
    recommended_version: string;
    upgrade_policy: 'self_upgrade' | 'manual' | 'desktop_release';
    cache_ttl_ms: number;
  };
}> = {}) {
  const [envId] = createSignal('env_prompt');
  const [isLocalMode] = createSignal(false);
  const [accessGateVisible] = createSignal(false);
  const [protocolStatus, setProtocolStatus] = createSignal('connected');
  const [canAdmin] = createSignal(true);
  const [envStatus, setEnvStatus] = createSignal('online');
  const [currentVersion, setCurrentVersion] = createSignal('v1.0.0');
  const [latestMeta, setLatestMeta] = createSignal<{
    latest_version: string;
    recommended_version: string;
    upgrade_policy: 'self_upgrade' | 'manual' | 'desktop_release';
    cache_ttl_ms: number;
  }>(options.latestMeta ?? {
    latest_version: 'v1.1.0',
    recommended_version: 'v1.1.0',
    upgrade_policy: 'self_upgrade' as const,
    cache_ttl_ms: 300_000,
  });
  const [maintenanceKind, setMaintenanceKind] = createSignal<'upgrade' | 'restart' | null>(null);
  const [maintenanceTargetVersion, setMaintenanceTargetVersion] = createSignal('');
  const [maintenanceError, setMaintenanceError] = createSignal<string | null>(null);
  const [maintenanceStage, setMaintenanceStage] = createSignal<string | null>(null);

  const refetchLatestVersion = vi.fn(async () => latestMeta());
  const startUpgrade = vi.fn(async (targetVersion: string) => {
    setMaintenanceTargetVersion(targetVersion);
    setMaintenanceStage('Downloading and installing update...');
    setMaintenanceKind('upgrade');
  });

  let coordinator!: ReturnType<typeof createRuntimeUpdatePromptCoordinator>;
  const dispose = createRoot((disposeRoot) => {
    coordinator = createRuntimeUpdatePromptCoordinator({
      envId,
      isLocalMode,
      accessGateVisible,
      protocolStatus,
      canAdmin,
      envStatus,
      version: {
        currentPing: () => null,
        currentPingLoading: () => false,
        currentProcessStartedAtMs: () => null,
        runtimeService: () => undefined,
        currentVersion,
        currentVersionValid: () => true,
        latestMeta,
        latestMetaLoading: () => false,
        latestMetaError: () => '',
        preferredTargetVersion: () => String(latestMeta()?.recommended_version ?? ''),
        preferredTargetVersionValid: () => true,
        preferredTargetCompareToCurrent: () => -1,
        updateAvailable: () => true,
        ensureLatestVersionLoaded: async () => latestMeta(),
        refetchLatestVersion,
        refetchCurrentVersion: async () => ({ serverTimeMs: Date.now(), version: currentVersion() }),
      },
      maintenance: {
        kind: maintenanceKind,
        targetVersion: maintenanceTargetVersion,
        maintaining: () => maintenanceKind() !== null,
        isUpgrading: () => maintenanceKind() === 'upgrade',
        isRestarting: () => maintenanceKind() === 'restart',
        error: maintenanceError,
        polledStatus: () => null,
        displayedStatus: () => envStatus(),
        stage: maintenanceStage,
        clearError: () => setMaintenanceError(null),
        startUpgrade,
        startRestart: async () => undefined,
      },
    });

    return disposeRoot;
  });

  return {
    coordinator,
    dispose,
    refetchLatestVersion,
    startUpgrade,
    setCurrentVersion,
    setLatestMeta,
    setMaintenanceKind,
    setMaintenanceTargetVersion,
    setMaintenanceError,
    setMaintenanceStage,
    setProtocolStatus,
    setEnvStatus,
  };
}

beforeEach(() => {
  const storage = createStorageMock();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
});

describe('createRuntimeUpdatePromptCoordinator', () => {
  it('emits a toast notice when a recommended update is available', async () => {
    const harness = createCoordinatorHarness();
    try {
      let notice: ReturnType<typeof harness.coordinator.consumeNotice> = null;
      await flushUntil(() => {
        notice = harness.coordinator.consumeNotice();
        return notice !== null;
      });

      expect(harness.refetchLatestVersion).toHaveBeenCalled();
      expect(notice).toEqual({
        id: 'update-available:env_prompt:v1.1.0',
        title: 'Runtime update ready',
        message: 'Runtime Service v1.1.0 is ready. Open Runtime Status when your work is idle.',
      });
      expect(harness.startUpgrade).not.toHaveBeenCalled();
      expect(harness.coordinator.consumeNotice()).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it('does not re-emit the optional update notice after it was shown for the day', async () => {
    const harness = createCoordinatorHarness();
    try {
      let notice: ReturnType<typeof harness.coordinator.consumeNotice> = null;
      await flushUntil(() => {
        notice = harness.coordinator.consumeNotice();
        return notice !== null;
      });
      expect(notice).not.toBeNull();

      harness.setCurrentVersion('v1.0.1');
      await flushAsync();
      expect(harness.coordinator.consumeNotice()).toBeNull();
    } finally {
      harness.dispose();
    }
  });

  it('suppresses the prompt when the latest metadata does not allow self-upgrade', async () => {
    const harness = createCoordinatorHarness({
      latestMeta: {
        latest_version: 'v1.1.0',
        recommended_version: 'v1.1.0',
        upgrade_policy: 'manual',
        cache_ttl_ms: 300_000,
      },
    });
    try {
      await flushAsync();

      expect(harness.coordinator.consumeNotice()).toBeNull();
    } finally {
      harness.dispose();
    }
  });
});
