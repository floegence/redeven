export type RuntimeGatewayPublication = Readonly<{
  protocol_version: 2;
  cloud_origin: string;
  namespace_public_id: string;
  gateway_public_id: string;
  state: 'pending' | 'connecting' | 'connected' | 'disabled' | 'revoked';
}>;

export function normalizeRuntimeGatewayPublication(value: unknown): RuntimeGatewayPublication | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (record.protocol_version !== 2 || typeof record.cloud_origin !== 'string'
    || typeof record.namespace_public_id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/u.test(record.namespace_public_id)
    || typeof record.gateway_public_id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/u.test(record.gateway_public_id)
    || typeof record.state !== 'string' || !['pending', 'connecting', 'connected', 'disabled', 'revoked'].includes(record.state)) return undefined;
  try {
    const cloud = new URL(record.cloud_origin);
    if (cloud.protocol !== 'https:' || cloud.origin !== record.cloud_origin || cloud.username || cloud.password) return undefined;
    return { protocol_version: 2, cloud_origin: cloud.origin, namespace_public_id: record.namespace_public_id,
      gateway_public_id: record.gateway_public_id, state: record.state as RuntimeGatewayPublication['state'] };
  } catch { return undefined; }
}

export function runtimeGatewayManagementURL(value: RuntimeGatewayPublication): string {
  return `${value.cloud_origin}/namespaces/${encodeURIComponent(value.namespace_public_id)}/gateways?gateway=${encodeURIComponent(value.gateway_public_id)}`;
}
