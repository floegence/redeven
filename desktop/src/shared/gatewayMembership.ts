/** Gateway v5 is the membership and multi-endpoint access contract. */
export const GATEWAY_PROTOCOL_VERSION = 'redeven-gateway-v5' as const;
export const GATEWAY_ACCESS_STREAM = 'redeven.gateway.access.https.v5';

export type GatewayEndpointScope = 'lan' | 'overlay' | 'public';
export type GatewayEndpoint = Readonly<{
  endpoint_id: string;
  address: string;
  scope: GatewayEndpointScope;
  priority: number;
}>;

export type GatewayPermissions = Readonly<{
  access: boolean;
  manage_members: boolean;
  configure_cloud: boolean;
}>;
export type GatewayHookStatus = 'not_configured' | 'configured' | 'invalid';
export type GatewayHookStatuses = Readonly<Record<'member.admit' | 'access.open' | 'cloud.publish', GatewayHookStatus>>;
export type GatewayCloudPermission = 'inherit' | 'allow' | 'deny';
export type GatewayPolicy = Readonly<{
  revision: number;
  default_cloud_allowed: boolean;
  publication_mode: 'manual' | 'automatic';
}>;
export type GatewayMember = Readonly<{
  member_id: string;
  runtime_public_id: string;
  member_version: number;
  display_name: string;
  state: 'active' | 'removed';
  connected: boolean;
  last_seen_at_unix_ms: number;
  cloud_permission: GatewayCloudPermission;
  effective_cloud_allowed: boolean;
  cloud_state: string;
  cloud_revocation_pending: boolean;
  metadata: Readonly<{ hostname: string; os: string; arch: string; version: string }>;
}>;
export type GatewayMemberInvitation = Readonly<{
  protocol_version: typeof GATEWAY_PROTOCOL_VERSION;
  invitation_id: string;
  gateway_id: string;
  gateway_name: string;
	endpoints: readonly GatewayEndpoint[];
  gateway_public_key: string;
  gateway_tls_root_pem: string;
  token: string;
  issued_at_unix_ms: number;
  expires_at_unix_ms: number;
  signature: string;
}>;
export type GatewayMemberService = Readonly<{
  revision: number;
  origin: string;
  certificate_pem: string;
  certificate_sha256: string;
  expires_at_unix_ms: number;
  signature: string;
}>;
export type GatewayMemberDelegation = Readonly<{
  protocol_version: typeof GATEWAY_PROTOCOL_VERSION | 'redeven-gateway-v4';
  gateway_id: string;
  member_id: string;
  runtime_public_id: string;
  public_key_b64u: string;
  invitation_id: string;
  consented_at_unix_ms: number;
  manage_access: boolean;
  manage_cloud_publication: boolean;
  signature: string;
}>;
export type GatewayMemberOffer = Readonly<{
  protocol_version: typeof GATEWAY_PROTOCOL_VERSION;
  channel_id: string;
  member_id: string;
  member_version: number;
  generation: number;
  artifact: unknown;
  service: GatewayMemberService;
  delegation: GatewayMemberDelegation;
  expires_at_unix_ms: number;
}>;
export type GatewayMemberOperationResult = Readonly<{
  member_id: string;
  member?: GatewayMember;
  error_code?: string;
}>;

export type GatewayMemberServiceResponse = Pick<GatewayMemberOffer, 'protocol_version' | 'member_id' | 'member_version' | 'service' | 'delegation'>;

export type GatewayClientAccessCode = Readonly<{ access_code: string; expires_at_unix_ms: number }>;
export type GatewayAuthorizedClient = Readonly<{
 client_key_id: string; client_name: string; paired_at_unix_ms: number;
 last_verified_at_unix_ms: number; revoked_at_unix_ms: number;
}>;
