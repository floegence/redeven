import type { wire_sys_monitor_req, wire_sys_monitor_resp } from '../wire/monitor';
import type { SysMonitorRequest, SysMonitorSnapshot } from '../sdk/monitor';

export function toWireSysMonitorRequest(req: SysMonitorRequest): wire_sys_monitor_req {
  return { sort_by: req.sortBy };
}

export function fromWireSysMonitorResponse(resp: wire_sys_monitor_resp): SysMonitorSnapshot {
  const procs = Array.isArray(resp?.processes) ? resp.processes : [];
  return {
    cpuUsage: Number(resp?.cpu_usage ?? 0),
    cpuCores: Number(resp?.cpu_cores ?? 0),
    loadAverage: Array.isArray(resp?.load_average) ? resp.load_average.map((n) => Number(n)) : undefined,
    networkBytesReceived: Number(resp?.network_bytes_received ?? 0),
    networkBytesSent: Number(resp?.network_bytes_sent ?? 0),
    networkSpeedReceived: Number(resp?.network_speed_received ?? 0),
    networkSpeedSent: Number(resp?.network_speed_sent ?? 0),
    platform: String(resp?.platform ?? ''),
    processes: procs.map((p) => ({
      pid: Number(p?.pid ?? 0),
      name: String(p?.name ?? ''),
      cpuPercent: Number(p?.cpu_percent ?? 0),
      memoryBytes: Number(p?.memory_bytes ?? 0),
      username: String(p?.username ?? ''),
    })),
    timestampMs: Number(resp?.timestamp_ms ?? 0),
  };
}

