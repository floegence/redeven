import type { SysMonitorProcessInfo, SysMonitorSnapshot } from '../protocol/redeven_v1';
import type { AskFlowerContextItem, AskFlowerIntent } from '../pages/askFlowerIntent';
import { attachAskFlowerContextAction } from '../contextActions/askFlower';
import { createClientId } from './clientId';

type ProcessSnapshotContextItem = Extract<AskFlowerContextItem, { kind: 'process_snapshot' }>;

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
    cpuPercent: Number(proc?.cpuPercent ?? 0),
    memoryBytes: Math.max(0, Number(proc?.memoryBytes ?? 0)),
    platform: String(snapshot?.platform ?? '').trim() || undefined,
    capturedAtMs: Number(snapshot?.timestampMs ?? 0) > 0 ? Number(snapshot?.timestampMs ?? 0) : undefined,
  };
}

export function buildMonitorProcessSnapshotText(item: ProcessSnapshotContextItem): string {
  const lines = [
    `PID: ${item.pid}`,
    `Name: ${normalizedProcessName(item.pid, item.name)}`,
    `User: ${String(item.username ?? '').trim() || 'system'}`,
    `CPU: ${Number(item.cpuPercent ?? 0).toFixed(1)}%`,
    `Memory: ${formatMonitorProcessBytes(item.memoryBytes)} (${Math.max(0, Math.round(Number(item.memoryBytes ?? 0)))} bytes)`,
  ];

  const platform = String(item.platform ?? '').trim();
  if (platform) {
    lines.push(`Platform: ${platform}`);
  }

  const capturedAtMs = Number(item.capturedAtMs ?? 0);
  if (capturedAtMs > 0) {
    lines.push(`Captured at: ${new Date(capturedAtMs).toLocaleString()}`);
  }

  return lines.join('\n');
}

export function buildMonitorProcessAskFlowerIntent(params: {
  process: SysMonitorProcessInfo;
  snapshot?: Pick<SysMonitorSnapshot, 'platform' | 'timestampMs'> | null;
}): AskFlowerIntent {
  return attachAskFlowerContextAction({
    id: createClientId('ask-flower'),
    source: 'monitoring',
    mode: 'append',
    contextItems: [
      buildMonitorProcessSnapshotContextItem(params),
    ],
    pendingAttachments: [],
    notes: [],
  });
}

export function monitorProcessDisplayLabel(params: { pid: number; name: string }): string {
  const pid = Math.trunc(Number(params.pid ?? 0));
  return `${normalizedProcessName(pid, params.name)} (PID ${pid})`;
}
