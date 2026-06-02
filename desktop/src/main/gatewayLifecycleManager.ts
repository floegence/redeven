import {
  DEFAULT_DESKTOP_SSH_AUTH_MODE,
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  desktopRuntimeTargetID,
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import { ensureRuntimePlacementReady } from './runtimePlacementManager';
import { type RuntimePlacementBridgeSession, startRuntimePlacementBridgeSession } from './runtimePlacementBridgeSession';
import { ensureManagedSSHRuntimeReady } from './sshRuntime';
import {
  GatewayBridgeClient,
  GatewayURLClient,
  type GatewayCatalogResponse,
  type GatewayOpenSessionRequest,
  type GatewayOpenSessionResponse,
} from './gatewayClient';
import { gatewayEnvAppBridgeRouteID } from './gatewaySessionArtifact';
import { gatewayRecordSSHPasswordRef, type GatewayRecord } from './gatewayStore';
import type { GatewaySecretStore } from './gatewayTrust';

type GatewayLifecycleSession = Readonly<{
  target_id: string;
  route_id: string;
  bridge_session: RuntimePlacementBridgeSession;
  client: GatewayBridgeClient;
}>;

export type GatewayRuntimeLifecycleProgress = Readonly<{
  phase: 'checking_host' | 'checking_container' | 'preparing_runtime_package' | 'installing_runtime' | 'starting_runtime' | 'opening_bridge' | 'gateway_ready';
  title: string;
  detail: string;
}>;

export type GatewayLifecycleManagerOptions = Readonly<{
  secret_store: GatewaySecretStore;
  runtime_release_tag: string;
  release_base_url: string;
  asset_cache_root: string;
  temp_root: string;
  desktop_owner_id: () => Promise<string>;
  source_runtime_root?: string;
  session_cache?: Map<string, GatewayLifecycleSession>;
  signal?: AbortSignal;
  on_progress?: (progress: GatewayRuntimeLifecycleProgress) => void;
}>;

export class GatewayLifecycleManager {
  private readonly sessions: Map<string, GatewayLifecycleSession>;

  constructor(private readonly options: GatewayLifecycleManagerOptions) {
    this.sessions = options.session_cache ?? new Map();
  }

  async catalog(record: GatewayRecord, options: Readonly<{ timeoutMs?: number; signal?: AbortSignal }> = {}): Promise<GatewayCatalogResponse> {
    if (record.connection.kind === 'url') {
      return new GatewayURLClient(this.options.secret_store).catalog(record, options);
    }
    return (await this.bridgeClient(record, options.signal)).catalog(record, options);
  }

  async openSession(
    record: GatewayRecord,
    request: GatewayOpenSessionRequest,
    options: Readonly<{ timeoutMs?: number; signal?: AbortSignal }> = {},
  ): Promise<GatewayOpenSessionResponse> {
    return (await this.openSessionWithBridge(record, request, options)).response;
  }

  async openSessionWithBridge(
    record: GatewayRecord,
    request: GatewayOpenSessionRequest,
    options: Readonly<{ timeoutMs?: number; signal?: AbortSignal }> = {},
  ): Promise<Readonly<{
    response: GatewayOpenSessionResponse;
    bridge_session?: RuntimePlacementBridgeSession;
  }>> {
    if (record.connection.kind === 'url') {
      return {
        response: await new GatewayURLClient(this.options.secret_store).openSession(record, request, options),
      };
    }
    const session = await this.ensureBridgeSession(record, options.signal);
    const bridgeRequest = {
      ...request,
      bridge_session_id: session.bridge_session.placement_target_id,
      route_id: session.route_id,
    };
    return {
      response: await session.client.openSession(record, bridgeRequest, options),
      bridge_session: session.bridge_session,
    };
  }

  async bridgeClient(record: GatewayRecord, signal?: AbortSignal): Promise<GatewayBridgeClient> {
    const session = await this.ensureBridgeSession(record, signal);
    return session.client;
  }

  async clear(record: GatewayRecord): Promise<void> {
    const key = gatewayLifecycleTargetID(record);
    const existing = this.sessions.get(key);
    this.sessions.delete(key);
    await existing?.bridge_session.disconnect().catch(() => undefined);
  }

  private async ensureBridgeSession(record: GatewayRecord, signal?: AbortSignal): Promise<GatewayLifecycleSession> {
    const targetID = gatewayLifecycleTargetID(record);
    const existing = this.sessions.get(targetID);
    if (existing) {
      return existing;
    }
    const hostAccess = gatewayHostAccess(record);
    const placement = gatewayPlacement(record);
    const sshPassword = await this.gatewaySSHPassword(record);
    const runtimeBinaryPath = await this.ensureRuntimeReady(record, hostAccess, placement, sshPassword, signal);
    this.emit('opening_bridge', 'Opening Gateway bridge', 'Desktop is opening the Gateway protocol stream through the existing runtime placement bridge.');
    const bridgeSession = await startRuntimePlacementBridgeSession({
      host_access: hostAccess,
      placement,
      runtime_binary_path: runtimeBinaryPath,
      desktop_owner_id: await this.options.desktop_owner_id(),
      ssh_password: sshPassword,
      fallback_local_id: record.gateway_id,
      signal,
    });
    const session: GatewayLifecycleSession = {
      target_id: targetID,
      route_id: gatewayEnvAppBridgeRouteID(record),
      bridge_session: bridgeSession,
      client: new GatewayBridgeClient(this.options.secret_store, bridgeSession),
    };
    this.sessions.set(targetID, session);
    this.emit('gateway_ready', 'Gateway ready', 'Desktop can now use Gateway protocol for catalog and open-session.');
    return session;
  }

  private async ensureRuntimeReady(
    record: GatewayRecord,
    hostAccess: DesktopRuntimeHostAccess,
    placement: DesktopRuntimePlacement,
    sshPassword: string,
    signal?: AbortSignal,
  ): Promise<string> {
    if (record.connection.kind === 'ssh_host') {
      this.emit('checking_host', 'Checking SSH Gateway host', 'Desktop is checking the SSH host and installing the Gateway runtime when needed.');
      const target = gatewaySSHDetails(record);
      await ensureManagedSSHRuntimeReady({
        target,
        runtimeReleaseTag: this.options.runtime_release_tag,
        tempRoot: this.options.temp_root,
        assetCacheRoot: this.options.asset_cache_root,
        sourceRuntimeRoot: this.options.source_runtime_root,
        sshPassword,
        desktopOwnerID: await this.options.desktop_owner_id(),
        signal,
      });
      return gatewayManagedSSHRuntimeBinaryPath(target);
    }
    this.emit('checking_container', 'Checking Gateway container', 'Desktop is checking the selected running container through the SSH host.');
    const ready = await ensureRuntimePlacementReady({
      host_access: hostAccess,
      placement,
      ssh_password: sshPassword,
      runtime_release_tag: this.options.runtime_release_tag,
      release_base_url: this.options.release_base_url,
      source_runtime_root: this.options.source_runtime_root,
      asset_cache_root: this.options.asset_cache_root,
      timeout_ms: 45_000,
      desktop_owner_id: await this.options.desktop_owner_id(),
      signal,
      on_progress: (progress) => {
        this.emit(progress.phase === 'checking_container'
          ? 'checking_container'
          : progress.phase === 'preparing_runtime_package'
            ? 'preparing_runtime_package'
            : progress.phase === 'installing_runtime'
              ? 'installing_runtime'
              : progress.phase === 'starting_runtime_daemon' || progress.phase === 'waiting_runtime_daemon'
                ? 'starting_runtime'
                : 'checking_container', progress.title, progress.detail);
      },
    });
    return ready.runtime_binary_path;
  }

  private async gatewaySSHPassword(record: GatewayRecord): Promise<string> {
    const ref = gatewayRecordSSHPasswordRef(record);
    if (!ref) {
      return '';
    }
    return this.options.secret_store.readSecret(ref);
  }

  private emit(phase: GatewayRuntimeLifecycleProgress['phase'], title: string, detail: string): void {
    this.options.on_progress?.({ phase, title, detail });
  }
}

function gatewaySSHDetails(record: GatewayRecord): DesktopSSHEnvironmentDetails {
  const connection = record.connection;
  if (connection.kind === 'url') {
    throw new Error('URL Gateways do not have SSH details.');
  }
  return {
    ssh_destination: connection.ssh_destination,
    ssh_port: connection.ssh_port ?? null,
    auth_mode: connection.auth_mode ?? DEFAULT_DESKTOP_SSH_AUTH_MODE,
    connect_timeout_seconds: connection.connect_timeout_seconds ?? DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS,
    runtime_root: connection.runtime_root,
    bootstrap_strategy: connection.kind === 'ssh_host'
      ? connection.bootstrap_strategy ?? DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY
      : DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
    release_base_url: connection.kind === 'ssh_host'
      ? connection.release_base_url ?? DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL
      : DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  };
}

function gatewayHostAccess(record: GatewayRecord): DesktopRuntimeHostAccess {
  return {
    kind: 'ssh_host',
    ssh: gatewaySSHDetails(record),
  };
}

function gatewayPlacement(record: GatewayRecord): DesktopRuntimePlacement {
  if (record.connection.kind === 'ssh_host') {
    return {
      kind: 'host_process',
      runtime_root: record.connection.runtime_root,
      bootstrap_strategy: record.connection.bootstrap_strategy ?? DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
      release_base_url: record.connection.release_base_url ?? DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
    };
  }
  if (record.connection.kind === 'ssh_container') {
    return {
      kind: 'container_process',
      container_engine: record.connection.container_engine,
      container_id: record.connection.container_id,
      container_ref: record.connection.container_ref ?? record.connection.container_label ?? record.connection.container_id,
      container_label: record.connection.container_label ?? record.connection.container_id,
      runtime_root: record.connection.runtime_root,
      bridge_strategy: 'exec_stream',
    };
  }
  throw new Error('URL Gateways do not use runtime placement.');
}

function gatewayLifecycleTargetID(record: GatewayRecord): string {
  if (record.connection.kind === 'url') {
    return `gateway:url:${record.gateway_id}`;
  }
  return desktopRuntimeTargetID(gatewayHostAccess(record), gatewayPlacement(record), record.gateway_id);
}

function gatewayManagedSSHRuntimeBinaryPath(target: DesktopSSHEnvironmentDetails): string {
  if (target.runtime_root === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT) {
    return DEFAULT_DESKTOP_SSH_RUNTIME_ROOT;
  }
  const runtimeRoot = target.runtime_root;
  return `${runtimeRoot.replace(/\/+$/u, '')}/runtime/managed/bin/redeven`;
}
