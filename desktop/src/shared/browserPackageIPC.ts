export const BROWSER_PACKAGE_CHANNEL = 'redeven-desktop:browser-package';
export const BROWSER_PACKAGE_PROGRESS_CHANNEL = 'redeven-desktop:browser-package-progress';
export type BrowserPackageIdentity = Readonly<{ id: string; sha256: string; size_bytes: number }>;
export type BrowserPackageProgress = Readonly<{
  operation_id: string; phase: 'checking' | 'downloading' | 'verifying'; received_bytes: number; total_bytes: number;
}>;
export type BrowserPackageRequest =
  | Readonly<{ action: 'acquire'; operation_id: string; package: BrowserPackageIdentity }>
  | Readonly<{ action: 'read'; operation_id: string; offset: number }>
  | Readonly<{ action: 'release' | 'cancel'; operation_id: string }>;
export type BrowserPackageResult = Readonly<{
  ok: boolean; error?: 'package_mismatch' | 'acquisition_failed' | 'unavailable';
  package?: BrowserPackageIdentity; from_cache?: boolean; data?: Uint8Array;
}>;
export type BrowserPackageBridge = Readonly<{
  request: (request: BrowserPackageRequest) => Promise<BrowserPackageResult>;
  subscribe: (listener: (progress: BrowserPackageProgress) => void) => () => void;
}>;

export function parseBrowserPackageRequest(value: unknown): BrowserPackageRequest | undefined {
  if (!value || typeof value !== 'object') return;
  const r = value as Record<string, unknown>;
  if (typeof r.operation_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/u.test(r.operation_id)) return;
  if (r.action === 'cancel' || r.action === 'release') {
    if (Object.keys(r).some(key => !['action', 'operation_id'].includes(key))) return;
    return { action: r.action, operation_id: r.operation_id };
  }
  if (r.action === 'read') {
    if (Object.keys(r).some(key => !['action', 'operation_id', 'offset'].includes(key))) return;
    if (!Number.isSafeInteger(r.offset) || Number(r.offset) < 0) return;
    return { action: 'read', operation_id: r.operation_id, offset: Number(r.offset) };
  }
  if (r.action !== 'acquire' || !r.package || typeof r.package !== 'object') return;
  if (Object.keys(r).some(key => !['action', 'operation_id', 'package'].includes(key))) return;
  const p = r.package as Record<string, unknown>;
  if (Object.keys(p).some(key => !['id', 'sha256', 'size_bytes'].includes(key)) || typeof p.id !== 'string'
    || !/^[a-z0-9-]{1,100}$/u.test(p.id) || typeof p.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(p.sha256)
    || !Number.isSafeInteger(p.size_bytes) || Number(p.size_bytes) <= 0 || Number(p.size_bytes) > 512 * 1024 * 1024) return;
  return { action: 'acquire', operation_id: r.operation_id, package: { id: p.id, sha256: p.sha256, size_bytes: Number(p.size_bytes) } };
}
export function parseBrowserPackageProgress(value: unknown): BrowserPackageProgress | undefined {
  if (!value || typeof value !== 'object') return;
  const p = value as BrowserPackageProgress;
  if (typeof p.operation_id !== 'string' || !['checking', 'downloading', 'verifying'].includes(p.phase)
    || !Number.isSafeInteger(p.received_bytes) || !Number.isSafeInteger(p.total_bytes)
    || p.received_bytes < 0 || p.total_bytes <= 0 || p.received_bytes > p.total_bytes) return;
  return { operation_id: p.operation_id, phase: p.phase, received_bytes: p.received_bytes, total_bytes: p.total_bytes };
}
