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

function createCoordinatorHarness() {
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
  }>({
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
  it('opens when a recommended update is available and closes after upgrade success', async () => {
    const harness = createCoordinatorHarness();
    try {
      await flushUntil(() => harness.coordinator.visible());

      expect(harness.refetchLatestVersion).toHaveBeenCalled();
      expect(harness.coordinator.visible()).toBe(true);
      expect(harness.coordinator.mode()).toBe('available');

      await harness.coordinator.startRecommendedUpgrade();
      await flushAsync();

      expect(harness.startUpgrade).toHaveBeenCalledWith('v1.1.0');
      expect(harness.coordinator.mode()).toBe('updating');

      harness.setMaintenanceKind(null);
      harness.setMaintenanceStage(null);
      harness.setCurrentVersion('v1.1.0');
      await flushAsync();

      expect(harness.coordinator.open()).toBe(false);
      expect(harness.coordinator.visible()).toBe(false);
    } finally {
      harness.dispose();
    }
  });

  it('re-enters failed mode when the shared maintenance controller reports an error', async () => {
    const harness = createCoordinatorHarness();
    try {
      await flushAsync();
      await harness.coordinator.startRecommendedUpgrade();

      harness.setMaintenanceKind(null);
      harness.setMaintenanceStage(null);
      harness.setMaintenanceError('Upgrade rejected.');
      await flushAsync();

      expect(harness.coordinator.visible()).toBe(true);
      expect(harness.coordinator.mode()).toBe('failed');
      expect(harness.coordinator.error()).toBe('Upgrade rejected.');
    } finally {
      harness.dispose();
    }
  });

  it('suppresses the prompt when the latest metadata does not allow self-upgrade', async () => {
    const harness = createCoordinatorHarness();
    try {
      harness.setLatestMeta({
        latest_version: 'v1.1.0',
        recommended_version: 'v1.1.0',
        upgrade_policy: 'manual',
        cache_ttl_ms: 300_000,
      });

      await flushAsync();

      expect(harness.coordinator.visible()).toBe(false);
      expect(harness.coordinator.open()).toBe(false);
    } finally {
      harness.dispose();
    }
  });
});
