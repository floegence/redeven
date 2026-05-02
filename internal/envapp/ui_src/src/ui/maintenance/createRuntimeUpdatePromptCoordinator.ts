import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';

import {
  runtimeUpdatePromptStorageKey,
  formatLocalDateStamp,
  markRuntimeUpdatePromptShown,
  readRuntimeUpdatePromptMemory,
  shouldShowRuntimeUpdatePrompt,
  type RuntimeUpdatePromptMemory,
} from './runtimeUpdatePromptState';
import type { AgentMaintenanceController } from './createAgentMaintenanceController';
import type { AgentVersionModel } from './createAgentVersionModel';

const MIN_REFRESH_DELAY_MS = 5 * 60 * 1000;
const MAX_REFRESH_DELAY_MS = 30 * 60 * 1000;
const DEFAULT_REFRESH_DELAY_MS = 10 * 60 * 1000;

export type RuntimeUpdatePromptCoordinator = Readonly<{
  consumeNotice: () => RuntimeUpdatePromptNotice | null;
}>;

export type RuntimeUpdatePromptNotice = Readonly<{
  id: string;
  title: string;
  message: string;
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
  const [promptMemory, setPromptMemory] = createSignal<RuntimeUpdatePromptMemory>({});
  const [notice, setNotice] = createSignal<RuntimeUpdatePromptNotice | null>(null);

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

  const syncPromptMemory = () => {
    setPromptMemory(loadPromptMemoryForEnv(args.envId()));
  };

  createEffect(() => {
    const envId = String(args.envId() ?? '').trim();
    if (envId === previousEnvId) return;
    previousEnvId = envId;
    syncPromptMemory();
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

    const envId = String(args.envId() ?? '').trim();
    const preferredTargetVersion = String(args.version.preferredTargetVersion() ?? '').trim();
    if (!envId || !preferredTargetVersion) return;

    setPromptMemory(markRuntimeUpdatePromptShown(envId, preferredTargetVersion));
    setNotice({
      id: `update-available:${envId}:${preferredTargetVersion}`,
      title: 'Runtime update ready',
      message: `Runtime Service ${preferredTargetVersion} is ready. Open Runtime Status when your work is idle.`,
    });
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

  const consumeNotice = () => {
    const current = notice();
    if (current) {
      setNotice(null);
    }
    return current;
  };

  return {
    consumeNotice,
  };
}
