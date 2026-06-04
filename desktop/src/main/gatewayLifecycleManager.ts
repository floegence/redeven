import {
  DEFAULT_DESKTOP_SSH_AUTH_MODE,
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_CONNECT_TIMEOUT_SECONDS,
  DEFAULT_DESKTOP_SSH_GATEWAY_PROFILE_DIR,
  DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
  desktopSSHRuntimeRootSubpath,
  type DesktopSSHEnvironmentDetails,
} from '../shared/desktopSSH';
import {
  desktopRuntimeTargetID,
  type DesktopRuntimeHostAccess,
  type DesktopRuntimePlacement,
} from '../shared/desktopRuntimePlacement';
import { type RuntimePlacementBridgeSession, startRuntimePlacementBridgeSession } from './runtimePlacementBridgeSession';
import {
  GatewayBridgeClient,
  GatewayURLClient,
  type GatewayCatalogResponse,
  type GatewayEnvLifecycleRequest,
  type GatewayEnvLifecycleResponse,
  type GatewayEnvProfileDeleteRequest,
  type GatewayEnvProfileDeleteResponse,
  type GatewayEnvProfileUpsertRequest,
  type GatewayEnvProfileUpsertResponse,
  type GatewayOpenSessionRequest,
  type GatewayOpenSessionResponse,
} from './gatewayClient';
import { gatewayEnvAppBridgeRouteID } from './gatewaySessionArtifact';
import { gatewayRecordSSHPasswordRef, type GatewayRecord } from './gatewayStore';
import type { GatewaySecretStore } from './gatewayTrust';
import type { DesktopGatewayServiceState } from '../shared/desktopGateway';
import {
  ensureManagedGatewayServiceReady,
  gatewayServiceBinaryPath,
  probeManagedGatewayServiceDeep,
  probeManagedGatewayServiceStatus,
  stopManagedGatewayService,
  type GatewayServiceDeepProbe,
  type GatewayServiceProgress,
} from './gatewayServiceHost';

export type GatewayLifecycleSession = Readonly<{
  target_id: string;
  route_id: string;
  bridge_session: RuntimePlacementBridgeSession;
  client: GatewayBridgeClient;
}>;

export class GatewayServiceStartRequiredError extends Error {
  readonly service_state: DesktopGatewayServiceState;

  constructor(serviceState: DesktopGatewayServiceState, message = 'Gateway service must be started before this action can continue.') {
    super(message);
    this.name = 'GatewayServiceStartRequiredError';
    this.service_state = serviceState;
  }
}

export class GatewayNotManageableError extends Error {
  constructor(message = 'URL Gateways cannot be managed from Desktop.') {
    super(message);
    this.name = 'GatewayNotManageableError';
  }
}

export class GatewayServiceUnavailableError extends Error {
  constructor(
    readonly code:
      | 'gateway_service_unreachable'
      | 'gateway_container_unavailable'
      | 'gateway_bridge_unavailable'
      | 'gateway_service_start_failed',
    message: string,
  ) {
    super(message);
    this.name = 'GatewayServiceUnavailableError';
  }
}

export type GatewayServiceLifecycleProgress = Readonly<{
  phase:
    | 'checking_host'
    | 'checking_container'
    | 'preparing_gateway_package'
    | 'installing_gateway'
    | 'starting_gateway'
    | 'opening_bridge'
    | 'stopping_gateway'
    | 'verifying_gateway_stopped'
    | 'gateway_ready';
  title: string;
  detail: string;
}>;

export type GatewayStartPolicy = 'require_ready' | 'start_if_needed';
export type GatewayLifecycleProgressSink = (progress: GatewayServiceLifecycleProgress) => void;
export type GatewayServiceTargetDescriptor = Readonly<{
  target_id: string;
  host_access: DesktopRuntimeHostAccess;
  placement: DesktopRuntimePlacement;
  service_state_root: string;
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

  async upsertEnvironmentProfile(
    record: GatewayRecord,
    request: GatewayEnvProfileUpsertRequest,
    options: Readonly<{ timeoutMs?: number; signal?: AbortSignal; startPolicy?: GatewayStartPolicy; onProgress?: GatewayLifecycleProgressSink }> = {},
  ): Promise<GatewayEnvProfileUpsertResponse> {
    if (record.connection.kind === 'url') {
      return new GatewayURLClient(this.options.secret_store).upsertEnvironmentProfile(record, request, options);
    }
    const session = await this.ensureGatewayReady(record, {
      startPolicy: options.startPolicy ?? 'start_if_needed',
      signal: options.signal,
      onProgress: options.onProgress,
    });
    return session.client.upsertEnvironmentProfile(record, request, options);
  }

  async deleteEnvironmentProfile(
    record: GatewayRecord,
    request: GatewayEnvProfileDeleteRequest,
    options: Readonly<{ timeoutMs?: number; signal?: AbortSignal; startPolicy?: GatewayStartPolicy; onProgress?: GatewayLifecycleProgressSink }> = {},
  ): Promise<GatewayEnvProfileDeleteResponse> {
    if (record.connection.kind === 'url') {
      return new GatewayURLClient(this.options.secret_store).deleteEnvironmentProfile(record, request, options);
    }
    const session = await this.ensureGatewayReady(record, {
      startPolicy: options.startPolicy ?? 'start_if_needed',
      signal: options.signal,
      onProgress: options.onProgress,
    });
    return session.client.deleteEnvironmentProfile(record, request, options);
  }

  async runEnvironmentLifecycle(
    record: GatewayRecord,
    request: GatewayEnvLifecycleRequest,
    options: Readonly<{ timeoutMs?: number; signal?: AbortSignal; startPolicy?: GatewayStartPolicy; onProgress?: GatewayLifecycleProgressSink }> = {},
  ): Promise<GatewayEnvLifecycleResponse> {
    if (record.connection.kind === 'url') {
      return new GatewayURLClient(this.options.secret_store).runEnvironmentLifecycle(record, request, options);
    }
    const session = await this.ensureGatewayReady(record, {
      startPolicy: options.startPolicy ?? 'start_if_needed',
      signal: options.signal,
      onProgress: options.onProgress,
    });
    return session.client.runEnvironmentLifecycle(record, request, options);
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

  async inspectService(record: GatewayRecord, signal?: AbortSignal): Promise<DesktopGatewayServiceState> {
    if (record.connection.kind === 'url') {
      return notApplicableServiceState();
    }
    const targetID = gatewayLifecycleTargetID(record);
    if (this.sessions.has(targetID)) {
      return manageableServiceState(record, 'ready', {
        serviceTargetID: targetID,
        serviceStateRoot: gatewayServiceStateRoot(record),
        message: 'Gateway bridge is ready.',
      });
    }
    const sshPassword = await this.gatewaySSHPassword(record);
    try {
      const probe = await probeManagedGatewayServiceStatus({
        target: gatewaySSHDetails(record),
        placement: gatewayPlacement(record),
        stateRoot: gatewayServiceStateRoot(record),
        gatewayID: record.gateway_id,
        releaseTag: this.options.runtime_release_tag,
        releaseBaseURL: this.options.release_base_url,
        assetCacheRoot: this.options.asset_cache_root,
        sourceRuntimeRoot: this.options.source_runtime_root,
        sshPassword,
        tempRoot: this.options.temp_root,
        signal,
      });
      if (probe.status === 'running') {
        return manageableServiceState(record, 'ready', {
          serviceTargetID: targetID,
          serviceStateRoot: probe.state_root,
          message: 'Gateway service is running.',
        });
      }
      if (probe.status === 'not_running') {
        return manageableServiceState(record, 'not_started', {
          serviceTargetID: targetID,
          serviceStateRoot: probe.state_root,
          message: probe.message,
        });
      }
      if (probe.status === 'needs_update') {
        return manageableServiceState(record, 'service_needs_update', {
          serviceTargetID: targetID,
          serviceStateRoot: probe.state_root,
          message: probe.message,
        });
      }
      return manageableServiceState(record, 'error', {
        serviceTargetID: targetID,
        serviceStateRoot: probe.state_root,
        message: probe.message,
      });
    } catch (error) {
      return manageableServiceState(record, record.connection.kind === 'ssh_container' ? 'container_unavailable' : 'ssh_unreachable', {
        serviceTargetID: targetID,
        serviceStateRoot: gatewayServiceStateRoot(record),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async inspectManagedProbe(record: GatewayRecord, signal?: AbortSignal): Promise<GatewayServiceDeepProbe | undefined> {
    if (record.connection.kind === 'url') {
      return undefined;
    }
    const sshPassword = await this.gatewaySSHPassword(record);
    return probeManagedGatewayServiceDeep({
      target: gatewaySSHDetails(record),
      placement: gatewayPlacement(record),
      stateRoot: gatewayServiceStateRoot(record),
      gatewayID: record.gateway_id,
      releaseTag: this.options.runtime_release_tag,
      releaseBaseURL: this.options.release_base_url,
      assetCacheRoot: this.options.asset_cache_root,
      sourceRuntimeRoot: this.options.source_runtime_root,
      sshPassword,
      tempRoot: this.options.temp_root,
      signal,
    });
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
    const serviceState = await this.inspectService(record, options.signal);
    if (serviceState.status === 'ready') {
      return this.openBridgeSession(record, gatewayServiceBinaryPath(gatewayPlacement(record)), {
        signal: options.signal,
        onProgress: options.onProgress,
      });
    }
    if (serviceState.status === 'ssh_unreachable') {
      throw new GatewayServiceUnavailableError(
        'gateway_service_unreachable',
        serviceState.message ?? 'Gateway SSH host is unreachable.',
      );
    }
    if (serviceState.status === 'container_unavailable') {
      throw new GatewayServiceUnavailableError(
        'gateway_container_unavailable',
        serviceState.message ?? 'Gateway container is unavailable.',
      );
    }
    if (serviceState.status === 'bridge_unavailable' || serviceState.status === 'error') {
      throw new GatewayServiceUnavailableError(
        'gateway_bridge_unavailable',
        serviceState.message ?? 'Gateway bridge is unavailable.',
      );
    }
    throw new GatewayServiceStartRequiredError(serviceState);
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
    await stopManagedGatewayService({
      target: gatewaySSHDetails(record),
      placement: gatewayPlacement(record),
      stateRoot: gatewayServiceStateRoot(record),
      releaseTag: this.options.runtime_release_tag,
      releaseBaseURL: this.options.release_base_url,
      assetCacheRoot: this.options.asset_cache_root,
      sourceRuntimeRoot: this.options.source_runtime_root,
      sshPassword,
      tempRoot: this.options.temp_root,
      signal: options.signal,
      onProgress: (progress) => this.emitFromServiceProgress(options.onProgress, progress),
    });
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
    const placement = gatewayPlacement(record);
    const sshPassword = await this.gatewaySSHPassword(record);
    const gatewayBinaryPath = await this.ensureServiceReady(record, placement, sshPassword, options.signal, {
      forceUpdate: true,
      onProgress: options.onProgress,
    });
    return this.openBridgeSession(record, gatewayBinaryPath, {
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
      const placement = gatewayPlacement(record);
      const sshPassword = await this.gatewaySSHPassword(record);
      const gatewayBinaryPath = await this.ensureServiceReady(record, placement, sshPassword, options.signal, {
        onProgress: options.onProgress,
      });
      return this.openBridgeSession(record, gatewayBinaryPath, options);
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
    gatewayBinaryPath: string,
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
    this.emit(options.onProgress, 'opening_bridge', 'Opening Gateway bridge', 'Desktop is opening the Gateway protocol stream through the managed Gateway service.');
    let bridgeSession: RuntimePlacementBridgeSession;
    try {
      bridgeSession = await startRuntimePlacementBridgeSession({
        host_access: hostAccess,
        placement,
        runtime_binary_path: gatewayBinaryPath,
        bridge_command_kind: 'gateway',
        require_local_ui: false,
        desktop_owner_id: await this.options.desktop_owner_id(),
        ssh_password: sshPassword,
        fallback_local_id: record.gateway_id,
        signal: options.signal,
      });
    } catch (error) {
      throw new GatewayServiceUnavailableError(
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

  private async ensureServiceReady(
    record: GatewayRecord,
    placement: DesktopRuntimePlacement,
    sshPassword: string,
    signal?: AbortSignal,
    options: Readonly<{ forceUpdate?: boolean; onProgress?: GatewayLifecycleProgressSink }> = {},
  ): Promise<string> {
    try {
      return await ensureManagedGatewayServiceReady({
        target: gatewaySSHDetails(record),
        placement,
        stateRoot: gatewayServiceStateRoot(record),
        gatewayID: record.gateway_id,
        releaseTag: this.options.runtime_release_tag,
        releaseBaseURL: this.options.release_base_url,
        assetCacheRoot: this.options.asset_cache_root,
        sourceRuntimeRoot: this.options.source_runtime_root,
        sshPassword,
        tempRoot: this.options.temp_root,
        forceUpdate: options.forceUpdate === true,
        signal,
        onProgress: (progress) => this.emitFromServiceProgress(options.onProgress, progress),
      });
    } catch (error) {
      throw new GatewayServiceUnavailableError(
        record.connection.kind === 'ssh_container' ? 'gateway_container_unavailable' : 'gateway_service_start_failed',
        error instanceof Error ? error.message : String(error),
      );
    }
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
    phase: GatewayServiceLifecycleProgress['phase'],
    title: string,
    detail: string,
  ): void {
    (sink ?? this.options.on_progress)?.({ phase, title, detail });
  }

  private emitFromServiceProgress(
    sink: GatewayLifecycleProgressSink | undefined,
    progress: GatewayServiceProgress,
  ): void {
    this.emit(sink, progress.phase, progress.title, progress.detail);
  }
}

export function gatewayServiceTargetDescriptor(record: GatewayRecord): GatewayServiceTargetDescriptor {
  return {
    target_id: gatewayLifecycleTargetID(record),
    host_access: gatewayHostAccess(record),
    placement: gatewayPlacement(record),
    service_state_root: gatewayServiceStateRoot(record),
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
      runtime_state_root: gatewayServiceStateRoot(record),
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
      runtime_state_root: gatewayServiceStateRoot(record),
      bridge_strategy: 'exec_stream',
    };
  }
  throw new Error('URL Gateways do not use runtime placement.');
}

function gatewayServiceStateRoot(record: GatewayRecord): string {
  if (record.connection.kind === 'url') {
    throw new Error('URL Gateways do not use service state roots.');
  }
  return desktopSSHRuntimeRootSubpath(
    record.connection.runtime_root,
    DEFAULT_DESKTOP_SSH_GATEWAY_PROFILE_DIR,
    record.gateway_id,
    'state',
  );
}

function gatewayLifecycleTargetID(record: GatewayRecord): string {
  if (record.connection.kind === 'url') {
    return `gateway:url:${record.gateway_id}`;
  }
  return desktopRuntimeTargetID(gatewayHostAccess(record), gatewayPlacement(record), record.gateway_id);
}

function notApplicableServiceState(): DesktopGatewayServiceState {
  return {
    status: 'not_applicable',
    can_start: false,
    can_stop: false,
    can_restart: false,
    can_update: false,
    can_pair_after_start: false,
  };
}

function manageableServiceState(
  record: GatewayRecord,
  status: DesktopGatewayServiceState['status'],
  options: Readonly<{
    serviceTargetID: string;
    serviceStateRoot: string;
    message?: string;
  }>,
): DesktopGatewayServiceState {
  const canStart = status === 'not_started';
  const isReady = status === 'ready';
  return {
    status,
    can_start: canStart,
    can_stop: isReady,
    can_restart: isReady || status === 'service_needs_update',
    can_update: record.connection.kind !== 'url' && (isReady || status === 'service_needs_update'),
    can_pair_after_start: record.connection.kind !== 'url' && status !== 'ssh_unreachable' && status !== 'container_unavailable',
    service_target_id: options.serviceTargetID,
    service_state_root: options.serviceStateRoot,
    ...(options.message ? { message: options.message } : {}),
    checked_at_unix_ms: Date.now(),
  };
}
