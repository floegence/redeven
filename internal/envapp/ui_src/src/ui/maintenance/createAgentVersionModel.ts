import { createEffect, createMemo, createResource, createSignal, type Accessor } from 'solid-js';

import type { RedevenV1Rpc } from '../protocol/redeven_v1/contract';
import type { SysPingResponse } from '../protocol/redeven_v1/sdk/sys';
import { getAgentLatestVersion, type AgentLatestVersion } from '../services/controlplaneApi';
import { compareReleaseVersionCore, isReleaseVersion, resolvePreferredTargetVersion } from './agentVersion';
import { formatUnknownError } from './shared';

type VersionRpc = Readonly<{
  sys: Pick<RedevenV1Rpc['sys'], 'ping'>;
}>;

export type AgentVersionModel = Readonly<{
  currentPing: Accessor<SysPingResponse | null>;
  currentPingLoading: Accessor<boolean>;
  currentProcessStartedAtMs: Accessor<number | null>;
  runtimeService: Accessor<SysPingResponse['runtimeService']>;
  currentVersion: Accessor<string>;
  currentVersionValid: Accessor<boolean>;
  latestMeta: Accessor<AgentLatestVersion | null>;
  latestMetaLoading: Accessor<boolean>;
  latestMetaError: Accessor<string>;
  preferredTargetVersion: Accessor<string>;
  preferredTargetVersionValid: Accessor<boolean>;
  preferredTargetCompareToCurrent: Accessor<number | null>;
  updateAvailable: Accessor<boolean>;
  ensureLatestVersionLoaded: () => Promise<AgentLatestVersion | null>;
  refetchLatestVersion: () => Promise<AgentLatestVersion | null>;
  refetchCurrentVersion: () => Promise<SysPingResponse | null>;
}>;

type CreateAgentVersionModelArgs = Readonly<{
  envId: Accessor<string>;
  currentPingSource: Accessor<unknown | null>;
  rpc: VersionRpc;
}>;

export function createAgentVersionModel(args: CreateAgentVersionModelArgs): AgentVersionModel {
  const [currentPingResource, { refetch: refetchCurrentPingResource }] = createResource<SysPingResponse | null, unknown | null>(
    () => args.currentPingSource(),
    async (source) => (source == null ? null : await args.rpc.sys.ping()),
  );

  const [latestMeta, setLatestMeta] = createSignal<AgentLatestVersion | null>(null);
  const [latestMetaLoading, setLatestMetaLoading] = createSignal(false);
  const [latestMetaError, setLatestMetaError] = createSignal('');
  const [latestSettledEnvId, setLatestSettledEnvId] = createSignal('');

  let latestRequestToken = 0;
  let latestInFlight: Promise<AgentLatestVersion | null> | null = null;
  let latestInFlightEnvId = '';
  let previousEnvId = '';

  createEffect(() => {
    const envId = String(args.envId() ?? '').trim();
    if (envId === previousEnvId) return;
    previousEnvId = envId;
    latestRequestToken += 1;
    latestInFlight = null;
    latestInFlightEnvId = '';
    setLatestMeta(null);
    setLatestMetaLoading(false);
    setLatestMetaError('');
    setLatestSettledEnvId('');
  });

  const loadLatestMeta = async (mode: 'ensure' | 'refetch'): Promise<AgentLatestVersion | null> => {
    const envId = String(args.envId() ?? '').trim();
    if (!envId) {
      setLatestMeta(null);
      setLatestMetaLoading(false);
      setLatestMetaError('');
      setLatestSettledEnvId('');
      return null;
    }

    if (mode === 'ensure' && latestSettledEnvId() === envId) {
      return latestMeta();
    }

    if (latestInFlight && latestInFlightEnvId === envId) {
      return latestInFlight;
    }

    const requestToken = ++latestRequestToken;
    latestInFlightEnvId = envId;
    setLatestMetaLoading(true);
    setLatestMetaError('');

    let request: Promise<AgentLatestVersion | null> | null = null;
    request = (async () => {
      try {
        const nextMeta = await getAgentLatestVersion(envId);
        if (latestRequestToken === requestToken) {
          const normalizedMeta = nextMeta ?? null;
          setLatestMeta(normalizedMeta);
          setLatestSettledEnvId(normalizedMeta ? envId : '');
        }
        return nextMeta ?? null;
      } catch (error) {
        if (latestRequestToken === requestToken) {
          setLatestMetaError(formatUnknownError(error) || 'Request failed.');
          setLatestSettledEnvId(envId);
        }
        throw error;
      } finally {
        if (latestRequestToken === requestToken) {
          setLatestMetaLoading(false);
        }
        if (latestInFlight === request) {
          latestInFlight = null;
          latestInFlightEnvId = '';
        }
      }
    })();

    latestInFlight = request;
    return request;
  };

  const currentPing = createMemo(() => currentPingResource() ?? null);
  const currentProcessStartedAtMs = createMemo(() => {
    const value = Number(currentPing()?.processStartedAtMs ?? Number.NaN);
    return Number.isFinite(value) && value > 0 ? value : null;
  });
  const currentVersion = createMemo(() => String(currentPing()?.version ?? '').trim());
  const preferredTargetVersion = createMemo(() => resolvePreferredTargetVersion(latestMeta()));
  const preferredTargetCompareToCurrent = createMemo(() => compareReleaseVersionCore(currentVersion(), preferredTargetVersion()));

  createEffect(() => {
    const envId = String(args.envId() ?? '').trim();
    if (!envId) return;
    if (currentPing() == null) return;
    void loadLatestMeta('ensure').catch(() => undefined);
  });

  const refetchCurrentVersion = async (): Promise<SysPingResponse | null> => {
    if (args.currentPingSource() == null) return null;
    const nextPing = await refetchCurrentPingResource();
    return nextPing ?? null;
  };

  return {
    currentPing,
    currentPingLoading: () => currentPingResource.loading,
    currentProcessStartedAtMs,
    runtimeService: () => currentPing()?.runtimeService,
    currentVersion,
    currentVersionValid: () => isReleaseVersion(currentVersion()),
    latestMeta,
    latestMetaLoading,
    latestMetaError,
    preferredTargetVersion,
    preferredTargetVersionValid: () => isReleaseVersion(preferredTargetVersion()),
    preferredTargetCompareToCurrent,
    updateAvailable: () => {
      const compare = preferredTargetCompareToCurrent();
      return compare != null && compare < 0;
    },
    ensureLatestVersionLoaded: () => loadLatestMeta('ensure'),
    refetchLatestVersion: () => loadLatestMeta('refetch'),
    refetchCurrentVersion,
  };
}
