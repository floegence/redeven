import { normalizeControlPlaneOrigin } from './controlPlaneProvider';

const REDEVEN_CLOUD_PUBLIC_DOMAIN_PARTS = ['redeven', 'com'] as const;
const REDEVEN_CLOUD_PUBLIC_DOMAIN = REDEVEN_CLOUD_PUBLIC_DOMAIN_PARTS.join('.');

export const REDEVEN_CLOUD_ORIGIN = `https://${REDEVEN_CLOUD_PUBLIC_DOMAIN}`;
export const REDEVEN_CLOUD_DEVELOPMENT_ORIGIN = 'https://redeven.test';

export type RedevenCloudOriginPolicy = Readonly<{
  allow_development: boolean;
}>;

export function redevenCloudAllowedOrigins(
  policy: RedevenCloudOriginPolicy,
): readonly string[] {
  return policy.allow_development
    ? [REDEVEN_CLOUD_ORIGIN, REDEVEN_CLOUD_DEVELOPMENT_ORIGIN]
    : [REDEVEN_CLOUD_ORIGIN];
}

export function isRedevenCloudOrigin(
  rawOrigin: string,
  policy: RedevenCloudOriginPolicy = { allow_development: false },
): boolean {
  try {
    const normalized = normalizeControlPlaneOrigin(rawOrigin);
    return redevenCloudAllowedOrigins(policy).includes(normalized);
  } catch {
    return false;
  }
}

export function requireRedevenCloudOrigin(
  rawOrigin: string,
  policy: RedevenCloudOriginPolicy,
): string {
  const normalized = normalizeControlPlaneOrigin(rawOrigin);
  if (!isRedevenCloudOrigin(normalized, policy)) {
    throw new Error('Redeven Desktop supports Redeven Cloud only.');
  }
  return normalized;
}
