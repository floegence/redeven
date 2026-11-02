import { X509Certificate, createPublicKey } from 'node:crypto';
import { GatewayTrustError } from './gatewayTrust';

export type GatewayClientAccessPackage = Readonly<{
  purpose: 'redeven-gateway-client';
  version: 1;
  access_code: string;
  gateway_id: string;
  gateway_public_key: string;
  tls_root_pem: string;
  expires_at_unix_ms: number;
}>;

/** A host-delivered trust bootstrap scoped to one connection. No global CA install. */
export function decodeGatewayClientAccessPackage(input: string, now = Date.now()): GatewayClientAccessPackage {
  try {
    const encoded = input.trim();
    if (encoded.length > 32768 || !/^rdgc1\.[A-Za-z0-9_-]+$/.test(encoded)) throw new Error();
    const raw = Buffer.from(encoded.slice(6), 'base64url');
    if (raw.toString('base64url') !== encoded.slice(6)) throw new Error();
    const value = JSON.parse(raw.toString('utf8')) as GatewayClientAccessPackage;
    if (!value || Object.keys(value).sort().join(',') !== 'access_code,expires_at_unix_ms,gateway_id,gateway_public_key,purpose,tls_root_pem,version'
      || value.purpose !== 'redeven-gateway-client' || value.version !== 1
      || typeof value.access_code !== 'string' || value.access_code.length < 16 || value.access_code.length > 128
      || typeof value.gateway_id !== 'string' || !value.gateway_id || value.gateway_id.length > 256
      || typeof value.gateway_public_key !== 'string' || value.gateway_public_key.length > 4096
      || typeof value.tls_root_pem !== 'string' || value.tls_root_pem.length > 16384
      || !Number.isSafeInteger(value.expires_at_unix_ms) || value.expires_at_unix_ms <= now || value.expires_at_unix_ms > now + 660_000) throw new Error();
    if (!/^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$/.test(value.gateway_public_key) || (value.gateway_public_key.match(/-----BEGIN /g)?.length ?? 0) !== 1
      || !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(value.tls_root_pem) || (value.tls_root_pem.match(/-----BEGIN /g)?.length ?? 0) !== 1) throw new Error();
    if (createPublicKey(value.gateway_public_key).asymmetricKeyType !== 'ed25519' || !new X509Certificate(value.tls_root_pem).ca) throw new Error();
    return value;
  } catch {
    throw new GatewayTrustError('GATEWAY_ACCESS_CODE_INVALID', 'Use valid, unexpired Gateway client access information.');
  }
}
