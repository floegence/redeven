export const HOST_APPLICATION_COMPONENTS_CHANNEL = 'redeven-desktop:host-application-components';
export const HOST_APPLICATION_COMPONENTS_PROGRESS = 'redeven-desktop:host-application-components-progress';
export type HostApplicationTransferPlan = Readonly<{
  package_digest: string;
  architecture: 'amd64' | 'arm64';
  missing_artifacts: readonly string[];
  missing_bytes: number;
}>;
export type HostApplicationComponentsRequest =
  | { action: 'capabilities' }
  | { action: 'acquire'; architecture: 'amd64' | 'arm64'; plan?: HostApplicationTransferPlan }
  | { action: 'read'; offset: number }
  | { action: 'cancel' };
export type HostApplicationComponentsResult = { ok: boolean; size?: number; data?: Uint8Array; supports_transfer_plan?: boolean; supports_cache_progress?: boolean; error?: 'target_mismatch' | 'acquisition_failed' };
export type HostApplicationComponentsProgress = Readonly<{
  phase: 'waiting' | 'checking' | 'downloading' | 'packing';
  component_bytes: number;
  downloaded_bytes: number;
  cached_bytes?: number;
  download_bytes?: number;
}>;

export function parseHostApplicationComponentsProgress(value: unknown): HostApplicationComponentsProgress | undefined {
  if (!value || typeof value !== 'object') return;
  const p = value as HostApplicationComponentsProgress;
  const bytes = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) >= 0 && Number(n) <= 2 ** 31;
  if (!['waiting', 'checking', 'downloading', 'packing'].includes(p.phase) || !bytes(p.component_bytes) || !bytes(p.downloaded_bytes)) return;
  if (p.phase === 'waiting' || p.phase === 'checking') {
    if (p.cached_bytes !== undefined || p.download_bytes !== undefined || p.downloaded_bytes !== 0) return;
    return { phase: p.phase, component_bytes: p.component_bytes, downloaded_bytes: 0 };
  }
  if (!bytes(p.cached_bytes) || !bytes(p.download_bytes) || p.cached_bytes + p.download_bytes !== p.component_bytes || p.downloaded_bytes > p.download_bytes) return;
  if (p.phase === 'packing' && p.downloaded_bytes !== p.download_bytes) return;
  return { phase: p.phase, component_bytes: p.component_bytes, cached_bytes: p.cached_bytes, download_bytes: p.download_bytes, downloaded_bytes: p.downloaded_bytes };
}

export function isHostApplicationTransferPlan(value: unknown): value is HostApplicationTransferPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as HostApplicationTransferPlan;
  return typeof plan.package_digest === 'string' && /^[a-f0-9]{64}$/u.test(plan.package_digest) && ['amd64', 'arm64'].includes(plan.architecture)
    && Number.isSafeInteger(plan.missing_bytes) && plan.missing_bytes >= 0 && plan.missing_bytes <= 2 ** 31
    && Array.isArray(plan.missing_artifacts) && plan.missing_artifacts.length <= 256
    && plan.missing_artifacts.every(item => typeof item === 'string' && /^[a-f0-9]{64}$/u.test(item));
}
