import type {
  RuntimeServiceBindingState,
  RuntimeServiceCompatibility,
  RuntimeServiceOpenReadiness,
  RuntimeServiceOwner,
  RuntimeServiceProviderLinkBinding,
  RuntimeServiceProviderLinkState,
  RuntimeServiceSnapshot,
  SysMaintenanceSnapshot,
  SysPingResponse,
  SysRestartResponse,
  SysUpgradeRequest,
  SysUpgradeResponse,
} from '../sdk/sys';
import type { wire_sys_ping_resp, wire_sys_restart_req, wire_sys_restart_resp, wire_sys_upgrade_req, wire_sys_upgrade_resp } from '../wire/sys';

function fromWireSysMaintenanceSnapshot(resp: wire_sys_ping_resp['maintenance']): SysMaintenanceSnapshot | undefined {
  if (!resp) return undefined;
  return {
    kind: resp?.kind === 'upgrade' || resp?.kind === 'restart' ? resp.kind : undefined,
    state: resp?.state === 'running' || resp?.state === 'failed' ? resp.state : undefined,
    targetVersion: resp?.target_version ? String(resp.target_version) : undefined,
    message: resp?.message ? String(resp.message) : undefined,
    startedAtMs: typeof resp?.started_at_ms === 'number' ? Number(resp.started_at_ms) : undefined,
    updatedAtMs: typeof resp?.updated_at_ms === 'number' ? Number(resp.updated_at_ms) : undefined,
  };
}

function normalizeRuntimeServiceOwner(value: unknown, desktopManaged: boolean): RuntimeServiceOwner {
  const owner = String(value ?? '').trim();
  if (owner === 'desktop' || owner === 'external' || owner === 'unknown') return owner;
  return desktopManaged ? 'desktop' : 'unknown';
}

function normalizeRuntimeServiceCompatibility(value: unknown): RuntimeServiceCompatibility {
  const compatibility = String(value ?? '').trim();
  switch (compatibility) {
    case 'compatible':
    case 'update_available':
    case 'restart_recommended':
    case 'update_required':
    case 'desktop_update_required':
    case 'managed_elsewhere':
    case 'unknown':
      return compatibility;
    default:
      return 'unknown';
  }
}

function normalizeCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.floor(count));
}

function normalizeRuntimeServiceBindingState(value: unknown, supported: boolean): RuntimeServiceBindingState {
  if (!supported) return 'unsupported';
  const state = String(value ?? '').trim();
  switch (state) {
    case 'unbound':
    case 'bound':
    case 'error':
    case 'expired':
      return state;
    default:
      return 'unbound';
  }
}

function normalizeRuntimeServiceProviderLinkState(value: unknown, supported: boolean): RuntimeServiceProviderLinkState {
  if (!supported) return 'unsupported';
  const state = String(value ?? '').trim();
  switch (state) {
    case 'unbound':
    case 'linking':
    case 'linked':
    case 'disconnecting':
    case 'error':
      return state;
    default:
      return 'unbound';
  }
}

function compactStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = Array.from(new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))).sort();
  return out.length > 0 ? out : undefined;
}

function fromWireRuntimeServiceOpenReadiness(value: unknown): RuntimeServiceOpenReadiness | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as { state?: unknown; reason_code?: unknown; message?: unknown };
  const state = String(record.state ?? '').trim();
  if (state !== 'starting' && state !== 'openable' && state !== 'blocked') return undefined;
  if (state === 'openable') return { state };
  return {
    state,
    reasonCode: String(record.reason_code ?? '').trim() || undefined,
    message: String(record.message ?? '').trim() || undefined,
  };
}

function fromWireRuntimeServiceProviderLinkBinding(
  value: wire_sys_ping_resp['runtime_service'] extends infer RuntimeService
    ? RuntimeService extends { bindings?: infer Bindings }
      ? Bindings extends { provider_link?: infer ProviderLink }
        ? ProviderLink
        : unknown
      : unknown
    : unknown,
  supported: boolean,
): RuntimeServiceProviderLinkBinding {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const state = normalizeRuntimeServiceProviderLinkState(record.state, supported);
  return {
    state,
    providerOrigin: String(record.provider_origin ?? '').trim() || undefined,
    providerId: String(record.provider_id ?? '').trim() || undefined,
    envPublicId: String(record.env_public_id ?? '').trim() || undefined,
    localEnvironmentPublicId: String(record.local_environment_public_id ?? '').trim() || undefined,
    bindingGeneration: normalizeCount(record.binding_generation) || undefined,
    remoteEnabled: state === 'linked',
    lastConnectedAtUnixMs: normalizeCount(record.last_connected_at_unix_ms) || undefined,
    lastDisconnectedAtUnixMs: normalizeCount(record.last_disconnected_at_unix_ms) || undefined,
    lastErrorCode: String(record.last_error_code ?? '').trim() || undefined,
    lastErrorMessage: String(record.last_error_message ?? '').trim() || undefined,
  };
}

function fromWireRuntimeServiceSnapshot(resp: wire_sys_ping_resp['runtime_service']): RuntimeServiceSnapshot | undefined {
  if (!resp) return undefined;
  const workload = resp.active_workload ?? {};
  const capabilities = resp.capabilities ?? {};
  const desktopAiBrokerCapability = capabilities.desktop_ai_broker ?? {};
  const desktopAiBrokerSupported = desktopAiBrokerCapability.supported === true;
  const providerLinkCapability = capabilities.provider_link ?? {};
  const providerLinkSupported = providerLinkCapability.supported === true;
  const bindings = resp.bindings ?? {};
  const desktopAiBrokerBinding = bindings.desktop_ai_broker ?? {};
  const providerLinkBinding = bindings.provider_link ?? {};
  const desktopManaged = resp.desktop_managed === true;
  return {
    runtimeVersion: resp.runtime_version ? String(resp.runtime_version) : undefined,
    runtimeCommit: resp.runtime_commit ? String(resp.runtime_commit) : undefined,
    runtimeBuildTime: resp.runtime_build_time ? String(resp.runtime_build_time) : undefined,
    protocolVersion: resp.protocol_version ? String(resp.protocol_version) : 'redeven-runtime-v1',
    compatibilityEpoch: normalizeCount(resp.compatibility_epoch) || undefined,
    serviceOwner: normalizeRuntimeServiceOwner(resp.service_owner, desktopManaged),
    desktopManaged,
    effectiveRunMode: resp.effective_run_mode ? String(resp.effective_run_mode) : undefined,
    remoteEnabled: resp.remote_enabled === true,
    compatibility: normalizeRuntimeServiceCompatibility(resp.compatibility),
    compatibilityMessage: resp.compatibility_message ? String(resp.compatibility_message) : undefined,
    minimumDesktopVersion: resp.minimum_desktop_version ? String(resp.minimum_desktop_version) : undefined,
    minimumRuntimeVersion: resp.minimum_runtime_version ? String(resp.minimum_runtime_version) : undefined,
    compatibilityReviewId: resp.compatibility_review_id ? String(resp.compatibility_review_id) : undefined,
    openReadiness: fromWireRuntimeServiceOpenReadiness(resp.open_readiness),
    activeWorkload: {
      terminalCount: normalizeCount(workload.terminal_count),
      sessionCount: normalizeCount(workload.session_count),
      taskCount: normalizeCount(workload.task_count),
      portForwardCount: normalizeCount(workload.port_forward_count),
    },
    capabilities: {
      desktopAiBroker: {
        supported: desktopAiBrokerSupported,
        bindMethod: desktopAiBrokerSupported
          ? (String(desktopAiBrokerCapability.bind_method ?? '').trim() || 'runtime_control_v1')
          : undefined,
        reasonCode: String(desktopAiBrokerCapability.reason_code ?? '').trim() || undefined,
        message: String(desktopAiBrokerCapability.message ?? '').trim() || undefined,
      },
      providerLink: {
        supported: providerLinkSupported,
        bindMethod: providerLinkSupported
          ? (String(providerLinkCapability.bind_method ?? '').trim() || 'runtime_control_v1')
          : undefined,
        reasonCode: String(providerLinkCapability.reason_code ?? '').trim() || undefined,
        message: String(providerLinkCapability.message ?? '').trim() || undefined,
      },
    },
    bindings: {
      desktopAiBroker: {
        state: normalizeRuntimeServiceBindingState(desktopAiBrokerBinding.state, desktopAiBrokerSupported),
        sessionId: String(desktopAiBrokerBinding.session_id ?? '').trim() || undefined,
        sshRuntimeKey: String(desktopAiBrokerBinding.ssh_runtime_key ?? '').trim() || undefined,
        expiresAtUnixMs: normalizeCount(desktopAiBrokerBinding.expires_at_unix_ms) || undefined,
        modelSource: String(desktopAiBrokerBinding.model_source ?? '').trim() || undefined,
        modelCount: normalizeCount(desktopAiBrokerBinding.model_count),
        missingKeyProviderIds: compactStringArray(desktopAiBrokerBinding.missing_key_provider_ids),
        lastError: String(desktopAiBrokerBinding.last_error ?? '').trim() || undefined,
      },
      providerLink: fromWireRuntimeServiceProviderLinkBinding(providerLinkBinding, providerLinkSupported),
    },
  };
}

export function fromWireSysPingResponse(resp: wire_sys_ping_resp): SysPingResponse {
  return {
    serverTimeMs: Number(resp?.server_time_ms ?? 0),
    agentInstanceId: resp?.agent_instance_id ? String(resp.agent_instance_id) : undefined,
    processStartedAtMs: typeof resp?.process_started_at_ms === 'number' ? Number(resp.process_started_at_ms) : undefined,
    version: resp?.version ? String(resp.version) : undefined,
    commit: resp?.commit ? String(resp.commit) : undefined,
    buildTime: resp?.build_time ? String(resp.build_time) : undefined,
    maintenance: fromWireSysMaintenanceSnapshot(resp?.maintenance),
    runtimeService: fromWireRuntimeServiceSnapshot(resp?.runtime_service),
  };
}

export function toWireSysUpgradeRequest(req?: SysUpgradeRequest): wire_sys_upgrade_req {
  const dryRun = req && typeof req.dryRun === 'boolean' ? req.dryRun : undefined;
  const targetVersion = req?.targetVersion ? String(req.targetVersion).trim() : '';
  return {
    dry_run: dryRun,
    target_version: targetVersion || undefined,
  };
}

export function fromWireSysUpgradeResponse(resp: wire_sys_upgrade_resp): SysUpgradeResponse {
  return {
    ok: !!resp?.ok,
    message: resp?.message ? String(resp.message) : undefined,
  };
}

export function toWireSysRestartRequest(): wire_sys_restart_req {
  return {};
}

export function fromWireSysRestartResponse(resp: wire_sys_restart_resp): SysRestartResponse {
  return {
    ok: !!resp?.ok,
    message: resp?.message ? String(resp.message) : undefined,
  };
}
