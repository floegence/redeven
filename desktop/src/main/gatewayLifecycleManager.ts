import {
  DEFAULT_DESKTOP_SSH_AUTH_MODE,
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_DESKTOP_SSH_GATEWAY_PROFILE_DIR,
  DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  desktopSSHRuntimeRootSubpath,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  desktopRuntimeTargetID,
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import { ensureRuntimePlacementReady } from './runtimePlacementManager';
import { type RuntimePlacementBridgeSession, startRuntimePlacementBridgeSession } from './runtimePlacementBridgeSession';
import {
  ensureManagedSSHRuntimeReady,
  probeManagedSSHRuntimeStatus,
  stopManagedSSHRuntimeProcess,
} from './sshRuntime';
import { createSSHRuntimeHostExecutor } from './runtimeHostAccess';
import { containerRuntimeDaemonStatusCommand, containerRuntimeDaemonStopCommand } from './containerRuntime';
import { parseLaunchReport } from './launchReport';
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
import type { DesktopGatewayRuntimeState } from '../shared/desktopGateway';

export type GatewayLifecycleSession = Readonly<{
  target_id: string;
  route_id: string;
  bridge_session: RuntimePlacementBridgeSession;
  client: GatewayBridgeClient;
}>;

export class GatewayRuntimeStartRequiredError extends Error {
  readonly runtime_state: DesktopGatewayRuntimeState;

  constructor(runtimeState: DesktopGatewayRuntimeState, message = 'Gateway Runtime must be started before this action can continue.') {
    super(message);
    this.name = 'GatewayRuntimeStartRequiredError';
    this.runtime_state = runtimeState;
  }
}

export class GatewayNotManageableError extends Error {
  constructor(message = 'URL Gateways cannot be managed from Desktop.') {
    super(message);
    this.name = 'GatewayNotManageableError';
  }
}

export class GatewayRuntimeUnavailableError extends Error {
  constructor(
    readonly code:
      | 'gateway_runtime_unreachable'
      | 'gateway_container_unavailable'
      | 'gateway_bridge_unavailable'
      | 'gateway_runtime_start_failed',
    message: string,
  ) {
    super(message);
    this.name = 'GatewayRuntimeUnavailableError';
  }
}

export type GatewayRuntimeLifecycleProgress = Readonly<{
  phase:
    | 'checking_host'
    | 'checking_container'
    | 'preparing_runtime_package'
    | 'installing_runtime'
    | 'starting_runtime'
    | 'opening_bridge'
    | 'stopping_runtime'
    | 'verifying_runtime_stopped'
    | 'gateway_ready';
  title: string;
  detail: string;
}>;

export type GatewayStartPolicy = 'require_ready' | 'start_if_needed';
export type GatewayLifecycleProgressSink = (progress: GatewayRuntimeLifecycleProgress) => void;
export type GatewayRuntimeTargetDescriptor = Readonly<{
  target_id: string;
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  runtime_state_root: string;
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
  on_progress?: GatewayLifecycleProgressSink;
}>;

export class GatewayLifecycleManager {
  private readonly sessions: Map<string, GatewayLifecycleSession>;
  private readonly pendingStartTasks = new Map<string, Promise<GatewayLifecycleSession>>();

  constructor(private readonly options: GatewayLifecycleManagerOptions) {
    this.sessions = options.session_cache ?? new Map();
  }

  async catalog(record: GatewayRecord, options: Readonly<{ timeoutMs?: number; signal?: AbortSignal; startPolicy?: GatewayStartPolicy; onProgress?: GatewayLifecycleProgressSink }> = {}): Promise<GatewayCatalogResponse> {
    return this.refreshCatalog(record, options);
  }

  async refreshCatalog(record: GatewayRecord, options: Readonly<{ timeoutMs?: number; signal?: AbortSignal; startPolicy?: GatewayStartPolicy; onProgress?: GatewayLifecycleProgressSink }> = {}): Promise<GatewayCatalogResponse> {
    if (record.connection.kind === 'url') {
      return new GatewayURLClient(this.options.secret_store).catalog(record, options);
    }
    return (await this.ensureGatewayReady(record, {
      startPolicy: options.startPolicy ?? 'require_ready',
      signal: options.signal,
      onProgress: options.onProgress,
    })).client.catalog(record, options);
  }

  async openSession(
    record: GatewayRecord,
    request: GatewayOpenSessionRequest,
    options: Readonly<{ timeoutMs?: number; signal?: AbortSignal; startPolicy?: GatewayStartPolicy; onProgress?: GatewayLifecycleProgressSink }> = {},
  ): Promise<GatewayOpenSessionResponse> {
    return (await this.openSessionWithBridge(record, request, options)).response;
  }

  async openSessionWithBridge(
    record: GatewayRecord,
    request: GatewayOpenSessionRequest,
    options: Readonly<{ timeoutMs?: number; signal?: AbortSignal; startPolicy?: GatewayStartPolicy; onProgress?: GatewayLifecycleProgressSink }> = {},
  ): Promise<Readonly<{
    response: GatewayOpenSessionResponse;
    bridge_session?: RuntimePlacementBridgeSession;
  }>> {
    if (record.connection.kind === 'url') {
      return {
        response: await new GatewayURLClient(this.options.secret_store).openSession(record, request, options),
      };
    }
    const session = await this.ensureGatewayReady(record, {
      startPolicy: options.startPolicy ?? 'require_ready',
      signal: options.signal,
      onProgress: options.onProgress,
    });
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

  async bridgeClient(record: GatewayRecord, options: Readonly<{
    startPolicy: GatewayStartPolicy;
    signal?: AbortSignal;
  }>): Promise<GatewayBridgeClient> {
    const session = await this.ensureGatewayReady(record, {
      startPolicy: options.startPolicy,
      signal: options.signal,
    });
    return session.client;
  }

  async inspectRuntime(record: GatewayRecord, signal?: AbortSignal): Promise<DesktopGatewayRuntimeState> {
    if (record.connection.kind === 'url') {
      return notApplicableRuntimeState();
    }
    const targetID = gatewayLifecycleTargetID(record);
    if (this.sessions.has(targetID)) {
      return manageableRuntimeState(record, 'ready', {
        runtimeTargetID: targetID,
        runtimeStateRoot: gatewayRuntimeStateRoot(record),
        message: 'Gateway bridge is ready.',
      });
    }
    const sshPassword = await this.gatewaySSHPassword(record);
    if (record.connection.kind === 'ssh_host') {
      const probe = await probeManagedSSHRuntimeStatus({
        target: gatewaySSHDetails(record),
        runtimeReleaseTag: this.options.runtime_release_tag,
        runtimeStateRoot: gatewayRuntimeStateRoot(record),
        sshPassword,
        tempRoot: this.options.temp_root,
        connectTimeoutSeconds: record.connection.connect_timeout_seconds,
        signal,
      });
      if (probe.status === 'ready') {
        return manageableRuntimeState(record, 'ready', {
          runtimeTargetID: targetID,
          runtimeStateRoot: gatewayRuntimeStateRoot(record),
          message: 'Gateway Runtime is running.',
        });
      }
      if (probe.status === 'not_running') {
        return manageableRuntimeState(record, 'not_started', {
          runtimeTargetID: targetID,
          runtimeStateRoot: gatewayRuntimeStateRoot(record),
          message: probe.message,
        });
      }
      if (probe.status === 'failed') {
        return manageableRuntimeState(record, 'ssh_unreachable', {
          runtimeTargetID: targetID,
          runtimeStateRoot: gatewayRuntimeStateRoot(record),
          message: probe.message,
        });
      }
      return manageableRuntimeState(record, 'runtime_needs_update', {
        runtimeTargetID: targetID,
        runtimeStateRoot: gatewayRuntimeStateRoot(record),
        message: probe.report.message,
      });
    }
    try {
      const hostAccess = gatewayHostAccess(record) as Extract<DesktopRuntimeHostAccess, Readonly<{ kind: 'ssh_host' }>>;
      const placement = gatewayPlacement(record) as Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>;
      const executor = createSSHRuntimeHostExecutor(hostAccess.ssh, { sshPassword });
      const statusResult = await executor.run(containerRuntimeDaemonStatusCommand({
        engine: placement.container_engine,
        container_id: placement.container_id,
        runtime_root: placement.runtime_root,
        runtime_state_root: gatewayRuntimeStateRoot(record),
        runtime_binary_path: gatewayContainerRuntimeBinaryPath(placement.runtime_root),
      }), { signal });
      const report = parseLaunchReport(statusResult.stdout);
      return report.status === 'blocked'
        ? manageableRuntimeState(record, 'not_started', {
            runtimeTargetID: targetID,
            runtimeStateRoot: gatewayRuntimeStateRoot(record),
            message: report.message,
          })
        : manageableRuntimeState(record, 'ready', {
            runtimeTargetID: targetID,
            runtimeStateRoot: gatewayRuntimeStateRoot(record),
            message: 'Gateway Runtime is running.',
          });
    } catch (error) {
      return manageableRuntimeState(record, 'container_unavailable', {
        runtimeTargetID: targetID,
        runtimeStateRoot: gatewayRuntimeStateRoot(record),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async ensureGatewayReady(record: GatewayRecord, options: Readonly<{
    startPolicy: GatewayStartPolicy;
    signal?: AbortSignal;
    onProgress?: GatewayLifecycleProgressSink;
  }>): Promise<GatewayLifecycleSession> {
    if (record.connection.kind === 'url') {
      throw new GatewayNotManageableError();
    }
    const targetID = gatewayLifecycleTargetID(record);
    const existing = this.sessions.get(targetID);
    if (existing) {
      return existing;
    }
    if (options.startPolicy === 'start_if_needed') {
      return this.startGateway(record, options);
    }
    const runtimeState = await this.inspectRuntime(record, options.signal);
    if (runtimeState.status === 'ready') {
      return this.openBridgeSession(record, gatewayRuntimeBinaryPath(record), {
        signal: options.signal,
        onProgress: options.onProgress,
      });
    }
    if (runtimeState.status === 'ssh_unreachable') {
      throw new GatewayRuntimeUnavailableError(
        'gateway_runtime_unreachable',
        runtimeState.message ?? 'Gateway SSH host is unreachable.',
      );
    }
    if (runtimeState.status === 'container_unavailable') {
      throw new GatewayRuntimeUnavailableError(
        'gateway_container_unavailable',
        runtimeState.message ?? 'Gateway container is unavailable.',
      );
    }
    if (runtimeState.status === 'bridge_unavailable' || runtimeState.status === 'error') {
      throw new GatewayRuntimeUnavailableError(
        'gateway_bridge_unavailable',
        runtimeState.message ?? 'Gateway bridge is unavailable.',
      );
    }
    throw new GatewayRuntimeStartRequiredError(runtimeState);
  }

  async startGateway(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink }> = {}): Promise<GatewayLifecycleSession> {
    if (record.connection.kind === 'url') {
      throw new GatewayNotManageableError();
    }
    const targetID = gatewayLifecycleTargetID(record);
    const pending = this.pendingStartTasks.get(targetID);
    if (pending) {
      return pending;
    }
    return this.ensureBridgeSession(record, options);
  }

  async stopGateway(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink }> = {}): Promise<void> {
    if (record.connection.kind === 'url') {
      throw new GatewayNotManageableError();
    }
    await this.clear(record);
    const sshPassword = await this.gatewaySSHPassword(record);
    if (record.connection.kind === 'ssh_host') {
      this.emit(options.onProgress, 'checking_host', 'Checking SSH Gateway host', 'Desktop is checking the SSH host before stopping the Gateway runtime.');
      const target = gatewaySSHDetails(record);
      const probe = await probeManagedSSHRuntimeStatus({
        target,
        runtimeReleaseTag: this.options.runtime_release_tag,
        runtimeStateRoot: gatewayRuntimeStateRoot(record),
        sshPassword,
        tempRoot: this.options.temp_root,
        connectTimeoutSeconds: record.connection.connect_timeout_seconds,
        signal: options.signal,
      });
      if (probe.status !== 'ready') {
        this.emit(options.onProgress, 'gateway_ready', 'Gateway already stopped', 'Desktop did not find a running Gateway runtime.');
        return;
      }
      const pid = Number(probe.startup.pid ?? Number.NaN);
      this.emit(options.onProgress, 'stopping_runtime', 'Stopping Gateway runtime', 'Desktop is stopping the Gateway runtime process.');
      await stopManagedSSHRuntimeProcess({
        target,
        pid,
        sshPassword,
        tempRoot: this.options.temp_root,
        connectTimeoutSeconds: record.connection.connect_timeout_seconds,
        signal: options.signal,
      });
      await this.assertSSHGatewayStopped(record, sshPassword, options);
      return;
    }
    await this.stopContainerGateway(record, sshPassword, options);
  }

  async restartGateway(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink }> = {}): Promise<GatewayLifecycleSession> {
    await this.stopGateway(record, options);
    return this.startGateway(record, options);
  }

  async updateGateway(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink }> = {}): Promise<GatewayLifecycleSession> {
    if (record.connection.kind === 'url') {
      throw new GatewayNotManageableError();
    }
    await this.clear(record);
    const hostAccess = gatewayHostAccess(record);
    const placement = gatewayPlacement(record);
    const sshPassword = await this.gatewaySSHPassword(record);
    const runtimeBinaryPath = await this.ensureRuntimeReady(record, hostAccess, placement, sshPassword, options.signal, {
      forceRuntimeUpdate: true,
      onProgress: options.onProgress,
    });
    return this.openBridgeSession(record, runtimeBinaryPath, {
      signal: options.signal,
      onProgress: options.onProgress,
    });
  }

  async clear(record: GatewayRecord): Promise<void> {
    const key = gatewayLifecycleTargetID(record);
    await this.pendingStartTasks.get(key)?.catch(() => undefined);
    const existing = this.sessions.get(key);
    this.sessions.delete(key);
    await existing?.bridge_session.disconnect().catch(() => undefined);
  }

  private async ensureBridgeSession(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink }> = {}): Promise<GatewayLifecycleSession> {
    const targetID = gatewayLifecycleTargetID(record);
    const existing = this.sessions.get(targetID);
    if (existing) {
      return existing;
    }
    const pending = this.pendingStartTasks.get(targetID);
    if (pending) {
      return pending;
    }
    const task = (async () => {
      const hostAccess = gatewayHostAccess(record);
      const placement = gatewayPlacement(record);
      const sshPassword = await this.gatewaySSHPassword(record);
      const runtimeBinaryPath = await this.ensureRuntimeReady(record, hostAccess, placement, sshPassword, options.signal, {
        onProgress: options.onProgress,
      });
      return this.openBridgeSession(record, runtimeBinaryPath, options);
    })().finally(() => {
      if (this.pendingStartTasks.get(targetID) === task) {
        this.pendingStartTasks.delete(targetID);
      }
    });
    this.pendingStartTasks.set(targetID, task);
    return task;
  }

  private async openBridgeSession(
    record: GatewayRecord,
    runtimeBinaryPath: string,
    options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink }> = {},
  ): Promise<GatewayLifecycleSession> {
    const targetID = gatewayLifecycleTargetID(record);
    const existing = this.sessions.get(targetID);
    if (existing) {
      return existing;
    }
    const hostAccess = gatewayHostAccess(record);
    const placement = gatewayPlacement(record);
    const sshPassword = await this.gatewaySSHPassword(record);
    this.emit(options.onProgress, 'opening_bridge', 'Opening Gateway bridge', 'Desktop is opening the Gateway protocol stream through the existing runtime placement bridge.');
    let bridgeSession: RuntimePlacementBridgeSession;
    try {
      bridgeSession = await startRuntimePlacementBridgeSession({
        host_access: hostAccess,
        placement,
        runtime_binary_path: runtimeBinaryPath,
        desktop_owner_id: await this.options.desktop_owner_id(),
        ssh_password: sshPassword,
        fallback_local_id: record.gateway_id,
        signal: options.signal,
      });
    } catch (error) {
      throw new GatewayRuntimeUnavailableError(
        'gateway_bridge_unavailable',
        error instanceof Error ? error.message : String(error),
      );
    }
    const session: GatewayLifecycleSession = {
      target_id: targetID,
      route_id: gatewayEnvAppBridgeRouteID(record),
      bridge_session: bridgeSession,
      client: new GatewayBridgeClient(this.options.secret_store, bridgeSession),
    };
    this.sessions.set(targetID, session);
    this.emit(options.onProgress, 'gateway_ready', 'Gateway ready', 'Desktop can now use Gateway protocol for catalog and open-session.');
    return session;
  }

  private async ensureRuntimeReady(
    record: GatewayRecord,
    hostAccess: DesktopRuntimeHostAccess,
    placement: DesktopRuntimePlacement,
    sshPassword: string,
    signal?: AbortSignal,
    options: Readonly<{ forceRuntimeUpdate?: boolean; onProgress?: GatewayLifecycleProgressSink }> = {},
  ): Promise<string> {
    if (record.connection.kind === 'ssh_host') {
      this.emit(options.onProgress, 'checking_host', 'Checking SSH Gateway host', 'Desktop is checking the SSH host and installing the Gateway runtime when needed.');
      const target = gatewaySSHDetails(record);
      try {
        await ensureManagedSSHRuntimeReady({
          target,
          runtimeStateRoot: gatewayRuntimeStateRoot(record),
          runtimeReleaseTag: this.options.runtime_release_tag,
          tempRoot: this.options.temp_root,
          assetCacheRoot: this.options.asset_cache_root,
          sourceRuntimeRoot: this.options.source_runtime_root,
          sshPassword,
          forceRuntimeUpdate: options.forceRuntimeUpdate === true,
          desktopOwnerID: await this.options.desktop_owner_id(),
          signal,
        });
      } catch (error) {
        throw new GatewayRuntimeUnavailableError(
          'gateway_runtime_start_failed',
          error instanceof Error ? error.message : String(error),
        );
      }
      return gatewayManagedSSHRuntimeBinaryPath(target);
    }
    this.emit(options.onProgress, 'checking_container', 'Checking Gateway container', 'Desktop is checking the selected running container through the SSH host.');
    let ready;
    try {
      ready = await ensureRuntimePlacementReady({
        host_access: hostAccess,
        placement,
        ssh_password: sshPassword,
        runtime_release_tag: this.options.runtime_release_tag,
        release_base_url: this.options.release_base_url,
        source_runtime_root: this.options.source_runtime_root,
        asset_cache_root: this.options.asset_cache_root,
        force_runtime_update: options.forceRuntimeUpdate === true,
        timeout_ms: 45_000,
        desktop_owner_id: await this.options.desktop_owner_id(),
        signal,
        on_progress: (progress) => {
          const phase = progress.phase === 'checking_container'
            ? 'checking_container'
            : progress.phase === 'preparing_runtime_package'
              ? 'preparing_runtime_package'
              : progress.phase === 'installing_runtime'
                ? 'installing_runtime'
                : progress.phase === 'starting_runtime_daemon' || progress.phase === 'waiting_runtime_daemon'
                  ? 'starting_runtime'
                  : 'checking_container';
          this.emit(options.onProgress, phase, progress.title, progress.detail);
        },
      });
    } catch (error) {
      throw new GatewayRuntimeUnavailableError(
        'gateway_container_unavailable',
        error instanceof Error ? error.message : String(error),
      );
    }
    return ready.runtime_binary_path;
  }

  private async gatewaySSHPassword(record: GatewayRecord): Promise<string> {
    const ref = gatewayRecordSSHPasswordRef(record);
    if (!ref) {
      return '';
    }
    return this.options.secret_store.readSecret(ref);
  }

  private emit(
    sink: GatewayLifecycleProgressSink | undefined,
    phase: GatewayRuntimeLifecycleProgress['phase'],
    title: string,
    detail: string,
  ): void {
    (sink ?? this.options.on_progress)?.({ phase, title, detail });
  }

  private async assertSSHGatewayStopped(
    record: GatewayRecord,
    sshPassword: string,
    options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink }> = {},
  ): Promise<void> {
    this.emit(options.onProgress, 'verifying_runtime_stopped', 'Verifying Gateway stopped', 'Desktop is confirming that the Gateway runtime has stopped.');
    const probe = await probeManagedSSHRuntimeStatus({
      target: gatewaySSHDetails(record),
      runtimeReleaseTag: this.options.runtime_release_tag,
      runtimeStateRoot: gatewayRuntimeStateRoot(record),
      sshPassword,
      tempRoot: this.options.temp_root,
      connectTimeoutSeconds: record.connection.kind === 'ssh_host'
        ? record.connection.connect_timeout_seconds
        : undefined,
      signal: options.signal,
    });
    if (probe.status === 'ready') {
      throw new Error('Desktop could not stop the Gateway Runtime because it still reports a ready daemon.');
    }
  }

  private async stopContainerGateway(
    record: GatewayRecord,
    sshPassword: string,
    options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink }> = {},
  ): Promise<void> {
    if (record.connection.kind !== 'ssh_container') {
      return;
    }
    this.emit(options.onProgress, 'checking_container', 'Checking Gateway container', 'Desktop is checking the selected container before stopping the Gateway runtime.');
    const hostAccess = gatewayHostAccess(record) as Extract<DesktopRuntimeHostAccess, Readonly<{ kind: 'ssh_host' }>>;
    const placement = gatewayPlacement(record) as Extract<DesktopRuntimePlacement, Readonly<{ kind: 'container_process' }>>;
    const executor = createSSHRuntimeHostExecutor(hostAccess.ssh, { sshPassword });
    const runtimeBinaryPath = gatewayContainerRuntimeBinaryPath(placement.runtime_root);
    this.emit(options.onProgress, 'stopping_runtime', 'Stopping Gateway runtime', 'Desktop is stopping the Gateway runtime process in the selected container.');
    await executor.run(containerRuntimeDaemonStopCommand({
      engine: placement.container_engine,
      container_id: placement.container_id,
      runtime_root: placement.runtime_root,
      runtime_state_root: gatewayRuntimeStateRoot(record),
      runtime_binary_path: runtimeBinaryPath,
    }), { signal: options.signal });
    this.emit(options.onProgress, 'verifying_runtime_stopped', 'Verifying Gateway stopped', 'Desktop is confirming that the Gateway runtime has stopped.');
    const statusResult = await executor.run(containerRuntimeDaemonStatusCommand({
      engine: placement.container_engine,
      container_id: placement.container_id,
      runtime_root: placement.runtime_root,
      runtime_state_root: gatewayRuntimeStateRoot(record),
      runtime_binary_path: runtimeBinaryPath,
    }), { signal: options.signal });
    const report = parseLaunchReport(statusResult.stdout);
    if (report.status !== 'blocked') {
      throw new Error('Desktop could not stop the Gateway Runtime because it still reports a ready daemon.');
    }
  }
}

export function gatewayRuntimeTargetDescriptor(record: GatewayRecord): GatewayRuntimeTargetDescriptor {
  return {
    target_id: gatewayLifecycleTargetID(record),
    host_access: gatewayHostAccess(record),
    placement: gatewayPlacement(record),
    runtime_state_root: gatewayRuntimeStateRoot(record),
  };
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
      runtime_state_root: gatewayRuntimeStateRoot(record),
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
      runtime_state_root: gatewayRuntimeStateRoot(record),
      bridge_strategy: 'exec_stream',
    };
  }
  throw new Error('URL Gateways do not use runtime placement.');
}

function gatewayRuntimeStateRoot(record: GatewayRecord): string {
  if (record.connection.kind === 'url') {
    throw new Error('URL Gateways do not use runtime state roots.');
  }
  return desktopSSHRuntimeRootSubpath(
    record.connection.runtime_root,
    DEFAULT_DESKTOP_SSH_GATEWAY_PROFILE_DIR,
    record.gateway_id,
  );
}

function gatewayLifecycleTargetID(record: GatewayRecord): string {
  if (record.connection.kind === 'url') {
    return `gateway:url:${record.gateway_id}`;
  }
  return desktopRuntimeTargetID(gatewayHostAccess(record), gatewayPlacement(record), record.gateway_id);
}

function gatewayRuntimeBinaryPath(record: GatewayRecord): string {
  if (record.connection.kind === 'ssh_host') {
    return gatewayManagedSSHRuntimeBinaryPath(gatewaySSHDetails(record));
  }
  if (record.connection.kind === 'ssh_container') {
    return gatewayContainerRuntimeBinaryPath(record.connection.runtime_root);
  }
  throw new Error('URL Gateways do not have runtime binaries.');
}

function gatewayManagedSSHRuntimeBinaryPath(target: DesktopSSHEnvironmentDetails): string {
  if (target.runtime_root === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT) {
    return DEFAULT_DESKTOP_SSH_RUNTIME_ROOT;
  }
  const runtimeRoot = target.runtime_root;
  return `${runtimeRoot.replace(/\/+$/u, '')}/runtime/managed/bin/redeven`;
}

function gatewayContainerRuntimeBinaryPath(runtimeRoot: string): string {
  const cleanRuntimeRoot = String(runtimeRoot ?? '').replace(/\/+$/u, '') || DEFAULT_DESKTOP_SSH_RUNTIME_ROOT;
  if (cleanRuntimeRoot === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT) {
    return DEFAULT_DESKTOP_SSH_RUNTIME_ROOT;
  }
  return `${cleanRuntimeRoot}/runtime/managed/bin/redeven`;
}

function notApplicableRuntimeState(): DesktopGatewayRuntimeState {
  return {
    status: 'not_applicable',
    can_start: false,
    can_stop: false,
    can_restart: false,
    can_update: false,
    can_pair_after_start: false,
  };
}

function manageableRuntimeState(
  record: GatewayRecord,
  status: DesktopGatewayRuntimeState['status'],
  options: Readonly<{
    runtimeTargetID: string;
    runtimeStateRoot: string;
    message?: string;
  }>,
): DesktopGatewayRuntimeState {
  const canStart = status === 'not_started';
  const isReady = status === 'ready';
  return {
    status,
    can_start: canStart,
    can_stop: isReady,
    can_restart: isReady || status === 'runtime_needs_update',
    can_update: record.connection.kind !== 'url' && (isReady || status === 'runtime_needs_update'),
    can_pair_after_start: record.connection.kind !== 'url' && status !== 'ssh_unreachable' && status !== 'container_unavailable',
    runtime_target_id: options.runtimeTargetID,
    runtime_state_root: options.runtimeStateRoot,
    ...(options.message ? { message: options.message } : {}),
    checked_at_unix_ms: Date.now(),
  };
}
