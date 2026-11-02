import type { GatewayNetworkSettings } from '../shared/gatewayMembership';
import { normalizeGatewayNetworkSettings } from '../shared/gatewayNetworkSettings';
import type { RuntimeAttachmentServiceResponse } from '../shared/gatewayMembership';
import { createHash, randomBytes } from 'node:crypto';
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
  GATEWAY_PROTOCOL_VERSION, type GatewayPermissions, type RuntimeAttachment, type GatewayEndpoint,
  type GatewayPolicy, type GatewayInvitationCodeDelivery, type RuntimeAttachmentOffer,
  type RuntimeAttachmentOperationResult, type GatewayEgressPermission, type GatewayHookStatuses, type GatewayHookStatus, type GatewayClientAccessCode, type GatewayAuthorizedClient,
} from '../shared/gatewayMembership';

export type GatewayRequestOptions = Readonly<{ timeoutMs?: number; signal?: AbortSignal; tlsRootPEM?: string; operationID?: string }>;
export type GatewayCatalogResponse = Readonly<{
  protocol_version: typeof GATEWAY_PROTOCOL_VERSION;
  gateway: Readonly<{
    gateway_id: string; display_name: string; gateway_public_key_fingerprint: string;
    listener_address: string;
    listener_addresses?: readonly string[];
    listener_running?: boolean;
    active_listener_addresses?: readonly string[];
    listener_restart_required?: boolean;
    allowed_hosts?: readonly string[];
    endpoint_last_used_at?: Readonly<Record<string, number>>;
    endpoints: readonly GatewayEndpoint[]; tls_root_pem: string; permissions: GatewayPermissions;
  }>;
  attachments: readonly RuntimeAttachment[];
  policy: GatewayPolicy;
  revision: number;
  hook_status: GatewayHookStatuses;
}>;
export type RuntimeAttachmentPolicyUpdate = Readonly<{
  attachment_id: string; expected_attachment_version: number; egress_permission: GatewayEgressPermission;
}>;

export class GatewayClientError extends Error {
  operationCompleted = false;
  operationID?: string;
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
function gatewayShareOrigin(value: unknown): string {
 const address = text(value,512);
 try { const url = new URL(address); if (url.protocol !== 'https:' || url.origin !== address || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return invalid(); } catch { return invalid(); }
 return address;
}
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
  if (value !== GATEWAY_PROTOCOL_VERSION) throw new GatewayClientError('GATEWAY_PROTOCOL_VERSION_UNSUPPORTED', 'This Gateway uses an unsupported Gateway protocol. Update the incompatible peer.');
  return value;
}
function permissions(value: unknown): GatewayPermissions {
  const item = object(value);
  return { access: boolean(item.access), manage_attachments: boolean(item.manage_attachments), manage_network: boolean(item.manage_network) };
}
function cloudPermission(value: unknown): GatewayEgressPermission {
  if (value !== 'inherit' && value !== 'allow' && value !== 'deny') return invalid();
  return value;
}
function hookStatus(value: unknown): GatewayHookStatus {
  if (value !== 'not_configured' && value !== 'configured' && value !== 'invalid') return invalid();
  return value;
}
function policy(value: unknown): GatewayPolicy {
  const item = object(value);
  if (!Array.isArray(item.destinations) || item.destinations.length > 64) return invalid();
  return { revision: integer(item.revision, 1), default_egress_allowed: boolean(item.default_egress_allowed), destinations: item.destinations.map(value => text(value, 260)) };
}
function member(value: unknown): RuntimeAttachment {
  const item = object(value), metadata = object(item.metadata);
  if (item.state !== 'active' && item.state !== 'removed') return invalid();
  return {
    attachment_id: id(item.attachment_id), runtime_public_id: id(item.runtime_public_id), attachment_version: integer(item.attachment_version, 1),
    display_name: text(item.display_name), state: item.state, connected: boolean(item.connected),
    last_seen_at_unix_ms: integer(item.last_seen_at_unix_ms), egress_permission: cloudPermission(item.egress_permission),
    effective_egress_allowed: boolean(item.effective_egress_allowed), metadata: {
      hostname: text(metadata.hostname), os: text(metadata.os, 64), arch: text(metadata.arch, 64), version: text(metadata.version, 128),
    },
  };
}
export function normalizeGatewayCatalogResponse(value: unknown): GatewayCatalogResponse {
  const item = object(value), gateway = object(item.gateway), hooks = object(item.hook_status);
  const memberEndpoints = endpointList(gateway.endpoints, false);
  if (!Array.isArray(item.attachments) || item.attachments.length > 1024) return invalid();
  const attachments = item.attachments.map(member);
  if (new Set(attachments.map(value => value.attachment_id)).size !== attachments.length) return invalid();
  return {
    protocol_version: version(item.protocol_version), gateway: {
      gateway_id: id(gateway.gateway_id), display_name: text(gateway.display_name),
      gateway_public_key_fingerprint: text(gateway.gateway_public_key_fingerprint), listener_address: text(gateway.listener_address), endpoints: memberEndpoints,
      listener_addresses: Array.isArray(gateway.listener_addresses) ? gateway.listener_addresses.map(value => text(value)) : [],
      listener_running: gateway.listener_running === true,
      active_listener_addresses: Array.isArray(gateway.active_listener_addresses) ? gateway.active_listener_addresses.map(value => text(value)) : [],
      listener_restart_required: gateway.listener_restart_required === true,
      allowed_hosts: Array.isArray(gateway.allowed_hosts) ? gateway.allowed_hosts.map(value => text(value)) : [],
      endpoint_last_used_at: Object.fromEntries(Object.entries(object(gateway.endpoint_last_used_at ?? {})).map(([key, value]) => [id(key), integer(value, 0)])),
      tls_root_pem: text(gateway.tls_root_pem, 16_384), permissions: permissions(gateway.permissions),
    }, attachments, policy: policy(item.policy), revision: integer(item.revision, 1),
    hook_status: { 'attachment.admit': hookStatus(hooks['attachment.admit']), 'access.open': hookStatus(hooks['access.open']), 'egress.open': hookStatus(hooks['egress.open']) },
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

/** One signed v6 client for URL and trusted host transports. The optional bridge
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
    const path = `/gateway/v6/${route}`;
    const mutation = this.bridge && !['identity', 'catalog', 'pairing/challenge', 'pairing/complete', 'access/open', 'access/service', 'clients/list', 'operations/query'].includes(route);
    const pendingKey = mutation ? 'gateway-host-operation:' + record.connection_id + ':' + createHash('sha256').update(JSON.stringify([gatewayProtocolID(record), record.trust_profile?.gateway_public_key_fingerprint, route, body])).digest('hex') : undefined;
    const pendingID = pendingKey ? await this.secretStore.readSecret(pendingKey) : undefined;
    const operationID = options.operationID || pendingID || (mutation ? randomBytes(24).toString('base64url') : undefined);
    const recoveryKey = operationID ? 'gateway-host-operation-result:' + record.connection_id + ':' + operationID : undefined;
    const recover = async () => {
      try {
        const result = await this.request(record, 'operations/query', { protocol_version: GATEWAY_PROTOCOL_VERSION }, { ...options, operationID });
        if (pendingKey) await this.secretStore.deleteSecret(pendingKey);
        if (recoveryKey) await this.secretStore.deleteSecret(recoveryKey);
        return result;
      } catch (error) {
        if (error instanceof GatewayClientError && error.operationCompleted) {
          if (pendingKey) await this.secretStore.deleteSecret(pendingKey);
          if (recoveryKey) await this.secretStore.deleteSecret(recoveryKey);
          throw error;
        }
        if (recoveryKey && pendingKey) await this.secretStore.writeSecret(recoveryKey, JSON.stringify({ pendingKey, gatewayID: gatewayProtocolID(record), fingerprint: record.trust_profile?.gateway_public_key_fingerprint }));
        const unknown = new GatewayClientError('OPERATION_RESULT_UNKNOWN', 'The result is uncertain. Inspect the Gateway state and query the original operation before taking further action.');
        unknown.operationID = operationID;
        throw unknown;
      }
    };
    if (pendingID && mutation) return recover();
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
      url = new URL(`gateway/v6/${route}`, normalizeGatewayBaseURL(record.connection.base_url));
      if (url.protocol !== 'https:' && !(record.connection.allow_loopback_http && url.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(url.hostname))) {
        throw new GatewayClientError('GATEWAY_URL_INSECURE', 'Gateway requires HTTPS.');
      }
    }
    const payload = JSON.stringify(body);
    if (Buffer.byteLength(payload) > 64 << 10) throw new GatewayClientError('INVALID_REQUEST', 'Gateway request exceeds its size limit.');
    try {
      if (pendingKey && operationID) await this.secretStore.writeSecret(pendingKey, operationID);
      const result = await new Promise((resolve, reject) => {
        const request = (url.protocol === 'https:' ? https.request : http.request)(url, {
          method: 'POST', agent: agent ?? false, signal, ...(url.protocol === 'https:' ? { ca: options.tlsRootPEM ?? record.trust_profile?.tls_root_pem, minVersion: 'TLSv1.3' as const } : {}), headers: {
            ...headers, ...(operationID ? { 'X-Redeven-Operation-ID': operationID } : {}), 'Content-Type': 'application/json', Accept: 'application/json',
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
          response.once('end', () => { try { resolve(envelope(Buffer.concat(parts).toString('utf8'), response.statusCode ?? 500)); } catch (error) {
            if (error instanceof GatewayClientError) error.operationCompleted = response.headers['x-redeven-operation-state'] === 'completed';
            reject(error);
          } });
        });
        request.once('error', error => reject(error instanceof GatewayClientError ? error : new GatewayClientError(signal.aborted ? 'GATEWAY_CANCELED' : 'GATEWAY_UNREACHABLE', 'Gateway request could not complete.', null, true)));
        request.end(payload);
      });
      if (pendingKey) await this.secretStore.deleteSecret(pendingKey);
      return result;
    } catch (error) {
      const uncertain = !(error instanceof GatewayClientError) || ['GATEWAY_UNREACHABLE', 'GATEWAY_CANCELED', 'GATEWAY_INVALID_RESPONSE', 'GATEWAY_RESPONSE_LIMIT', 'OPERATION_RESULT_UNKNOWN'].includes(error.code);
      if (mutation && operationID && uncertain && !options.signal?.aborted) return await recover();
      if (pendingKey && !uncertain) await this.secretStore.deleteSecret(pendingKey);
      if (error instanceof GatewayClientError && operationID) error.operationID = operationID;
      if (error instanceof GatewayClientError) throw error;
      throw new GatewayClientError(signal.aborted ? 'GATEWAY_CANCELED' : 'GATEWAY_UNREACHABLE', 'Gateway request could not complete.', null, true);
    } finally { agent?.destroy(); }
  }

  /** Explicit user reconciliation retires recovery state; it performs no mutation. */
  async acknowledgeOperation(record: GatewayRecord, operationID: string): Promise<void> {
    if (!this.bridge || !/^[A-Za-z0-9_-]{16,128}$/u.test(operationID)) throw new GatewayClientError('HOST_MANAGEMENT_REQUIRED', 'A verified host connection is required.');
    await this.catalog(record);
    const recoveryKey = 'gateway-host-operation-result:' + record.connection_id + ':' + operationID;
    const raw = await this.secretStore.readSecret(recoveryKey);
    if (!raw) return;
    const value = object(JSON.parse(raw));
    const key = text(value.pendingKey, 512);
    if (!key.startsWith('gateway-host-operation:' + record.connection_id + ':') || value.gatewayID !== gatewayProtocolID(record)
      || value.fingerprint !== record.trust_profile?.gateway_public_key_fingerprint) throw new GatewayClientError('GATEWAY_ID_MISMATCH', 'The recovery operation belongs to another Gateway identity.');
    if (await this.secretStore.readSecret(key) === operationID) await this.secretStore.deleteSecret(key);
    await this.secretStore.deleteSecret(recoveryKey);
  }

  async catalog(record: GatewayRecord, options: GatewayRequestOptions = {}): Promise<GatewayCatalogResponse> {
    const catalog = normalizeGatewayCatalogResponse(await this.request(record, 'catalog', { protocol_version: GATEWAY_PROTOCOL_VERSION }, options));
    if (catalog.gateway.gateway_id !== gatewayProtocolID(record)) throw new GatewayClientError('GATEWAY_ID_MISMATCH', 'Gateway identity changed.');
    assertGatewayFingerprint(record.trust_profile!, catalog.gateway.gateway_public_key_fingerprint);
    return catalog;
  }


  async issueAccessCode(record: GatewayRecord): Promise<GatewayClientAccessCode> {
    const value = object(await this.request(record, 'clients/access-codes', { protocol_version: GATEWAY_PROTOCOL_VERSION }, {}));
    return { access_code: text(value.access_code, 32768), expires_at_unix_ms: integer(value.expires_at_unix_ms, 1) };
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

  async invite(record: GatewayRecord, options: GatewayRequestOptions = {}): Promise<GatewayInvitationCodeDelivery> {
    const item = object(await this.request(record, 'invitation-codes', { protocol_version: GATEWAY_PROTOCOL_VERSION }, options));
    if (item.gateway_id !== gatewayProtocolID(record)) return invalid();
    const addresses = Array.isArray(item.share_addresses) ? item.share_addresses.map(gatewayShareOrigin) : invalid();
    const address = gatewayShareOrigin(item.share_address);
    if (!addresses.length || addresses.length > 16 || !addresses.includes(address)) return invalid();
    const code = text(item.code, 26);
    if (!/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/u.test(code)) return invalid();
    return { protocol_version: version(item.protocol_version), invitation_id: id(item.invitation_id), gateway_id: id(item.gateway_id), gateway_name: text(item.gateway_name,256), gateway_public_key: text(item.gateway_public_key), share_address: address, share_addresses: addresses, code, issued_at_unix_ms: integer(item.issued_at_unix_ms,1), expires_at_unix_ms: integer(item.expires_at_unix_ms,1), signature: text(item.signature) };
  }

  async updateNetworkSettings(record: GatewayRecord, settings: GatewayNetworkSettings, options: GatewayRequestOptions = {}): Promise<{settings:GatewayNetworkSettings; restart_required:boolean}> {
    const value = object(await this.request(record, 'network-settings', {protocol_version:GATEWAY_PROTOCOL_VERSION, settings}, options));
    version(value.protocol_version);
    const normalized = normalizeGatewayNetworkSettings(value.settings);
    if (!normalized) return invalid();
    return {settings:normalized, restart_required:boolean(value.restart_required)};
  }
  async updateEndpoints(record: GatewayRecord, endpoints: readonly GatewayEndpoint[], options: GatewayRequestOptions = {}): Promise<readonly GatewayEndpoint[]> {
    const value = object(await this.request(record, 'endpoints', { protocol_version: GATEWAY_PROTOCOL_VERSION, endpoints }, options));
    version(value.protocol_version);
    return endpointList(value.endpoints, false);
  }

  async openMember(record: GatewayRecord, memberID: string, options: GatewayRequestOptions = {}): Promise<RuntimeAttachmentOffer> {
    const offer = object(await this.request(record, 'access/open', { protocol_version: GATEWAY_PROTOCOL_VERSION, attachment_id: id(memberID) }, options));
    version(offer.protocol_version);
    if (offer.attachment_id !== memberID) return invalid();
    integer(offer.attachment_version, 1); integer(offer.generation, 1); integer(offer.expires_at_unix_ms, 1); id(offer.channel_id);
    // The transport validates the full signed delegation, certificate and SDK
    // artifact before connecting. No unverified endpoint reaches a dialer.
    object(offer.artifact); object(offer.service); object(offer.delegation);
    return offer as unknown as RuntimeAttachmentOffer;
  }

  async memberService(record: GatewayRecord, memberID: string, memberVersion: number, options: GatewayRequestOptions = {}): Promise<RuntimeAttachmentServiceResponse> {
    const response = object(await this.request(record, 'access/service', { protocol_version: GATEWAY_PROTOCOL_VERSION, attachment_id: id(memberID), expected_attachment_version: integer(memberVersion, 1) }, options));
    version(response.protocol_version);
    if (response.attachment_id !== memberID || response.attachment_version !== memberVersion) return invalid();
    object(response.service); object(response.delegation);
    return response as unknown as RuntimeAttachmentServiceResponse;
  }

  memberConnectionPath(catalog: GatewayCatalogResponse): NodeConnectionPath | undefined {
    if (!this.bridge) return undefined;
    const endpoints = catalog.gateway.endpoints.map(item => new URL(item.address));
    return { connect: async ({ hostname, port, signal }) => {
      signal.throwIfAborted();
      if (!endpoints.some(endpoint => hostname === endpoint.hostname.replace(/^\[|\]$/gu, '') && port === Number(endpoint.port || 443))) throw new GatewayClientError('ATTACHMENT_TARGET_DENIED', 'Gateway member endpoint does not match.');
      const socket = openGatewayBridgeSocket(this.bridge!, 'gateway_member');
      const abort = () => socket.destroy();
      signal.addEventListener('abort', abort, { once: true });
      socket.once('close', () => signal.removeEventListener('abort', abort));
      if (signal.aborted) { socket.destroy(); signal.throwIfAborted(); }
      return socket;
    } };
  }

  async removeMember(record: GatewayRecord, memberID: string, expectedAttachmentVersion: number, options: GatewayRequestOptions = {}): Promise<void> {
    await this.request(record, 'attachments/remove', { protocol_version: GATEWAY_PROTOCOL_VERSION, attachment_id: id(memberID), expected_attachment_version: integer(expectedAttachmentVersion, 1) }, options);
  }

  async reevaluateMember(record: GatewayRecord, memberID: string, expectedAttachmentVersion: number, options: GatewayRequestOptions = {}): Promise<void> {
    await this.request(record, 'attachments/reevaluate', { protocol_version: GATEWAY_PROTOCOL_VERSION, attachment_id: id(memberID), expected_attachment_version: integer(expectedAttachmentVersion, 1) }, options);
  }

  async updateMembers(record: GatewayRecord, items: readonly RuntimeAttachmentPolicyUpdate[], options: GatewayRequestOptions = {}): Promise<readonly RuntimeAttachmentOperationResult[]> {
    const value = await this.request(record, 'attachments/policy', { protocol_version: GATEWAY_PROTOCOL_VERSION, items }, options);
    if (!Array.isArray(value) || value.length !== items.length) return invalid();
    return value.map((raw, index) => {
      const item = object(raw);
      if (item.attachment_id !== items[index].attachment_id) return invalid();
      return { attachment_id: id(item.attachment_id), ...(item.error_code ? { error_code: text(item.error_code, 80) } : {}), ...(item.member ? { member: member(item.member) } : {}) };
    });
  }

  async updatePolicy(record: GatewayRecord, next: GatewayPolicy, options: GatewayRequestOptions = {}): Promise<void> {
    await this.request(record, 'policy', { protocol_version: GATEWAY_PROTOCOL_VERSION, expected_revision: next.revision, policy: next }, options);
  }

}

export { redactGatewayDiagnosticValue } from '../shared/gatewayDiagnostics';
