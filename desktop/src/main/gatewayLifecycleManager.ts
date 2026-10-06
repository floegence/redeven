import type { GatewayCloudConfiguration, GatewayCloudSummary } from '../shared/gatewayCloud';
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
import { GatewayClient, redactGatewayDiagnosticValue, type GatewayCatalogResponse } from './gatewayClient';
import { gatewayRecordSSHPasswordRef, type GatewayRecord } from './gatewayStore';
import type { GatewaySecretStore } from './gatewayTrust';
import type { DesktopGatewayServiceState } from '../shared/desktopGateway';
import {
  ensureManagedGatewayServiceReady,
  manageGatewayCloud,
  gatewayServiceBinaryPath,
  probeManagedGatewayServiceDeep,
  probeManagedGatewayServiceStatus,
  stopManagedGatewayService,
  type GatewayServiceDeepProbe,
  type GatewayServiceProgress,
} from './gatewayServiceHost';
import {
  RuntimeLifecycleCoordinator,
  runtimeLifecycleFingerprint,
  runtimeLifecycleTargetKey,
  type RuntimeLifecycleIntent,
} from './runtimeLifecycleCoordinator';
import type { DesktopSSHTransportManager } from './sshTransportManager';
import { DesktopOperationFailureError, desktopOperationFailurePresentation, operationFailureFromUnknown } from './desktopOperationFailure';
import type { DesktopOperationFailurePresentation } from '../shared/desktopOperationFailure';

export type GatewayLifecycleSession = Readonly<{
  target_id: string;
  bridge_session: RuntimePlacementBridgeSession;
  client: GatewayClient;
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

export class GatewayServiceUnavailableError extends DesktopOperationFailureError {
  constructor(
    readonly code:
      | 'gateway_service_unreachable'
      | 'gateway_container_unavailable'
      | 'gateway_bridge_unavailable'
      | 'gateway_service_start_failed',
    message: string,
    cause?: unknown,
  ) {
    super(redactGatewayDiagnosticValue(operationFailureFromUnknown(cause, desktopOperationFailurePresentation({
      title: 'Gateway service unavailable', summary: message,
    }))) as DesktopOperationFailurePresentation, { cause });
    this.name = 'GatewayServiceUnavailableError';
  }
}

export class GatewayReinstallRequiredError extends Error {
  readonly code = 'gateway_needs_reinstall';

  constructor(readonly service_state: DesktopGatewayServiceState, message = 'This Gateway has incompatible state and must be reinstalled.') {
    super(message);
    this.name = 'GatewayReinstallRequiredError';
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
    | 'enrolling_gateway'
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
  ssh_transport_manager: DesktopSSHTransportManager;
  secret_store: GatewaySecretStore;
  runtime_release_tag: string;
  release_base_url: string;
  asset_cache_root: string;
  temp_root: string;
  lifecycle_coordinator: RuntimeLifecycleCoordinator;
  source_runtime_root?: string;
  local_ui_bind?: string;
  target_commit?: string;
  session_cache?: Map<string, GatewayLifecycleSession>;
  signal?: AbortSignal;
  on_progress?: GatewayLifecycleProgressSink;
}>;

export class GatewayLifecycleManager {
  private readonly sessions: Map<string, GatewayLifecycleSession>;
  private readonly pendingBridgeTasks = new Map<string, Promise<GatewayLifecycleSession>>();

  constructor(private readonly options: GatewayLifecycleManagerOptions) {
    this.sessions = options.session_cache ?? new Map();
  }

  activeLifecycle(record: GatewayRecord) {
    if (record.connection.kind === 'url') {
      return null;
    }
    return this.options.lifecycle_coordinator.active(gatewayLifecycleCoordinatorTargetKey(record));
  }

  lifecycleFingerprint(record: GatewayRecord, intent: RuntimeLifecycleIntent): string {
    return runtimeLifecycleFingerprint({
      intent,
      gateway_id: record.gateway_id,
      connection: record.connection,
      runtime_release_tag: this.options.runtime_release_tag,
      target_commit: this.options.target_commit ?? '',
    });
  }

  async catalog(record: GatewayRecord, options: Readonly<{ timeoutMs?: number; signal?: AbortSignal; startPolicy?: GatewayStartPolicy; onProgress?: GatewayLifecycleProgressSink }> = {}): Promise<GatewayCatalogResponse> {
    return this.refreshCatalog(record, options);
  }

  async refreshCatalog(record: GatewayRecord, options: Readonly<{ timeoutMs?: number; signal?: AbortSignal; startPolicy?: GatewayStartPolicy; onProgress?: GatewayLifecycleProgressSink }> = {}): Promise<GatewayCatalogResponse> {
    if (record.connection.kind === 'url') {
      return new GatewayClient(this.options.secret_store).catalog(record, options);
    }
    return (await this.ensureGatewayReady(record, {
      startPolicy: options.startPolicy ?? 'require_ready',
      signal: options.signal,
      onProgress: options.onProgress,
    })).client.catalog(record, options);
  }

  async client(record: GatewayRecord, options: Readonly<{
    startPolicy?: GatewayStartPolicy;
    signal?: AbortSignal;
    onProgress?: GatewayLifecycleProgressSink;
  }> = {}): Promise<GatewayClient> {
    if (record.connection.kind === 'url') return new GatewayClient(this.options.secret_store);
    return (await this.ensureGatewayReady(record, {
      startPolicy: options.startPolicy ?? 'require_ready', signal: options.signal, onProgress: options.onProgress,
    })).client;
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
        sshTransportManager: this.options.ssh_transport_manager,
        sshCredentialScope: record.gateway_id,
        target: gatewaySSHDetails(record),
        hostAccess: gatewayHostAccess(record),
        placement: gatewayPlacement(record),
        stateRoot: gatewayServiceStateRoot(record),
        gatewayID: record.gateway_id,
        releaseTag: this.gatewayReleaseTag(),
        releaseBaseURL: this.gatewayReleaseBaseURL(record),
        assetCacheRoot: this.options.asset_cache_root,
        sourceRuntimeRoot: this.options.source_runtime_root,
        localUIBind: this.options.local_ui_bind,
        targetCommit: this.options.target_commit,
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
      if (probe.status === 'needs_reinstall') {
        return manageableServiceState(record, 'needs_reinstall', {
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
      return manageableServiceState(record, record.connection.kind === 'ssh_container' || record.connection.kind === 'local_container' ? 'container_unavailable' : record.connection.kind === 'ssh_host' ? 'ssh_unreachable' : 'error', {
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
      sshTransportManager: this.options.ssh_transport_manager,
      sshCredentialScope: record.gateway_id,
      target: gatewaySSHDetails(record),
      hostAccess: gatewayHostAccess(record),
      placement: gatewayPlacement(record),
      stateRoot: gatewayServiceStateRoot(record),
      gatewayID: record.gateway_id,
      releaseTag: this.gatewayReleaseTag(),
      releaseBaseURL: this.gatewayReleaseBaseURL(record),
      assetCacheRoot: this.options.asset_cache_root,
      sourceRuntimeRoot: this.options.source_runtime_root,
      localUIBind: this.options.local_ui_bind,
      targetCommit: this.options.target_commit,
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
    const lifecycleTargetKey = gatewayLifecycleCoordinatorTargetKey(record);
    if (this.options.lifecycle_coordinator.active(lifecycleTargetKey)) {
      await this.options.lifecycle_coordinator.waitForReadyMutation(lifecycleTargetKey);
    }
    const existing = this.sessions.get(targetID);
    if (existing) {
      return existing;
    }
    if (options.startPolicy === 'start_if_needed') {
      return this.startGateway(record, options);
    }
    const serviceState = await this.inspectService(record, options.signal);
    if (serviceState.status === 'needs_reinstall') {
      throw new GatewayReinstallRequiredError(serviceState, serviceState.message);
    }
    if (serviceState.status === 'ready') {
      return this.openBridgeSession(record, this.gatewayExecutablePath(record), {
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

  async startGateway(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink; operationKey?: string }> = {}): Promise<GatewayLifecycleSession> {
    if (record.connection.kind === 'url') {
      throw new GatewayNotManageableError();
    }
    await this.throwIfReinstallRequired(record, options.signal);
    return this.runLifecycle(record, 'start', options, (signal) => this.ensureBridgeSession(record, { ...options, signal }));
  }

  async stopGateway(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink; operationKey?: string }> = {}): Promise<void> {
    if (record.connection.kind === 'url') {
      throw new GatewayNotManageableError();
    }
    await this.throwIfReinstallRequired(record, options.signal);
    return this.runLifecycle(record, 'stop', options, (signal) => this.stopGatewayUncoordinated(record, { ...options, signal }));
  }

  async restartGateway(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink; operationKey?: string }> = {}): Promise<GatewayLifecycleSession> {
    if (record.connection.kind === 'url') {
      throw new GatewayNotManageableError();
    }
    await this.throwIfReinstallRequired(record, options.signal);
    return this.runLifecycle(record, 'restart', options, async (signal) => {
      await this.stopGatewayUncoordinated(record, { ...options, signal });
      return this.ensureBridgeSession(record, { ...options, signal });
    });
  }

  async updateGateway(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink; operationKey?: string }> = {}): Promise<GatewayLifecycleSession> {
    if (record.connection.kind === 'url') {
      throw new GatewayNotManageableError();
    }
    await this.throwIfReinstallRequired(record, options.signal);
    return this.runLifecycle(record, 'update', options, (signal) => this.updateGatewayUncoordinated(record, { ...options, signal }));
  }

  async installFreshGateway(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink; operationKey?: string }> = {}): Promise<void> {
    if (record.connection.kind === 'url') {
      throw new GatewayNotManageableError();
    }
    return this.runLifecycle(record, 'update', options, async (signal) => {
      await this.clear(record);
      await this.ensureServiceReady(
        record,
        gatewayPlacement(record),
        await this.gatewaySSHPassword(record),
        signal,
        { forceUpdate: true, onProgress: options.onProgress },
      );
      const state = await this.inspectService(record, signal);
      if (state.status !== 'ready') {
        throw new GatewayServiceUnavailableError(
          record.connection.kind === 'ssh_container' || record.connection.kind === 'local_container'
            ? 'gateway_container_unavailable'
            : 'gateway_service_start_failed',
          state.message ?? 'Desktop could not verify the freshly installed Gateway service.',
        );
      }
    });
  }

  private async throwIfReinstallRequired(record: GatewayRecord, signal?: AbortSignal): Promise<void> {
    const state = await this.inspectService(record, signal);
    if (state.status === 'needs_reinstall') {
      throw new GatewayReinstallRequiredError(state, state.message);
    }
  }

  async manageCloud(record: GatewayRecord, configuration?: GatewayCloudConfiguration, signal?: AbortSignal, operationKey?: string): Promise<GatewayCloudSummary> {
    if (record.connection.kind === 'url') throw new GatewayNotManageableError();
    return this.runLifecycle(record, 'start', { signal, operationKey }, async currentSignal => {
      const options = await this.serviceOptions(record, { signal: currentSignal });
      if (configuration) await this.ensureBridgeSession(record, { signal: currentSignal });
      return manageGatewayCloud(options, configuration);
    });
  }

  private async serviceOptions(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink }>) {
    return {
      sshTransportManager: this.options.ssh_transport_manager,
      sshCredentialScope: record.gateway_id,
      target: gatewaySSHDetails(record),
      hostAccess: gatewayHostAccess(record),
      placement: gatewayPlacement(record),
      stateRoot: gatewayServiceStateRoot(record),
      gatewayID: record.gateway_id,
      releaseTag: this.gatewayReleaseTag(),
      releaseBaseURL: this.gatewayReleaseBaseURL(record),
      assetCacheRoot: this.options.asset_cache_root,
      sourceRuntimeRoot: this.options.source_runtime_root,
      localUIBind: this.options.local_ui_bind,
      targetCommit: this.options.target_commit,
      sshPassword: await this.gatewaySSHPassword(record),
      tempRoot: this.options.temp_root,
      signal: options.signal,
      onProgress: options.onProgress ? (progress: GatewayServiceProgress) => this.emitFromServiceProgress(options.onProgress, progress) : undefined,
    };
  }


  private async stopGatewayUncoordinated(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink }> = {}): Promise<void> {
    await this.clear(record);
    const sshPassword = await this.gatewaySSHPassword(record);
    await stopManagedGatewayService({
      sshTransportManager: this.options.ssh_transport_manager,
      sshCredentialScope: record.gateway_id,
      target: gatewaySSHDetails(record),
      hostAccess: gatewayHostAccess(record),
      placement: gatewayPlacement(record),
      stateRoot: gatewayServiceStateRoot(record),
      releaseTag: this.gatewayReleaseTag(),
      releaseBaseURL: this.gatewayReleaseBaseURL(record),
      assetCacheRoot: this.options.asset_cache_root,
      sourceRuntimeRoot: this.options.source_runtime_root,
      localUIBind: this.options.local_ui_bind,
      targetCommit: this.options.target_commit,
      sshPassword,
      tempRoot: this.options.temp_root,
      signal: options.signal,
      onProgress: (progress) => this.emitFromServiceProgress(options.onProgress, progress),
    });
  }

  private async updateGatewayUncoordinated(record: GatewayRecord, options: Readonly<{ signal?: AbortSignal; onProgress?: GatewayLifecycleProgressSink }> = {}): Promise<GatewayLifecycleSession> {
    const placement = gatewayPlacement(record);
    const sshPassword = await this.gatewaySSHPassword(record);
    await this.clear(record);
    await stopManagedGatewayService({
      sshTransportManager: this.options.ssh_transport_manager,
      sshCredentialScope: record.gateway_id,
      target: gatewaySSHDetails(record),
      hostAccess: gatewayHostAccess(record),
      placement,
      stateRoot: gatewayServiceStateRoot(record),
      releaseTag: this.gatewayReleaseTag(),
      releaseBaseURL: this.gatewayReleaseBaseURL(record),
      assetCacheRoot: this.options.asset_cache_root,
      sourceRuntimeRoot: this.options.source_runtime_root,
      localUIBind: this.options.local_ui_bind,
      targetCommit: this.options.target_commit,
      sshPassword,
      tempRoot: this.options.temp_root,
      signal: options.signal,
      onProgress: (progress) => this.emitFromServiceProgress(options.onProgress, progress),
    });
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
    await this.pendingBridgeTasks.get(key)?.catch(() => undefined);
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
    const pending = this.pendingBridgeTasks.get(targetID);
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
      if (this.pendingBridgeTasks.get(targetID) === task) {
        this.pendingBridgeTasks.delete(targetID);
      }
    });
    this.pendingBridgeTasks.set(targetID, task);
    return task;
  }

  private runLifecycle<T>(
    record: GatewayRecord,
    intent: RuntimeLifecycleIntent,
    options: Readonly<{ operationKey?: string; signal?: AbortSignal }>,
    execute: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const targetID = gatewayLifecycleTargetID(record);
    return this.options.lifecycle_coordinator.run({
      target_key: gatewayLifecycleCoordinatorTargetKey(record),
      intent,
      fingerprint: this.lifecycleFingerprint(record, intent),
      operation_key: options.operationKey ?? targetID,
      signal: options.signal,
      execute,
    });
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
        ssh_password: sshPassword,
        ssh_credential_scope: record.gateway_id,
        ssh_transport_manager: this.options.ssh_transport_manager,
        fallback_local_id: record.gateway_id,
        signal: options.signal,
      });
    } catch (error) {
      throw new GatewayServiceUnavailableError(
        'gateway_bridge_unavailable',
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
    const session: GatewayLifecycleSession = {
      target_id: targetID,
      bridge_session: bridgeSession,
      client: new GatewayClient(this.options.secret_store, bridgeSession),
    };
    this.sessions.set(targetID, session);
    void bridgeSession.closed.then(() => {
      if (this.sessions.get(targetID) === session) {
        this.sessions.delete(targetID);
      }
    });
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
        sshTransportManager: this.options.ssh_transport_manager,
        sshCredentialScope: record.gateway_id,
        target: gatewaySSHDetails(record),
        hostAccess: gatewayHostAccess(record),
        placement,
        stateRoot: gatewayServiceStateRoot(record),
        gatewayID: record.gateway_id,
        releaseTag: this.gatewayReleaseTag(),
        releaseBaseURL: this.gatewayReleaseBaseURL(record),
        assetCacheRoot: this.options.asset_cache_root,
        // A development Desktop may not have a published Gateway artifact for the
        // remote platform. Keep the source tree available so a missing or stale
        // managed Gateway can be built locally; the service host only uses it when
        // the package probe requires installation or forceUpdate is requested.
        sourceRuntimeRoot: this.options.source_runtime_root,
        localUIBind: this.options.local_ui_bind,
        targetCommit: this.options.target_commit,
        sshPassword,
        tempRoot: this.options.temp_root,
        forceUpdate: options.forceUpdate === true,
        signal,
        onProgress: (progress) => this.emitFromServiceProgress(options.onProgress, progress),
      });
    } catch (error) {
      throw new GatewayServiceUnavailableError(
        record.connection.kind === 'ssh_container' || record.connection.kind === 'local_container'
          ? 'gateway_container_unavailable'
          : 'gateway_service_start_failed',
        error instanceof Error ? error.message : String(error),
        error,
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

  private gatewayExecutablePath(record: GatewayRecord): string {
    return gatewayServiceBinaryPath(gatewayServiceStateRoot(record));
  }

  private gatewayReleaseBaseURL(record: GatewayRecord): string {
    return record.connection.kind === 'ssh_host'
      ? record.connection.release_base_url || this.options.release_base_url
      : this.options.release_base_url;
  }

  private gatewayReleaseTag(): string {
    return this.options.runtime_release_tag;
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

function gatewaySSHDetails(record: GatewayRecord): DesktopSSHEnvironmentDetails | undefined {
  const connection = record.connection;
  if (connection.kind === 'url' || connection.kind === 'local_host' || connection.kind === 'local_container') {
    return undefined;
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
  if (record.connection.kind === 'local_host' || record.connection.kind === 'local_container') {
    return { kind: 'local_host' };
  }
  const ssh = gatewaySSHDetails(record);
  if (!ssh) {
    throw new Error('URL Gateways do not use runtime host access.');
  }
  return {
    kind: 'ssh_host',
    ssh,
  };
}

function gatewayPlacement(record: GatewayRecord): DesktopRuntimePlacement {
  if (record.connection.kind === 'ssh_host' || record.connection.kind === 'local_host') {
    return {
      kind: 'host_process',
      runtime_root: record.connection.runtime_root,
      runtime_state_root: gatewayServiceStateRoot(record),
      bootstrap_strategy: record.connection.kind === 'ssh_host'
        ? record.connection.bootstrap_strategy ?? DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY
        : DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
      release_base_url: record.connection.kind === 'ssh_host'
        ? record.connection.release_base_url ?? DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL
        : DEFAULT_DESKTOP_SSH_RELEASE_BASE_URL,
    };
  }
  if (record.connection.kind === 'ssh_container' || record.connection.kind === 'local_container') {
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

function gatewayLifecycleCoordinatorTargetKey(record: GatewayRecord): string {
  return runtimeLifecycleTargetKey(gatewayHostAccess(record), gatewayPlacement(record));
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
