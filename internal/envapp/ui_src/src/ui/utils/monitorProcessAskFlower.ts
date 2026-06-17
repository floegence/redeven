import type { SysMonitorProcessInfo, SysMonitorSnapshot } from '../protocol/redeven_v1';
import type { FlowerTurnLauncherContextItem, FlowerTurnLauncherIntent } from '../../../../../flower_ui/src';
import { attachAskFlowerContextAction, type EnvFlowerTurnLauncherIntent } from '../contextActions/askFlower';
import { createClientId } from './clientId';

type ProcessSnapshotContextItem = Extract<FlowerTurnLauncherContextItem, { kind: 'process_snapshot' }>;

function normalizedProcessName(pid: number, name: string): string {
  const trimmed = String(name ?? '').trim();
  if (trimmed) return trimmed;
  return `[${Math.trunc(Number(pid) || 0)}]`;
}

export function formatMonitorProcessBytes(bytes: number): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }

  const rounded = idx === 0 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[idx]}`;
}

export function buildMonitorProcessSnapshotContextItem(params: {
  process: SysMonitorProcessInfo;
  snapshot?: Pick<SysMonitorSnapshot, 'platform' | 'timestampMs'> | null;
}): ProcessSnapshotContextItem {
  const proc = params.process;
  const snapshot = params.snapshot;
  return {
    kind: 'process_snapshot',
    pid: Math.trunc(Number(proc?.pid ?? 0)),
    name: normalizedProcessName(Number(proc?.pid ?? 0), String(proc?.name ?? '')),
    username: String(proc?.username ?? '').trim() || 'system',
    cpu_percent: Number(proc?.cpuPercent ?? 0),
    memory_bytes: Math.max(0, Number(proc?.memoryBytes ?? 0)),
    platform: String(snapshot?.platform ?? '').trim() || undefined,
    captured_at_ms: Number(snapshot?.timestampMs ?? 0) > 0 ? Number(snapshot?.timestampMs ?? 0) : undefined,
  };
}

export function buildMonitorProcessSnapshotText(item: ProcessSnapshotContextItem): string {
  const lines = [
    `PID: ${item.pid}`,
    `Name: ${normalizedProcessName(item.pid, item.name)}`,
    `User: ${String(item.username ?? '').trim() || 'system'}`,
    `CPU: ${Number(item.cpu_percent ?? 0).toFixed(1)}%`,
    `Memory: ${formatMonitorProcessBytes(item.memory_bytes)} (${Math.max(0, Math.round(Number(item.memory_bytes ?? 0)))} bytes)`,
  ];

  const platform = String(item.platform ?? '').trim();
  if (platform) {
    lines.push(`Platform: ${platform}`);
  }

  const capturedAtMs = Number(item.captured_at_ms ?? 0);
  if (capturedAtMs > 0) {
    lines.push(`Captured at: ${new Date(capturedAtMs).toLocaleString()}`);
  }

  return lines.join('\n');
}

export function buildMonitorProcessFlowerTurnLauncherIntent(params: {
  process: SysMonitorProcessInfo;
  snapshot?: Pick<SysMonitorSnapshot, 'platform' | 'timestampMs'> | null;
}): FlowerTurnLauncherIntent {
  const intent: EnvFlowerTurnLauncherIntent = {
    id: createClientId('ask-flower'),
    source_surface: 'monitoring',
    context_items: [
      buildMonitorProcessSnapshotContextItem(params),
    ],
    pending_attachments: [],
    notes: [],
  };
  return attachAskFlowerContextAction(intent);
}

export function monitorProcessDisplayLabel(params: { pid: number; name: string }): string {
  const pid = Math.trunc(Number(params.pid ?? 0));
  return `${normalizedProcessName(pid, params.name)} (PID ${pid})`;
}
