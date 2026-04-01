import type { SysMaintenanceSnapshot, SysPingResponse, SysRestartResponse, SysUpgradeRequest, SysUpgradeResponse } from '../sdk/sys';
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

export function fromWireSysPingResponse(resp: wire_sys_ping_resp): SysPingResponse {
  return {
    serverTimeMs: Number(resp?.server_time_ms ?? 0),
    agentInstanceId: resp?.agent_instance_id ? String(resp.agent_instance_id) : undefined,
    processStartedAtMs: typeof resp?.process_started_at_ms === 'number' ? Number(resp.process_started_at_ms) : undefined,
    version: resp?.version ? String(resp.version) : undefined,
    commit: resp?.commit ? String(resp.commit) : undefined,
    buildTime: resp?.build_time ? String(resp.build_time) : undefined,
    maintenance: fromWireSysMaintenanceSnapshot(resp?.maintenance),
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
