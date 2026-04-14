import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';

import { compareReleaseVersionCore, isReleaseVersion } from './agentVersion';
import {
  runtimeUpdatePromptStorageKey,
  clearRuntimeUpdateSkippedVersionIfMatched,
  formatLocalDateStamp,
  markRuntimeUpdatePromptShown,
  markRuntimeUpdateVersionSkipped,
  readRuntimeUpdatePromptMemory,
  shouldShowRuntimeUpdatePrompt,
  type RuntimeUpdatePromptMemory,
} from './runtimeUpdatePromptState';
import type { AgentMaintenanceController } from './createAgentMaintenanceController';
import type { AgentVersionModel } from './createAgentVersionModel';

const MIN_REFRESH_DELAY_MS = 5 * 60 * 1000;
const MAX_REFRESH_DELAY_MS = 30 * 60 * 1000;
const DEFAULT_REFRESH_DELAY_MS = 10 * 60 * 1000;

export type RuntimeUpdatePromptMode = 'available' | 'updating' | 'failed';

export type RuntimeUpdatePromptCoordinator = Readonly<{
  open: Accessor<boolean>;
  visible: Accessor<boolean>;
  mode: Accessor<RuntimeUpdatePromptMode>;
  targetVersion: Accessor<string>;
  currentVersion: Accessor<string>;
  latestMessage: Accessor<string>;
  stage: Accessor<string | null>;
  error: Accessor<string | null>;
  dismiss: () => void;
  skipCurrentVersion: () => void;
  startRecommendedUpgrade: () => Promise<void>;
  retry: () => Promise<void>;
}>;

type CreateRuntimeUpdatePromptCoordinatorArgs = Readonly<{
  envId: Accessor<string>;
  isLocalMode: Accessor<boolean>;
  accessGateVisible: Accessor<boolean>;
  protocolStatus: Accessor<string>;
  canAdmin: Accessor<boolean>;
  envStatus: Accessor<string>;
  version: AgentVersionModel;
  maintenance: AgentMaintenanceController;
}>;

function clampRefreshDelay(cacheTtlMs: number | null | undefined): number {
  const ttl = Number(cacheTtlMs ?? 0);
  if (!Number.isFinite(ttl) || ttl <= 0) return DEFAULT_REFRESH_DELAY_MS;
  return Math.min(Math.max(Math.floor(ttl), MIN_REFRESH_DELAY_MS), MAX_REFRESH_DELAY_MS);
}

function loadPromptMemoryForEnv(envId: string): RuntimeUpdatePromptMemory {
  const id = String(envId ?? '').trim();
  if (!id) return {};
  return readRuntimeUpdatePromptMemory(id);
}

export function createRuntimeUpdatePromptCoordinator(args: CreateRuntimeUpdatePromptCoordinatorArgs): RuntimeUpdatePromptCoordinator {
  const [open, setOpen] = createSignal(false);
  const [promptMemory, setPromptMemory] = createSignal<RuntimeUpdatePromptMemory>({});
  const [promptUpgradeRequested, setPromptUpgradeRequested] = createSignal(false);
  const [promptUpgradeStarted, setPromptUpgradeStarted] = createSignal(false);
  const [promptRequestedTargetVersion, setPromptRequestedTargetVersion] = createSignal('');

  let refreshTimer: number | undefined;
  let refreshGeneration = 0;
  let previousEnvId = '';

  const clearRefreshTimer = () => {
    if (typeof refreshTimer !== 'undefined') {
      window.clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }
  };

  const refreshEligible = createMemo(() => {
    const envId = String(args.envId() ?? '').trim();
    if (!envId) return false;
    if (args.isLocalMode()) return false;
    if (args.accessGateVisible()) return false;
    if (String(args.protocolStatus() ?? '').trim() !== 'connected') return false;
    if (!args.canAdmin()) return false;
    if (String(args.envStatus() ?? '').trim().toLowerCase() !== 'online') return false;
    if (args.maintenance.maintaining()) return false;
    return true;
  });

  const mode = createMemo<RuntimeUpdatePromptMode>(() => {
    if (promptUpgradeRequested() && args.maintenance.error()) return 'failed';
    if (promptUpgradeRequested() && args.maintenance.maintaining()) return 'updating';
    return 'available';
  });

  const canKeepAvailablePromptOpen = createMemo(() => {
    if (!refreshEligible()) return false;
    if (args.version.latestMeta()?.upgrade_policy !== 'self_upgrade') return false;
    if (args.version.latestMeta()?.stale === true) return false;
    if (!args.version.currentVersionValid()) return false;
    if (!args.version.preferredTargetVersionValid()) return false;
    const compare = args.version.preferredTargetCompareToCurrent();
    return compare != null && compare < 0;
  });

  const targetVersion = createMemo(() => {
    const requested = String(promptRequestedTargetVersion() ?? '').trim();
    if (requested) return requested;

    const maintenanceTarget = String(args.maintenance.targetVersion() ?? '').trim();
    if (maintenanceTarget) return maintenanceTarget;

    return String(args.version.preferredTargetVersion() ?? '').trim();
  });

  const visible = createMemo(() => {
    if (!open()) return false;
    if (mode() === 'available') return canKeepAvailablePromptOpen();
    return true;
  });

  const resetPromptUpgradeState = () => {
    setPromptUpgradeRequested(false);
    setPromptUpgradeStarted(false);
    setPromptRequestedTargetVersion('');
  };

  const syncPromptMemory = () => {
    setPromptMemory(loadPromptMemoryForEnv(args.envId()));
  };

  createEffect(() => {
    const envId = String(args.envId() ?? '').trim();
    if (envId === previousEnvId) return;
    previousEnvId = envId;
    setOpen(false);
    resetPromptUpgradeState();
    syncPromptMemory();
  });

  createEffect(() => {
    if (!promptUpgradeRequested()) return;
    if (!args.maintenance.maintaining()) return;
    setPromptUpgradeStarted(true);
  });

  createEffect(() => {
    if (!promptUpgradeRequested()) return;
    if (!args.maintenance.error()) return;
    setOpen(true);
  });

  createEffect(() => {
    if (!promptUpgradeRequested()) return;
    if (!promptUpgradeStarted()) return;
    if (args.maintenance.maintaining()) return;
    if (args.maintenance.error()) return;

    const requestedTargetVersion = String(promptRequestedTargetVersion() ?? '').trim();
    const currentVersion = String(args.version.currentVersion() ?? '').trim();
    if (!isReleaseVersion(requestedTargetVersion)) return;
    if (!isReleaseVersion(currentVersion)) return;

    const compare = compareReleaseVersionCore(currentVersion, requestedTargetVersion);
    if (compare == null || compare < 0) return;

    const envId = String(args.envId() ?? '').trim();
    if (envId) {
      setPromptMemory(clearRuntimeUpdateSkippedVersionIfMatched(envId, requestedTargetVersion));
    }

    setOpen(false);
    resetPromptUpgradeState();
  });

  createEffect(() => {
    if (!open()) return;
    if (promptUpgradeRequested()) return;
    if (mode() !== 'available') return;
    if (canKeepAvailablePromptOpen()) return;
    setOpen(false);
  });

  createEffect(() => {
    const shouldOpen = shouldShowRuntimeUpdatePrompt({
      accessGateVisible: args.accessGateVisible(),
      isLocalMode: args.isLocalMode(),
      upgradePolicy: args.version.latestMeta()?.upgrade_policy,
      protocolStatus: args.protocolStatus(),
      canAdmin: args.canAdmin(),
      envStatus: args.envStatus(),
      maintaining: args.maintenance.maintaining(),
      currentVersion: args.version.currentVersion(),
      preferredTargetVersion: args.version.preferredTargetVersion(),
      latestStale: Boolean(args.version.latestMeta()?.stale),
      promptMemory: promptMemory(),
      today: formatLocalDateStamp(),
    });
    if (!shouldOpen) return;
    if (promptUpgradeRequested()) return;

    const envId = String(args.envId() ?? '').trim();
    const preferredTargetVersion = String(args.version.preferredTargetVersion() ?? '').trim();
    if (!envId || !preferredTargetVersion) return;

    setPromptMemory(markRuntimeUpdatePromptShown(envId, preferredTargetVersion));
    setOpen(true);
  });

  const scheduleNextRefresh = (cacheTtlMs: number | null | undefined, generation: number) => {
    clearRefreshTimer();
    if (!refreshEligible()) return;

    refreshTimer = window.setTimeout(() => {
      if (generation !== refreshGeneration) return;
      void runRefresh(generation);
    }, clampRefreshDelay(cacheTtlMs));
  };

  const runRefresh = async (generation: number) => {
    if (!refreshEligible()) return;

    try {
      const latestMeta = await args.version.refetchLatestVersion();
      if (generation !== refreshGeneration) return;
      scheduleNextRefresh(latestMeta?.cache_ttl_ms, generation);
    } catch {
      if (generation !== refreshGeneration) return;
      scheduleNextRefresh(args.version.latestMeta()?.cache_ttl_ms, generation);
    }
  };

  createEffect(() => {
    const eligible = refreshEligible();
    refreshGeneration += 1;
    const generation = refreshGeneration;
    clearRefreshTimer();

    if (!eligible) return;
    void runRefresh(generation);
  });

  createEffect(() => {
    const envId = String(args.envId() ?? '').trim();
    if (!envId) return;

    const expectedKey = runtimeUpdatePromptStorageKey(envId);
    if (!expectedKey) return;

    const onStorage = (event: StorageEvent) => {
      if (event.key !== expectedKey) return;
      syncPromptMemory();
    };

    window.addEventListener('storage', onStorage);
    onCleanup(() => window.removeEventListener('storage', onStorage));
  });

  onCleanup(() => {
    clearRefreshTimer();
  });

  const dismiss = () => {
    setOpen(false);
    if (mode() === 'failed') {
      resetPromptUpgradeState();
    }
  };

  const skipCurrentVersion = () => {
    const envId = String(args.envId() ?? '').trim();
    const nextTargetVersion = targetVersion();
    if (envId && nextTargetVersion) {
      setPromptMemory(markRuntimeUpdateVersionSkipped(envId, nextTargetVersion));
    }
    setOpen(false);
    resetPromptUpgradeState();
  };

  const startRecommendedUpgrade = async () => {
    const nextTargetVersion = String(args.version.preferredTargetVersion() ?? '').trim() || targetVersion();
    setPromptRequestedTargetVersion(nextTargetVersion);
    setPromptUpgradeRequested(true);
    setPromptUpgradeStarted(false);
    setOpen(true);
    await args.maintenance.startUpgrade(nextTargetVersion);
  };

  return {
    open,
    visible,
    mode,
    targetVersion,
    currentVersion: () => args.version.currentVersion(),
    latestMessage: () => String(args.version.latestMeta()?.message ?? '').trim(),
    stage: () => args.maintenance.stage(),
    error: () => args.maintenance.error(),
    dismiss,
    skipCurrentVersion,
    startRecommendedUpgrade,
    retry: startRecommendedUpgrade,
  };
}
