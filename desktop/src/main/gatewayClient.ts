import type { GatewayMemberServiceResponse } from '../shared/gatewayMembership';
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import type net from 'node:net';
import type { NodeConnectionPath } from '@floegence/flowersec-core/node';
import { openGatewayBridgeSocket } from './gatewayBridgeSocket';
import { normalizeGatewayBaseURL, gatewayProtocolID, type GatewayRecord } from './gatewayStore';
import {
  assertGatewayAddressProof, assertGatewayFingerprint, createGatewayAuthHeaders,
  type GatewayPairingChallengeResponse, type GatewayPairingCompleteRequest,
  type GatewayPairingCompleteResponse, type GatewaySecretStore,
} from './gatewayTrust';
import type { RuntimePlacementBridgeSessionHandle } from './runtimePlacementBridgeSession';
import {
  GATEWAY_PROTOCOL_VERSION, type GatewayPermissions, type GatewayMember, type GatewayEndpoint,
  type GatewayPolicy, type GatewayMemberInvitation, type GatewayMemberOffer,
  type GatewayMemberOperationResult, type GatewayCloudPermission, type GatewayHookStatuses, type GatewayHookStatus, type GatewayClientAccessCode, type GatewayAuthorizedClient,
} from '../shared/gatewayMembership';

export type GatewayRequestOptions = Readonly<{ timeoutMs?: number; signal?: AbortSignal }>;
export type GatewayCatalogResponse = Readonly<{
  protocol_version: typeof GATEWAY_PROTOCOL_VERSION;
  gateway: Readonly<{
    gateway_id: string; display_name: string; gateway_public_key_fingerprint: string;
    listener_address: string;
    listener_addresses?: readonly string[];
    listener_running?: boolean;
    endpoint_last_used_at?: Readonly<Record<string, number>>;
    member_endpoints: readonly GatewayEndpoint[]; member_tls_root_pem: string; permissions: GatewayPermissions;
  }>;
  members: readonly GatewayMember[];
  policy: GatewayPolicy;
  revision: number;
  rebuild_required: boolean;
  hook_status: GatewayHookStatuses;
}>;
export type GatewayMemberPolicyUpdate = Readonly<{
  member_id: string; expected_member_version: number; cloud_permission: GatewayCloudPermission;
}>;

export class GatewayClientError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number | null = null, readonly retryable = false) {
    super(message); this.name = 'GatewayClientError';
  }
}
function invalid(): never { throw new GatewayClientError('GATEWAY_INVALID_RESPONSE', 'Gateway returned an invalid response.'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum = 1024): string {
  if (typeof value !== 'string' || value.length > maximum) return invalid();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 160);
  if (!/^[A-Za-z0-9_-]+$/u.test(result)) return invalid();
  return result;
}
function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) return invalid();
  return value;
}
function boolean(value: unknown): boolean { if (typeof value !== 'boolean') return invalid(); return value; }
function endpoint(value: unknown): GatewayEndpoint {
  const item = object(value);
  const scope = item.scope;
  if (scope !== 'lan' && scope !== 'overlay' && scope !== 'public') return invalid();
  const address = text(item.address, 512);
  const parsed = new URL(address);
  if (parsed.protocol !== 'https:' || parsed.origin !== address || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return invalid();
  const priority = integer(item.priority, 0);
  if (priority > 1000) return invalid();
  return { endpoint_id: id(item.endpoint_id), address, scope, priority };
}
function endpointList(value: unknown, requireOne = true): readonly GatewayEndpoint[] {
  if (!Array.isArray(value) || (requireOne && value.length < 1) || value.length > 16) return invalid();
  const result = value.map(endpoint);
  if (new Set(result.map(item => item.endpoint_id)).size !== result.length || new Set(result.map(item => item.address)).size !== result.length) return invalid();
  return result;
}
function version(value: unknown): typeof GATEWAY_PROTOCOL_VERSION {
  if (value !== GATEWAY_PROTOCOL_VERSION) throw new GatewayClientError('GATEWAY_PROTOCOL_VERSION_UNSUPPORTED', 'Update Gateway and Desktop to matching versions.');
  return value;
}
function permissions(value: unknown): GatewayPermissions {
  const item = object(value);
  return { access: boolean(item.access), manage_members: boolean(item.manage_members), configure_cloud: boolean(item.configure_cloud) };
}
function cloudPermission(value: unknown): GatewayCloudPermission {
  if (value !== 'inherit' && value !== 'allow' && value !== 'deny') return invalid();
  return value;
}
function hookStatus(value: unknown): GatewayHookStatus {
  if (value !== 'not_configured' && value !== 'configured' && value !== 'invalid') return invalid();
  return value;
}
function policy(value: unknown): GatewayPolicy {
  const item = object(value);
  if (item.publication_mode !== 'manual' && item.publication_mode !== 'automatic') return invalid();
  return { revision: integer(item.revision, 1), default_cloud_allowed: boolean(item.default_cloud_allowed), publication_mode: item.publication_mode };
}
function member(value: unknown): GatewayMember {
  const item = object(value), metadata = object(item.metadata);
  if (item.state !== 'active' && item.state !== 'removed') return invalid();
  return {
    member_id: id(item.member_id), runtime_public_id: id(item.runtime_public_id), member_version: integer(item.member_version, 1),
    display_name: text(item.display_name), state: item.state, connected: boolean(item.connected),
    last_seen_at_unix_ms: integer(item.last_seen_at_unix_ms), cloud_permission: cloudPermission(item.cloud_permission),
    effective_cloud_allowed: boolean(item.effective_cloud_allowed), cloud_state: text(item.cloud_state, 80),
    cloud_revocation_pending: boolean(item.cloud_revocation_pending), metadata: {
      hostname: text(metadata.hostname), os: text(metadata.os, 64), arch: text(metadata.arch, 64), version: text(metadata.version, 128),
    },
  };
}
export function normalizeGatewayCatalogResponse(value: unknown): GatewayCatalogResponse {
  const item = object(value), gateway = object(item.gateway), hooks = object(item.hook_status);
  const memberEndpoints = endpointList(gateway.member_endpoints, false);
  if (!Array.isArray(item.members) || item.members.length > 1024) return invalid();
  const members = item.members.map(member);
  if (new Set(members.map(value => value.member_id)).size !== members.length) return invalid();
  return {
    protocol_version: version(item.protocol_version), gateway: {
      gateway_id: id(gateway.gateway_id), display_name: text(gateway.display_name),
      gateway_public_key_fingerprint: text(gateway.gateway_public_key_fingerprint), listener_address: text(gateway.listener_address), member_endpoints: memberEndpoints,
      listener_addresses: Array.isArray(gateway.listener_addresses) ? gateway.listener_addresses.map(value => text(value)) : [],
      listener_running: gateway.listener_running === true,
      endpoint_last_used_at: Object.fromEntries(Object.entries(object(gateway.endpoint_last_used_at ?? {})).map(([key, value]) => [id(key), integer(value, 0)])),
      member_tls_root_pem: text(gateway.member_tls_root_pem, 16_384), permissions: permissions(gateway.permissions),
    }, members, policy: policy(item.policy), revision: integer(item.revision, 1), rebuild_required: boolean(item.rebuild_required),
    hook_status: { 'member.admit': hookStatus(hooks['member.admit']), 'access.open': hookStatus(hooks['access.open']), 'cloud.publish': hookStatus(hooks['cloud.publish']) },
  };
}
function envelope(raw: string, status: number): unknown {
  let data: Record<string, unknown>;
  try { data = object(JSON.parse(raw)); }
  catch { throw new GatewayClientError(status === 404 ? 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED' : 'GATEWAY_INVALID_RESPONSE', 'Gateway returned an invalid protocol response.', status); }
  if (status >= 400 || data.ok !== true) {
    const error = data.error && typeof data.error === 'object' ? data.error as Record<string, unknown> : {};
    const code = typeof error.code === 'string' && /^[A-Z_]{1,80}$/u.test(error.code) ? error.code : 'GATEWAY_REQUEST_FAILED';
    throw new GatewayClientError(code, `Gateway request failed with ${code}.`, status, status === 429 || status >= 500);
  }
  return data.data;
}

/** One signed v5 client for URL and trusted host transports. The optional bridge
 * changes only byte delivery; it never grants Runtime lifecycle permissions.
 */
export class GatewayClient {
  constructor(private readonly secretStore: GatewaySecretStore, private readonly bridge?: RuntimePlacementBridgeSessionHandle) {}

  async verifyAddress(record: GatewayRecord, options: GatewayRequestOptions = {}): Promise<void> {
    const nonce = randomBytes(24).toString('base64url');
    const response = await this.request(record, 'identity', { protocol_version: GATEWAY_PROTOCOL_VERSION, nonce }, options);
    assertGatewayAddressProof(record, nonce, response);
  }

  private async request(record: GatewayRecord, route: string, body: unknown, options: GatewayRequestOptions, authenticated = true): Promise<unknown> {
    if (!this.bridge && !['identity', 'catalog', 'pairing/challenge', 'pairing/complete', 'access/open', 'access/service'].includes(route)) {
      throw new GatewayClientError('HOST_MANAGEMENT_REQUIRED', 'Manage this Gateway through its host connection.');
    }
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs ?? 20_000)]) : AbortSignal.timeout(options.timeoutMs ?? 20_000);
    signal.throwIfAborted();
    const path = `/gateway/v5/${route}`;
    const headers = authenticated ? await createGatewayAuthHeaders({ record, method: 'POST', route: path, body, secret_store: this.secretStore }) : {};
    signal.throwIfAborted();
    let url: URL;
    let agent: http.Agent | undefined;
    if (this.bridge) {
      url = new URL(path, 'http://redeven-gateway.local');
      agent = new http.Agent({ keepAlive: false });
      agent.createConnection = () => openGatewayBridgeSocket(this.bridge!) as net.Socket;
    } else {
      if (record.connection.kind !== 'url') throw new GatewayClientError('GATEWAY_BRIDGE_UNAVAILABLE', 'Gateway host bridge is unavailable.');
      url = new URL(`gateway/v5/${route}`, normalizeGatewayBaseURL(record.connection.base_url));
      if (url.protocol !== 'https:' && !(record.connection.allow_loopback_http && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) {
        throw new GatewayClientError('GATEWAY_URL_INSECURE', 'Gateway requires HTTPS.');
      }
    }
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > 64 << 10) throw new GatewayClientError('INVALID_REQUEST', 'Gateway request exceeds its size limit.');
    try {
      return await new Promise((resolve, reject) => {
        const request = (url.protocol === 'https:' ? https.request : http.request)(url, {
          method: 'POST', agent: agent ?? false, signal, headers: {
            ...headers, 'Content-Type': 'application/json', Accept: 'application/json',
            'Content-Length': Buffer.byteLength(payload), Connection: 'close',
            ...(this.bridge ? { 'X-Redeven-Gateway-Transport': 'desktop_bridge' } : {}),
          },
        }, response => {
          const parts: Buffer[] = []; let bytes = 0;
          response.on('data', (part: Buffer) => {
            bytes += part.length;
            if (bytes > 2 << 20) request.destroy(new GatewayClientError('GATEWAY_RESPONSE_LIMIT', 'Gateway response exceeds its size limit.'));
            else parts.push(part);
          });
          response.once('error', reject);
          response.once('end', () => { try { resolve(envelope(Buffer.concat(parts).toString('utf8'), response.statusCode ?? 500)); } catch (error) { reject(error); } });
        });
        request.once('error', error => reject(error instanceof GatewayClientError ? error : new GatewayClientError(signal.aborted ? 'GATEWAY_CANCELED' : 'GATEWAY_UNREACHABLE', 'Gateway request could not complete.', null, true)));
        request.end(payload);
      });
    } catch (error) {
      if (error instanceof GatewayClientError) throw error;
      throw new GatewayClientError(signal.aborted ? 'GATEWAY_CANCELED' : 'GATEWAY_UNREACHABLE', 'Gateway request could not complete.', null, true);
    } finally { agent?.destroy(); }
  }

  async catalog(record: GatewayRecord, options: GatewayRequestOptions = {}): Promise<GatewayCatalogResponse> {
    const catalog = normalizeGatewayCatalogResponse(await this.request(record, 'catalog', { protocol_version: GATEWAY_PROTOCOL_VERSION }, options));
    if (catalog.gateway.gateway_id !== gatewayProtocolID(record)) throw new GatewayClientError('GATEWAY_ID_MISMATCH', 'Gateway identity changed.');
    assertGatewayFingerprint(record.trust_profile!, catalog.gateway.gateway_public_key_fingerprint);
    return catalog;
  }


  async issueAccessCode(record: GatewayRecord): Promise<GatewayClientAccessCode> {
    const value = object(await this.request(record, 'clients/access-codes', { protocol_version: GATEWAY_PROTOCOL_VERSION }, {}));
    return { access_code: text(value.access_code, 128), expires_at_unix_ms: integer(value.expires_at_unix_ms, 1) };
  }
  async listClients(record: GatewayRecord): Promise<readonly GatewayAuthorizedClient[]> {
    const value = object(await this.request(record, 'clients/list', { protocol_version: GATEWAY_PROTOCOL_VERSION }, {}));
    if (!Array.isArray(value.clients) || value.clients.length > 4096) return invalid();
    return value.clients.map(raw => { const item = object(raw); return { client_key_id: id(item.client_key_id), client_name: text(item.client_name, 160), paired_at_unix_ms: integer(item.paired_at_unix_ms, 1), last_verified_at_unix_ms: integer(item.last_verified_at_unix_ms), revoked_at_unix_ms: integer(item.revoked_at_unix_ms) }; });
  }
  async revokeClient(record: GatewayRecord, clientKeyID: string): Promise<void> {
    await this.request(record, 'clients/revoke', { protocol_version: GATEWAY_PROTOCOL_VERSION, client_key_id: clientKeyID }, {});
  }
  async pairingChallenge(record: GatewayRecord, request: Readonly<{ protocol_version: typeof GATEWAY_PROTOCOL_VERSION; client_nonce: string; client_public_key: string; binding_audience: string; access_code?: string; client_name?: string }>, options: GatewayRequestOptions = {}): Promise<GatewayPairingChallengeResponse> {
    const value = object(await this.request(record, 'pairing/challenge', request, options, false));
    return { protocol_version: version(value.protocol_version), gateway_id: id(value.gateway_id), gateway_public_key: text(value.gateway_public_key),
      gateway_public_key_fingerprint: text(value.gateway_public_key_fingerprint), gateway_nonce: text(value.gateway_nonce),
      compatibility_epoch: integer(value.compatibility_epoch, 1), expires_at_unix_ms: integer(value.expires_at_unix_ms, 1), signature: text(value.signature) };
  }

  async completePairing(record: GatewayRecord, request: GatewayPairingCompleteRequest, options: GatewayRequestOptions = {}): Promise<GatewayPairingCompleteResponse> {
    const value = object(await this.request(record, 'pairing/complete', request, options, false));
    return { protocol_version: version(value.protocol_version), gateway_id: id(value.gateway_id), client_key_id: id(value.client_key_id),
      paired_at_unix_ms: integer(value.paired_at_unix_ms, 1), permissions: permissions(value.permissions), proof: text(value.proof) };
  }

  async invite(record: GatewayRecord, options: GatewayRequestOptions = {}): Promise<GatewayMemberInvitation> {
    const item = object(await this.request(record, 'invitations', { protocol_version: GATEWAY_PROTOCOL_VERSION }, options));
    if (item.gateway_id !== gatewayProtocolID(record)) return invalid();
    return { protocol_version: version(item.protocol_version), invitation_id: id(item.invitation_id), gateway_id: id(item.gateway_id),
      gateway_name: text(item.gateway_name, 256),
      endpoints: endpointList(item.endpoints), gateway_public_key: text(item.gateway_public_key), gateway_tls_root_pem: text(item.gateway_tls_root_pem, 16_384),
      token: text(item.token), issued_at_unix_ms: integer(item.issued_at_unix_ms, 1), expires_at_unix_ms: integer(item.expires_at_unix_ms, 1), signature: text(item.signature) };
  }

  async updateEndpoints(record: GatewayRecord, endpoints: readonly GatewayEndpoint[], options: GatewayRequestOptions = {}): Promise<readonly GatewayEndpoint[]> {
    const value = object(await this.request(record, 'endpoints', { protocol_version: GATEWAY_PROTOCOL_VERSION, endpoints }, options));
    version(value.protocol_version);
    return endpointList(value.endpoints, false);
  }

  async openMember(record: GatewayRecord, memberID: string, options: GatewayRequestOptions = {}): Promise<GatewayMemberOffer> {
    const offer = object(await this.request(record, 'access/open', { protocol_version: GATEWAY_PROTOCOL_VERSION, member_id: id(memberID) }, options));
    version(offer.protocol_version);
    if (offer.member_id !== memberID) return invalid();
    integer(offer.member_version, 1); integer(offer.generation, 1); integer(offer.expires_at_unix_ms, 1); id(offer.channel_id);
    // The transport validates the full signed delegation, certificate and SDK
    // artifact before connecting. No unverified endpoint reaches a dialer.
    object(offer.artifact); object(offer.service); object(offer.delegation);
    return offer as unknown as GatewayMemberOffer;
  }

  async memberService(record: GatewayRecord, memberID: string, memberVersion: number, options: GatewayRequestOptions = {}): Promise<GatewayMemberServiceResponse> {
    const response = object(await this.request(record, 'access/service', { protocol_version: GATEWAY_PROTOCOL_VERSION, member_id: id(memberID), expected_member_version: integer(memberVersion, 1) }, options));
    version(response.protocol_version);
    if (response.member_id !== memberID || response.member_version !== memberVersion) return invalid();
    object(response.service); object(response.delegation);
    return response as unknown as GatewayMemberServiceResponse;
  }

  memberConnectionPath(catalog: GatewayCatalogResponse): NodeConnectionPath | undefined {
    if (!this.bridge) return undefined;
    const endpoints = catalog.gateway.member_endpoints.map(item => new URL(item.address));
    return { connect: async ({ hostname, port, signal }) => {
      signal.throwIfAborted();
      if (!endpoints.some(endpoint => hostname === endpoint.hostname.replace(/^\[|\]$/gu, '') && port === Number(endpoint.port || 443))) throw new GatewayClientError('MEMBER_TARGET_DENIED', 'Gateway member endpoint does not match.');
      const socket = openGatewayBridgeSocket(this.bridge!, 'gateway_member');
      const abort = () => socket.destroy();
      signal.addEventListener('abort', abort, { once: true });
      socket.once('close', () => signal.removeEventListener('abort', abort));
      if (signal.aborted) { socket.destroy(); signal.throwIfAborted(); }
      return socket;
    } };
  }

  async removeMember(record: GatewayRecord, memberID: string, expectedMemberVersion: number, options: GatewayRequestOptions = {}): Promise<void> {
    await this.request(record, 'members/remove', { protocol_version: GATEWAY_PROTOCOL_VERSION, member_id: id(memberID), expected_member_version: integer(expectedMemberVersion, 1) }, options);
  }

  async reevaluateMember(record: GatewayRecord, memberID: string, expectedMemberVersion: number, options: GatewayRequestOptions = {}): Promise<void> {
    await this.request(record, 'members/reevaluate', { protocol_version: GATEWAY_PROTOCOL_VERSION, member_id: id(memberID), expected_member_version: integer(expectedMemberVersion, 1) }, options);
  }

  async updateMembers(record: GatewayRecord, items: readonly GatewayMemberPolicyUpdate[], options: GatewayRequestOptions = {}): Promise<readonly GatewayMemberOperationResult[]> {
    const value = await this.request(record, 'members/policy', { protocol_version: GATEWAY_PROTOCOL_VERSION, items }, options);
    if (!Array.isArray(value) || value.length !== items.length) return invalid();
    return value.map((raw, index) => {
      const item = object(raw);
      if (item.member_id !== items[index].member_id) return invalid();
      return { member_id: id(item.member_id), ...(item.error_code ? { error_code: text(item.error_code, 80) } : {}), ...(item.member ? { member: member(item.member) } : {}) };
    });
  }

  async updatePolicy(record: GatewayRecord, next: GatewayPolicy, options: GatewayRequestOptions = {}): Promise<void> {
    await this.request(record, 'policy', { protocol_version: GATEWAY_PROTOCOL_VERSION, expected_revision: next.revision, policy: next }, options);
  }

  async dismissMigration(record: GatewayRecord, options: GatewayRequestOptions = {}): Promise<void> {
    await this.request(record, 'migration/dismiss', { protocol_version: GATEWAY_PROTOCOL_VERSION }, options);
  }
}

export { redactGatewayDiagnosticValue } from '../shared/gatewayDiagnostics';
