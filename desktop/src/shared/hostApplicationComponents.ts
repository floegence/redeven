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
export type HostApplicationComponentsResult = { ok: boolean; size?: number; data?: Uint8Array; supports_transfer_plan?: boolean; error?: 'target_mismatch' | 'acquisition_failed' };
export type HostApplicationComponentsProgress = { received_bytes: number; expected_bytes: number };

export function isHostApplicationTransferPlan(value: unknown): value is HostApplicationTransferPlan {
  if (!value || typeof value !== 'object') return false;
  const plan = value as HostApplicationTransferPlan;
  return typeof plan.package_digest === 'string' && /^[a-f0-9]{64}$/u.test(plan.package_digest) && ['amd64', 'arm64'].includes(plan.architecture)
    && Number.isSafeInteger(plan.missing_bytes) && plan.missing_bytes >= 0 && plan.missing_bytes <= 2 ** 31
    && Array.isArray(plan.missing_artifacts) && plan.missing_artifacts.length <= 256
    && plan.missing_artifacts.every(item => typeof item === 'string' && /^[a-f0-9]{64}$/u.test(item));
}
