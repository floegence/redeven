import type { RuntimeServiceCompatibility, RuntimeServiceOwner, RuntimeServiceSnapshot, SysMaintenanceSnapshot, SysPingResponse, SysRestartResponse, SysUpgradeRequest, SysUpgradeResponse } from '../sdk/sys';
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

function fromWireRuntimeServiceSnapshot(resp: wire_sys_ping_resp['runtime_service']): RuntimeServiceSnapshot | undefined {
  if (!resp) return undefined;
  const workload = resp.active_workload ?? {};
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
    activeWorkload: {
      terminalCount: normalizeCount(workload.terminal_count),
      sessionCount: normalizeCount(workload.session_count),
      taskCount: normalizeCount(workload.task_count),
      portForwardCount: normalizeCount(workload.port_forward_count),
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
