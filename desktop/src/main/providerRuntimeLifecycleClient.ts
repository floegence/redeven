import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from 'node:crypto';

import type {
  DesktopControlPlaneProvider,
  DesktopProviderAccessPoint,
} from '../shared/controlPlaneProvider';
import {
  fetchProviderJSON,
} from './controlPlaneProviderClient';
import type { DesktopProviderTransport } from './controlPlaneProviderTransport';
import {
  GatewayClientError,
  normalizeGatewayRuntimeOperation,
  normalizeGatewayRuntimeOperationEventsResponse,
  normalizeGatewayRuntimeOperationListResponse,
  normalizeGatewayRuntimeOperationPrepareResponse,
  type GatewayRuntimeArtifactMetadata,
  type GatewayRuntimeOperation,
  type GatewayRuntimeOperationListRequest,
  type GatewayRuntimeOperationListResponse,
  type GatewayRuntimeOperationConfirmationRequest,
  type GatewayRuntimeOperationEventsResponse,
  type GatewayRuntimeOperationPrepareRequest,
  type GatewayRuntimeOperationPrepareResponse,
  type GatewayRuntimeOperationReconcileRequest,
} from './gatewayClient';
import type { GatewaySecretStore } from './gatewayTrust';

const PROVIDER_PROTOCOL_VERSION = 'rcpp-v3';
const PROVIDER_RUNTIME_ARTIFACT_CHUNK_BYTES = 256 * 1024;

type ProviderRuntimeClientKey = Readonly<{
  client_key_id: string;
  public_key: string;
  private_key: string;
}>;

export type ProviderRuntimeLifecycleScope = Readonly<{
  provider: DesktopControlPlaneProvider;
  access_point: DesktopProviderAccessPoint;
  access_token: string;
  env_public_id: string;
  lifecycle_target_id: string;
  target_generation: number;
}>;

type ProviderRuntimeTunnelMethod = 'GET' | 'POST' | 'PUT';

type ProviderRuntimeArtifactUpload = Readonly<{
  upload_id: string;
  offset: number;
  total_size: number;
  final: boolean;
  metadata_b64u: string;
}>;

type ProviderRuntimeTunnelResponse = Readonly<{
  protocol_version?: unknown;
  status_code?: unknown;
  content_type?: unknown;
  body_b64u?: unknown;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function providerRuntimeClientSecretRef(providerOrigin: string, envPublicID: string): string {
  const digest = createHash('sha256')
    .update(`${compact(providerOrigin)}\u0000${compact(envPublicID)}`, 'utf8')
    .digest('base64url')
    .slice(0, 32);
  return `provider-runtime-client-key:${digest}`;
}

function providerRuntimeClientKeyID(publicKey: string): string {
  return `gck_${createHash('sha256').update(compact(publicKey), 'utf8').digest('base64url').slice(0, 24)}`;
}

async function loadOrCreateProviderRuntimeClientKey(
  secretStore: GatewaySecretStore,
  providerOrigin: string,
  envPublicID: string,
): Promise<ProviderRuntimeClientKey> {
  const secretRef = providerRuntimeClientSecretRef(providerOrigin, envPublicID);
  const saved = compact(await secretStore.readSecret(secretRef));
  if (saved !== '') {
    try {
      const parsed = JSON.parse(saved) as Record<string, unknown>;
      const publicKey = compact(parsed.public_key);
      const privateKey = compact(parsed.private_key);
      if (publicKey !== '' && privateKey !== '') {
        return {
          client_key_id: providerRuntimeClientKeyID(publicKey),
          public_key: publicKey,
          private_key: privateKey,
        };
      }
    } catch {
      // Replace malformed task-owned key material with a new independent key.
    }
  }
  const pair = generateKeyPairSync('ed25519');
  const publicKey = compact(pair.publicKey.export({ format: 'pem', type: 'spki' }).toString());
  const privateKey = compact(pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
  await secretStore.writeSecret(secretRef, JSON.stringify({ public_key: publicKey, private_key: privateKey }));
  return {
    client_key_id: providerRuntimeClientKeyID(publicKey),
    public_key: publicKey,
    private_key: privateKey,
  };
}

function runtimeOperationRoute(operationID: string, suffix = ''): string {
  const cleanOperationID = compact(operationID);
  if (cleanOperationID === '' || cleanOperationID.includes('/')) {
    throw new GatewayClientError('GATEWAY_RUNTIME_OPERATION_ID_REQUIRED', 'Runtime operation ID is required.');
  }
  return `/gateway/v2/runtime-operations/${encodeURIComponent(cleanOperationID)}${suffix}`;
}

function providerRuntimeTunnelURL(scope: ProviderRuntimeLifecycleScope): string {
  const url = new URL(scope.access_point.access_point_origin);
  url.pathname = `/api/rcpp/v3/environments/${encodeURIComponent(compact(scope.env_public_id))}/runtime-management/tunnel`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

function canonicalProviderRuntimeTunnelPayload(input: Readonly<{
  body_sha256: string;
  client_key_id: string;
  env_public_id: string;
  lifecycle_target_id: string;
  method: ProviderRuntimeTunnelMethod;
  nonce: string;
  protocol_version: string;
  route: string;
  target_generation: number;
  timestamp_unix_ms: number;
  artifact_upload?: ProviderRuntimeArtifactUpload;
}>): string {
  return JSON.stringify({
    ...(input.artifact_upload ? {
      artifact_upload: {
        final: input.artifact_upload.final,
        metadata_b64u: compact(input.artifact_upload.metadata_b64u),
        offset: input.artifact_upload.offset,
        total_size: input.artifact_upload.total_size,
        upload_id: compact(input.artifact_upload.upload_id),
      },
    } : {}),
    body_sha256: compact(input.body_sha256).toLowerCase(),
    client_key_id: compact(input.client_key_id),
    env_public_id: compact(input.env_public_id),
    lifecycle_target_id: compact(input.lifecycle_target_id),
    method: input.method,
    nonce: compact(input.nonce),
    protocol_version: compact(input.protocol_version),
    route: compact(input.route),
    target_generation: input.target_generation,
    timestamp_unix_ms: input.timestamp_unix_ms,
  });
}

function decodeGatewayTunnelEnvelope(response: ProviderRuntimeTunnelResponse): unknown {
  if (compact(response.protocol_version) !== PROVIDER_PROTOCOL_VERSION) {
    throw new GatewayClientError('PROVIDER_RUNTIME_TUNNEL_INVALID', 'The Provider Runtime management response is invalid.');
  }
  const status = Number(response.status_code);
  if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
    throw new GatewayClientError('PROVIDER_RUNTIME_TUNNEL_INVALID', 'The Provider Runtime management response is invalid.');
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(Buffer.from(compact(response.body_b64u), 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new GatewayClientError('PROVIDER_RUNTIME_TUNNEL_INVALID', 'The Provider Runtime management response is invalid.');
  }
  const candidate = envelope && typeof envelope === 'object' ? envelope as Record<string, unknown> : {};
  if (status < 200 || status >= 300 || candidate.ok !== true) {
    const error = candidate.error && typeof candidate.error === 'object' ? candidate.error as Record<string, unknown> : {};
    throw new GatewayClientError(
      compact(error.code) || 'PROVIDER_RUNTIME_OPERATION_FAILED',
      compact(error.message) || `Provider Runtime management failed (${status}).`,
    );
  }
  return candidate.data;
}

export class ProviderRuntimeLifecycleClient {
  constructor(
    private readonly secretStore: GatewaySecretStore,
    private readonly transport?: DesktopProviderTransport,
  ) {}

  async clientKeyID(scope: ProviderRuntimeLifecycleScope): Promise<string> {
    return (await loadOrCreateProviderRuntimeClientKey(
      this.secretStore,
      scope.provider.provider_origin,
      scope.env_public_id,
    )).client_key_id;
  }

  async prepareRuntimeOperation(scope: ProviderRuntimeLifecycleScope, request: GatewayRuntimeOperationPrepareRequest): Promise<GatewayRuntimeOperationPrepareResponse> {
    const data = await this.request(scope, 'POST', '/gateway/v2/runtime-operations/prepare', {
      protocol_version: 'redeven-gateway-v2',
      ...request,
    });
    return normalizeGatewayRuntimeOperationPrepareResponse(data);
  }

  async getRuntimeOperation(scope: ProviderRuntimeLifecycleScope, operationID: string): Promise<GatewayRuntimeOperation> {
    return normalizeGatewayRuntimeOperation(await this.request(scope, 'GET', runtimeOperationRoute(operationID)));
  }

  async listRuntimeOperations(scope: ProviderRuntimeLifecycleScope, request: GatewayRuntimeOperationListRequest): Promise<GatewayRuntimeOperationListResponse> {
    return normalizeGatewayRuntimeOperationListResponse(await this.request(scope, 'POST', '/gateway/v2/runtime-operations/list', {
      protocol_version: 'redeven-gateway-v2',
      ...request,
    }));
  }

  async confirmRuntimeOperation(scope: ProviderRuntimeLifecycleScope, operationID: string, confirmation: GatewayRuntimeOperationConfirmationRequest): Promise<GatewayRuntimeOperation> {
    return normalizeGatewayRuntimeOperation(await this.request(scope, 'POST', runtimeOperationRoute(operationID, '/confirm'), {
      protocol_version: 'redeven-gateway-v2',
      ...confirmation,
    }));
  }

  async uploadRuntimeOperationArtifact(scope: ProviderRuntimeLifecycleScope, operationID: string, metadata: GatewayRuntimeArtifactMetadata, artifact: Buffer): Promise<GatewayRuntimeOperation> {
    if (metadata.size_bytes !== artifact.length || artifact.length <= 0) {
      throw new GatewayClientError('GATEWAY_RUNTIME_ARTIFACT_SIZE_MISMATCH', 'Runtime artifact size does not match its metadata.');
    }
    const metadataB64u = Buffer.from(JSON.stringify(metadata), 'utf8').toString('base64url');
    const uploadID = `pru_${randomBytes(18).toString('base64url')}`;
    let operation: GatewayRuntimeOperation | null = null;
    for (let offset = 0; offset < artifact.length; offset += PROVIDER_RUNTIME_ARTIFACT_CHUNK_BYTES) {
      const end = Math.min(artifact.length, offset + PROVIDER_RUNTIME_ARTIFACT_CHUNK_BYTES);
      const final = end === artifact.length;
      const data = await this.request(
        scope,
        'PUT',
        runtimeOperationRoute(operationID, '/artifact'),
        artifact.subarray(offset, end),
        {
          upload_id: uploadID,
          offset,
          total_size: artifact.length,
          final,
          metadata_b64u: metadataB64u,
        },
      );
      if (final) {
        operation = normalizeGatewayRuntimeOperation(data);
      }
    }
    if (!operation) {
      throw new GatewayClientError('PROVIDER_RUNTIME_TUNNEL_INVALID', 'The Provider Runtime artifact response is invalid.');
    }
    return operation;
  }

  async commitRuntimeOperation(scope: ProviderRuntimeLifecycleScope, operationID: string): Promise<GatewayRuntimeOperation> {
    return normalizeGatewayRuntimeOperation(await this.request(scope, 'POST', runtimeOperationRoute(operationID, '/commit')));
  }

  async cancelRuntimeOperation(scope: ProviderRuntimeLifecycleScope, operationID: string): Promise<GatewayRuntimeOperation> {
    return normalizeGatewayRuntimeOperation(await this.request(scope, 'POST', runtimeOperationRoute(operationID, '/cancel')));
  }

  async renewRuntimeOperation(scope: ProviderRuntimeLifecycleScope, operationID: string, expiresAtUnixMS: number): Promise<GatewayRuntimeOperation> {
    return normalizeGatewayRuntimeOperation(await this.request(scope, 'POST', runtimeOperationRoute(operationID, '/renew-deadline'), {
      protocol_version: 'redeven-gateway-v2',
      expires_at_unix_ms: Math.floor(expiresAtUnixMS),
    }));
  }

  async reconcileRuntimeOperation(scope: ProviderRuntimeLifecycleScope, operationID: string, request: GatewayRuntimeOperationReconcileRequest): Promise<GatewayRuntimeOperation> {
    return normalizeGatewayRuntimeOperation(await this.request(scope, 'POST', runtimeOperationRoute(operationID, '/reconcile'), {
      protocol_version: 'redeven-gateway-v2',
      ...request,
    }));
  }

  async runtimeOperationEvents(scope: ProviderRuntimeLifecycleScope, operationID: string): Promise<GatewayRuntimeOperationEventsResponse> {
    return normalizeGatewayRuntimeOperationEventsResponse(await this.request(scope, 'GET', runtimeOperationRoute(operationID, '/events')));
  }

  private async request(
    scope: ProviderRuntimeLifecycleScope,
    method: ProviderRuntimeTunnelMethod,
    route: string,
    body: unknown = undefined,
    artifactUpload?: ProviderRuntimeArtifactUpload,
  ): Promise<unknown> {
    const key = await loadOrCreateProviderRuntimeClientKey(
      this.secretStore,
      scope.provider.provider_origin,
      scope.env_public_id,
    );
    const bodyBytes = Buffer.isBuffer(body)
      ? body
      : body === undefined
        ? Buffer.alloc(0)
        : Buffer.from(JSON.stringify(body), 'utf8');
    const timestampUnixMS = Date.now();
    const nonce = randomBytes(24).toString('base64url');
    const bodySHA256 = createHash('sha256').update(bodyBytes).digest('hex');
    const canonical = canonicalProviderRuntimeTunnelPayload({
      body_sha256: bodySHA256,
      client_key_id: key.client_key_id,
      env_public_id: scope.env_public_id,
      lifecycle_target_id: scope.lifecycle_target_id,
      method,
      nonce,
      protocol_version: PROVIDER_PROTOCOL_VERSION,
      route,
      target_generation: scope.target_generation,
      timestamp_unix_ms: timestampUnixMS,
      ...(artifactUpload ? { artifact_upload: artifactUpload } : {}),
    });
    const signature = sign(null, Buffer.from(canonical, 'utf8'), key.private_key).toString('base64url');
    const { body: providerBody } = await fetchProviderJSON(providerRuntimeTunnelURL(scope), {
      method: 'POST',
      bearerToken: scope.access_token,
      body: {
        protocol_version: PROVIDER_PROTOCOL_VERSION,
        env_public_id: compact(scope.env_public_id),
        lifecycle_target_id: compact(scope.lifecycle_target_id),
        target_generation: scope.target_generation,
        client_key_id: key.client_key_id,
        client_public_key: key.public_key,
        method,
        route,
        body_sha256: bodySHA256,
        ...(bodyBytes.length > 0 ? { body_b64u: bodyBytes.toString('base64url') } : {}),
        ...(artifactUpload ? { artifact_upload: artifactUpload } : {}),
        nonce,
        timestamp_unix_ms: timestampUnixMS,
        signature,
      },
      operationLabel: 'the Provider Runtime management tunnel',
      transport: this.transport,
    });
    return decodeGatewayTunnelEnvelope(providerBody as ProviderRuntimeTunnelResponse);
  }
}
