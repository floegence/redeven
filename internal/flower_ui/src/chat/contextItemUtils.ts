/**
 * Shared utilities for formatting context item display text.
 * Used by both turn launcher copy and chat context model.
 */

export function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function basenameFromPath(path: string, fallback: string): string {
  const normalized = compact(path).replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized || fallback;
}

export function truncatePath(path: string, maxSegments = 3): string {
  const normalized = compact(path).replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= maxSegments) return normalized;
  return `.../${segments.slice(-maxSegments).join('/')}`;
}

export function formatBytes(bytes: number): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const rounded = index === 0 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[index]}`;
}

export type ProcessItem = Readonly<{
  pid: unknown;
  name: unknown;
  username: unknown;
  cpu_percent: unknown;
  memory_bytes: unknown;
  platform?: unknown;
  captured_at_ms?: unknown;
}>;

export function processLabel(item: ProcessItem): string {
  const pid = Math.trunc(Number(item.pid ?? 0));
  const name = compact(item.name) || `[${pid}]`;
  return `${name} (PID ${pid})`;
}

export function processSnapshotText(item: ProcessItem): string {
  const lines = [
    `PID: ${Math.trunc(Number(item.pid ?? 0))}`,
    `Name: ${compact(item.name) || `[${Math.trunc(Number(item.pid ?? 0))}]`}`,
    `User: ${compact(item.username) || 'system'}`,
    `CPU: ${Number(item.cpu_percent ?? 0).toFixed(1)}%`,
    `Memory: ${formatBytes(Number(item.memory_bytes ?? 0))} (${Math.max(0, Math.round(Number(item.memory_bytes ?? 0)))} bytes)`,
  ];
  if (compact(item.platform)) {
    lines.push(`Platform: ${compact(item.platform)}`);
  }
  const capturedAtMs = Number(item.captured_at_ms ?? 0);
  if (capturedAtMs > 0) {
    lines.push(`Captured at: ${new Date(capturedAtMs).toLocaleString()}`);
  }
  return lines.join('\n');
}
