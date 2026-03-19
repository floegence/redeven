import { createMemo, createSignal, onCleanup, type Accessor } from 'solid-js';

import type { RedevenV1Rpc } from '../protocol/redeven_v1/contract';
import type { SysPingResponse, SysRestartResponse, SysUpgradeResponse } from '../protocol/redeven_v1/sdk/sys';
import { getEnvironment, type EnvironmentDetail } from '../services/controlplaneApi';
import { isReleaseVersion } from './agentVersion';
import { formatUnknownError, sleep, type MaintenanceKind } from './shared';

type MaintenanceRpc = Readonly<{
  sys: Pick<RedevenV1Rpc['sys'], 'restart' | 'upgrade'>;
}>;

type NotificationApi = Readonly<{
  error: (title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
}>;

export type AgentMaintenanceController = Readonly<{
  kind: Accessor<MaintenanceKind | null>;
  targetVersion: Accessor<string>;
  maintaining: Accessor<boolean>;
  isUpgrading: Accessor<boolean>;
  isRestarting: Accessor<boolean>;
  error: Accessor<string | null>;
  polledStatus: Accessor<string | null>;
  displayedStatus: Accessor<string>;
  stage: Accessor<string | null>;
  clearError: () => void;
  startUpgrade: (targetVersion: string) => Promise<void>;
  startRestart: () => Promise<void>;
}>;

type CreateAgentMaintenanceControllerArgs = Readonly<{
  envId: Accessor<string>;
  canAdmin: Accessor<boolean>;
  controlplaneStatus: Accessor<string>;
  protocolStatus: Accessor<string>;
  currentProcessStartedAtMs: Accessor<number | null>;
  currentVersion: Accessor<string>;
  connect: () => Promise<void>;
  notify: NotificationApi;
  rpc: MaintenanceRpc;
  refetchCurrentVersion: () => Promise<SysPingResponse | null>;
  refetchEnvironment?: () => Promise<EnvironmentDetail | null>;
  getEnvironment?: (envId: string) => Promise<EnvironmentDetail | null>;
}>;

function normalizeProcessStartedAtMs(value: unknown): number | null {
  const numeric = Number(value ?? Number.NaN);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function createAgentMaintenanceController(args: CreateAgentMaintenanceControllerArgs): AgentMaintenanceController {
  const loadEnvironment = args.getEnvironment ?? getEnvironment;

  const [kind, setKind] = createSignal<MaintenanceKind | null>(null);
  const [targetVersion, setTargetVersion] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [polledStatus, setPolledStatus] = createSignal<string | null>(null);

  const maintaining = createMemo(() => kind() !== null);
  const isUpgrading = createMemo(() => kind() === 'upgrade');
  const isRestarting = createMemo(() => kind() === 'restart');
  const displayedStatus = createMemo(() => {
    const nextStatus = maintaining() && polledStatus() ? String(polledStatus() ?? '').trim() : String(args.controlplaneStatus() ?? '').trim();
    return nextStatus || 'unknown';
  });
  const stage = createMemo(() => {
    const currentKind = kind();
    if (!currentKind) return null;

    if (String(args.protocolStatus() ?? '').trim() === 'connected') {
      return currentKind === 'upgrade' ? 'Downloading and installing update...' : 'Restarting agent...';
    }

    const nextStatus = String(polledStatus() ?? '').trim().toLowerCase();
    if (nextStatus && nextStatus !== 'online') return 'Agent restarting...';
    if (nextStatus === 'online') return 'Reconnecting...';
    return 'Waiting for agent...';
  });

  let maintenanceAborted = false;
  onCleanup(() => {
    maintenanceAborted = true;
  });

  const startMaintenance = async (nextKind: MaintenanceKind, requestedTargetVersion: string): Promise<void> => {
    if (maintaining()) return;

    setError(null);
    setPolledStatus(null);

    const envId = String(args.envId() ?? '').trim();
    if (!envId) {
      const message = 'Missing env context. Please reopen from the Redeven Portal.';
      setError(message);
      args.notify.error(nextKind === 'upgrade' ? 'Update failed' : 'Restart failed', message);
      return;
    }

    if (!args.canAdmin()) {
      const message = 'Admin permission required.';
      setError(message);
      args.notify.error(nextKind === 'upgrade' ? 'Update failed' : 'Restart failed', message);
      return;
    }

    if (String(args.protocolStatus() ?? '').trim() !== 'connected') {
      const message = 'Agent connection is not ready.';
      setError(message);
      args.notify.error(nextKind === 'upgrade' ? 'Update failed' : 'Restart failed', message);
      return;
    }

    if (String(args.controlplaneStatus() ?? '').trim().toLowerCase() !== 'online') {
      const message = 'Agent must be online before maintenance starts.';
      setError(message);
      args.notify.error(nextKind === 'upgrade' ? 'Update failed' : 'Restart failed', message);
      return;
    }

    const cleanTargetVersion = String(requestedTargetVersion ?? '').trim();
    if (nextKind === 'upgrade' && !isReleaseVersion(cleanTargetVersion)) {
      const message = 'Target version must be a valid release tag (for example: v1.2.3).';
      setError(message);
      args.notify.error('Update failed', message);
      return;
    }

    setKind(nextKind);
    setTargetVersion(nextKind === 'upgrade' ? cleanTargetVersion : '');

    let baselinePing: SysPingResponse | null = null;
    try {
      baselinePing = await args.refetchCurrentVersion();
    } catch {
      // Ignore transient ping failures here and rely on the latest settled version/process markers.
    }

    const previousVersion = nextKind === 'upgrade'
      ? String(baselinePing?.version ?? args.currentVersion() ?? '').trim()
      : '';
    const previousProcessStartedAtMs =
      normalizeProcessStartedAtMs(baselinePing?.processStartedAtMs) ??
      normalizeProcessStartedAtMs(args.currentProcessStartedAtMs());

    let started = false;
    try {
      const response: SysUpgradeResponse | SysRestartResponse =
        nextKind === 'upgrade'
          ? await args.rpc.sys.upgrade({ targetVersion: cleanTargetVersion })
          : await args.rpc.sys.restart();

      if (!response?.ok) {
        const message = response?.message
          ? String(response.message)
          : nextKind === 'upgrade'
            ? 'Upgrade rejected.'
            : 'Restart rejected.';
        setError(message);
        args.notify.error(nextKind === 'upgrade' ? 'Update failed' : 'Restart failed', message);
        setKind(null);
        return;
      }

      started = true;
      args.notify.success(
        nextKind === 'upgrade' ? 'Update started' : 'Restart started',
        nextKind === 'upgrade'
          ? `Target version: ${cleanTargetVersion}`
          : response?.message
            ? String(response.message)
            : 'The agent will restart shortly.',
      );
    } catch (err) {
      const message = formatUnknownError(err) || 'Request failed.';
      if (String(args.protocolStatus() ?? '').trim() !== 'connected') {
        started = true;
        args.notify.info(nextKind === 'upgrade' ? 'Update started' : 'Restart started', 'Waiting for agent restart...');
      } else {
        setError(message);
        args.notify.error(nextKind === 'upgrade' ? 'Update failed' : 'Restart failed', message);
        setKind(null);
        return;
      }
    }

    if (!started) {
      setKind(null);
      return;
    }

    const startedAt = Date.now();
    const timeoutMs = nextKind === 'upgrade' ? 10 * 60 * 1000 : 5 * 60 * 1000;
    let sawDisconnect = false;

    for (;;) {
      if (maintenanceAborted) return;

      if (Date.now() - startedAt > timeoutMs) {
        const message = 'Timed out waiting for the agent to restart.';
        setError(message);
        args.notify.error(nextKind === 'upgrade' ? 'Update timed out' : 'Restart timed out', message);
        setKind(null);
        return;
      }

      if (String(args.protocolStatus() ?? '').trim() !== 'connected') {
        sawDisconnect = true;
      }

      try {
        const detail = await loadEnvironment(envId);
        const nextStatus = detail?.status ? String(detail.status) : null;
        if (nextStatus) setPolledStatus(nextStatus);
      } catch {
        // Ignore transient control plane failures while maintenance is running.
      }

      if (sawDisconnect && displayedStatus().trim().toLowerCase() === 'online') {
        try {
          await args.connect();
        } catch {
          // Keep polling until the connection is healthy again.
        }
      }

      if (String(args.protocolStatus() ?? '').trim() === 'connected') {
        try {
          const ping = await args.refetchCurrentVersion();
          const nextVersion = String(ping?.version ?? '').trim();
          const nextProcessStartedAtMs = normalizeProcessStartedAtMs(ping?.processStartedAtMs);
          const restarted = previousProcessStartedAtMs !== null
            ? nextProcessStartedAtMs !== null && nextProcessStartedAtMs !== previousProcessStartedAtMs
            : sawDisconnect && nextProcessStartedAtMs !== null;
          if (!restarted) {
            await sleep(1500);
            continue;
          }

          setKind(null);
          setPolledStatus(null);
          setTargetVersion('');
          if (args.refetchEnvironment) {
            await args.refetchEnvironment();
          }

          if (nextKind === 'upgrade' && previousVersion && nextVersion && nextVersion !== previousVersion) {
            args.notify.success('Updated', `Agent updated to ${nextVersion}.`);
          } else {
            args.notify.success('Reconnected', 'Agent is back online.');
          }
          return;
        } catch {
          // Still reconnecting; continue polling.
        }
      }

      await sleep(1500);
    }
  };

  return {
    kind,
    targetVersion,
    maintaining,
    isUpgrading,
    isRestarting,
    error,
    polledStatus,
    displayedStatus,
    stage,
    clearError: () => setError(null),
    startUpgrade: (requestedTargetVersion: string) => startMaintenance('upgrade', requestedTargetVersion),
    startRestart: () => startMaintenance('restart', ''),
  };
}
