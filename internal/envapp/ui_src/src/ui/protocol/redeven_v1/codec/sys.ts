import type { SysPingResponse, SysRestartResponse, SysUpgradeRequest, SysUpgradeResponse } from '../sdk/sys';
import type { wire_sys_ping_resp, wire_sys_restart_req, wire_sys_restart_resp, wire_sys_upgrade_req, wire_sys_upgrade_resp } from '../wire/sys';

export function fromWireSysPingResponse(resp: wire_sys_ping_resp): SysPingResponse {
  return {
    serverTimeMs: Number(resp?.server_time_ms ?? 0),
    agentInstanceId: resp?.agent_instance_id ? String(resp.agent_instance_id) : undefined,
    version: resp?.version ? String(resp.version) : undefined,
    commit: resp?.commit ? String(resp.commit) : undefined,
    buildTime: resp?.build_time ? String(resp.build_time) : undefined,
  };
}

export function toWireSysUpgradeRequest(req?: SysUpgradeRequest): wire_sys_upgrade_req {
  const dryRun = req && typeof req.dryRun === 'boolean' ? req.dryRun : undefined;
  return {
    dry_run: dryRun,
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
