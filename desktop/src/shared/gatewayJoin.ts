import type { GatewayEndpoint } from './gatewayMembership';

export type GatewayMembershipPhase = 'not_joined' | 'joining' | 'gateway_offline' | 'joined' | 'reauthorization_required' | 'removal_pending' | 'cloud_denied' | 'cloud_pending' | 'cloud_control_offline' | 'accessible' | 'migration_pending';
export type GatewayMembershipStatus = Readonly<{
  joined: boolean;
  phase: GatewayMembershipPhase;
  gateway_id?: string;
  endpoints?: readonly GatewayEndpoint[];
  last_endpoint_id?: string;
  member_id?: string;
  existing_environment_id?: string;
  rejoin_required?: boolean;
  publication_error_code?: string;
}>;
export type GatewayEnvironmentChoice = 'preserve' | 'new';
export type GatewayMembershipOperation = 'join' | 'replace' | 'update-endpoints' | 'status' | 'retry' | 'leave';

export type GatewayEnrollmentPurpose = 'join' | 'replace' | 'update-endpoints';
export type GatewayPreviewInput = Readonly<{ address: string; code: string; purpose: GatewayEnrollmentPurpose }>;
export type GatewayJoinPreview = Readonly<{
 preview_id: string; purpose: GatewayEnrollmentPurpose; gateway_id: string; gateway_name: string;
 target_runtime_id: string; expires_at_unix_ms: number; existing_environment_id?: string;
}>;

export function normalizeGatewayJoinPreview(value: unknown): GatewayJoinPreview | null {
 if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
 const input = value as Record<string, unknown>;
 if (Object.keys(input).some(key => !['preview_id','purpose','gateway_id','gateway_name','target_runtime_id','expires_at_unix_ms','existing_environment_id'].includes(key))
  || typeof input.preview_id !== 'string' || !/^[a-zA-Z0-9_-]{43}$/u.test(input.preview_id)
  || !['join','replace','update-endpoints'].includes(String(input.purpose))
  || !Number.isSafeInteger(input.expires_at_unix_ms) || Number(input.expires_at_unix_ms) <= 0
  || ['gateway_id','gateway_name','target_runtime_id'].some(key => typeof input[key] !== 'string' || !String(input[key]).trim() || String(input[key]).length > 256)
  || input.existing_environment_id !== undefined && typeof input.existing_environment_id !== 'string') return null;
 return input as GatewayJoinPreview;
}
