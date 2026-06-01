import http from 'node:http';
import { randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { GatewayBridgeClient, GatewayURLClient, redactGatewayDiagnosticValue } from './gatewayClient';
import {
  createGatewayPairingMaterial,
  gatewayConnectArtifactProofPayload,
  signGatewayPayload,
  type GatewaySecretStore,
} from './gatewayTrust';
import type { GatewayRecord } from './gatewayStore';
import type { RuntimePlacementBridgeSessionHandle } from './runtimePlacementBridgeSession';

type TestServer = Readonly<{
  baseURL: string;
  requests: Array<Readonly<{
    url: string;
    headers: http.IncomingHttpHeaders;
    body: string;
  }>>;
  close: () => Promise<void>;
}>;

type CapturedBridgeRequest = Readonly<{
  surface: string;
  raw: string;
  requestLine: string;
  headers: Record<string, string>;
  body: string;
}>;

function memorySecretStore(values = new Map<string, string>()): GatewaySecretStore {
  return {
    writeSecret: (key, value) => {
      values.set(key, value);
    },
    readSecret: (key) => values.get(key) ?? '',
    deleteSecret: (key) => {
      values.delete(key);
    },
  };
}

async function startServer(handler: (request: http.IncomingMessage, body: string, response: http.ServerResponse) => void): Promise<TestServer> {
  const requests: TestServer['requests'] = [];
  const server = http.createServer((request, response) => {
    request.setEncoding('utf8');
    let body = '';
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      requests.push({ url: request.url ?? '', headers: request.headers, body });
      handler(request, body, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address.');
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}/`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}

function pairedURLRecord(baseURL: string, allowLoopbackHTTP = true): Readonly<{
  record: GatewayRecord;
  secretStore: GatewaySecretStore;
  gatewayPrivateKey: string;
}> {
  const base: GatewayRecord = {
    schema_version: 1,
    gateway_id: 'gw_demo',
    display_name: 'Demo Gateway',
    connection: {
      kind: 'url',
      base_url: baseURL,
      allow_loopback_http: allowLoopbackHTTP,
    },
    created_at_ms: 1,
    updated_at_ms: 1,
  };
  const material = createGatewayPairingMaterial(base);
  const gatewayMaterial = createGatewayPairingMaterial(base);
  const values = new Map([[material.private_key_ref, material.client_private_key]]);
  return {
    secretStore: memorySecretStore(values),
    gatewayPrivateKey: gatewayMaterial.client_private_key,
    record: {
      ...base,
      trust_profile: {
        trust_profile_id: 'gtp_demo',
        paired_client_key_id: material.client_key_id,
        paired_client_private_key_ref: material.private_key_ref,
        gateway_id: 'gw_demo',
        gateway_public_key: gatewayMaterial.client_public_key,
        gateway_public_key_fingerprint: 'SHA256:dummy-fingerprint',
        binding_audience: baseURL,
        created_at_unix_ms: 1,
      },
    },
  };
}

function signedGatewayFingerprint(record: GatewayRecord): string {
  return record.trust_profile?.gateway_public_key_fingerprint ?? '';
}

function gatewayArtifactProof(args: Readonly<{
  privateKey: string;
  record: GatewayRecord;
  gatewayEnvID: string;
  gatewaySessionID: string;
  requestedCapability: 'env_app' | 'terminal' | 'files' | 'web_service' | 'port_forward';
  clientNonce: string;
  artifact: Readonly<{
    kind: 'local_direct_artifact' | 'desktop_bridge_artifact';
    url?: string;
    bridge_session_id?: string;
    route_id?: string;
    expires_at_unix_ms: number;
    artifact_nonce: string;
  }>;
}>): string {
  return signGatewayPayload(args.privateKey, gatewayConnectArtifactProofPayload({
    gateway_id: args.record.gateway_id,
    gateway_env_id: args.gatewayEnvID,
    gateway_session_id: args.gatewaySessionID,
    binding_audience: args.record.trust_profile?.binding_audience ?? '',
    requested_capability: args.requestedCapability,
    client_nonce: args.clientNonce,
    artifact_kind: args.artifact.kind,
    artifact_url: args.artifact.url,
    bridge_session_id: args.artifact.bridge_session_id,
    route_id: args.artifact.route_id,
    expires_at_unix_ms: args.artifact.expires_at_unix_ms,
    artifact_nonce: args.artifact.artifact_nonce,
  }));
}

function parseCapturedHTTPRequest(raw: string, surface: string): CapturedBridgeRequest {
  const headerEnd = raw.indexOf('\r\n\r\n');
  const head = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw;
  const body = headerEnd >= 0 ? raw.slice(headerEnd + 4) : '';
  const [requestLine = '', ...headerLines] = head.split('\r\n');
  const headers = Object.fromEntries(headerLines
    .map((line) => {
      const separator = line.indexOf(':');
      return separator >= 0
        ? [line.slice(0, separator).trim().toLowerCase(), line.slice(separator + 1).trim()]
        : ['', ''];
    })
    .filter(([key]) => key !== ''));
  return { surface, raw, requestLine, headers, body };
}

function bridgeHTTPResponse(data: unknown, statusCode = 200): Buffer {
  const body = JSON.stringify(statusCode >= 400 ? data : { ok: true, data });
  return Buffer.from([
    `HTTP/1.1 ${statusCode} ${statusCode === 200 ? 'OK' : 'Error'}`,
    'Content-Type: application/json',
    `Content-Length: ${Buffer.byteLength(body, 'utf8')}`,
    'Connection: close',
    '',
    body,
  ].join('\r\n'), 'utf8');
}

function bridgePairingChallengeResponse(args: Readonly<{
  material: ReturnType<typeof createGatewayPairingMaterial>;
  gatewayID: string;
  gatewayPrivateKey: string;
  gatewayPublicKey: string;
  gatewayNonce: string;
}>): unknown {
  const expiresAt = Date.now() + 60_000;
  const payload = JSON.stringify({
    binding_audience: args.material.binding_audience,
    client_nonce: args.material.client_nonce,
    client_public_key: args.material.client_public_key,
    expires_at_unix_ms: expiresAt,
    gateway_id: args.gatewayID,
    gateway_nonce: args.gatewayNonce,
    gateway_public_key: args.gatewayPublicKey,
    protocol_version: 'redeven-runtime-gateway-v1',
  });
  return {
    protocol_version: 'redeven-runtime-gateway-v1',
    gateway_id: args.gatewayID,
    gateway_public_key: args.gatewayPublicKey,
    gateway_nonce: args.gatewayNonce,
    expires_at_unix_ms: expiresAt,
    signature: signGatewayPayload(args.gatewayPrivateKey, payload),
  };
}

function createBridgeHandle(handler: (request: CapturedBridgeRequest) => Buffer): Readonly<{
  bridge: RuntimePlacementBridgeSessionHandle;
  requests: CapturedBridgeRequest[];
}> {
  const requests: CapturedBridgeRequest[] = [];
  return {
    requests,
    bridge: {
      openStream: (surface) => {
        let dataCallback: ((chunk: Buffer) => void | Promise<void>) | undefined;
        let closeCallback: (() => void) | undefined;
        let errorCallback: ((error: Error) => void) | undefined;
        return {
          id: `${surface}-1`,
          onData: (callback) => {
            dataCallback = callback;
          },
          onClose: (callback) => {
            closeCallback = callback;
          },
          onError: (callback) => {
            errorCallback = callback;
          },
          write: async (chunk) => {
            try {
              const request = parseCapturedHTTPRequest(chunk.toString('utf8'), surface);
              requests.push(request);
              await dataCallback?.(handler(request));
              closeCallback?.();
            } catch (error) {
              errorCallback?.(error instanceof Error ? error : new Error(String(error)));
            }
          },
          close: async () => undefined,
        };
      },
    },
  };
}

describe('GatewayURLClient', () => {
  const cleanupServers = new Set<TestServer>();

  afterEach(async () => {
    await Promise.all(Array.from(cleanupServers, async (server) => {
      await server.close();
      cleanupServers.delete(server);
    }));
  });

  it('fetches catalog over authenticated loopback URL without bearer credentials', async () => {
    let record!: GatewayRecord;
    const server = await startServer((_request, _body, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        data: {
          protocol_version: 'redeven-runtime-gateway-v1',
          gateway: {
            gateway_id: 'gw_demo',
            display_name: 'Demo Gateway',
            status: 'online',
            capabilities: ['env_catalog', 'env_open_session'],
            gateway_public_key_fingerprint: signedGatewayFingerprint(record),
          },
          environments: [{
            gateway_env_id: 'env_demo',
            display_name: 'Demo Env',
            env_kind: 'reachable_env',
            state: 'available',
            capabilities: ['open', 'unexpected'],
            origin: { kind: 'network_target', label: '10.0.0.10' },
          }],
        },
      }));
    });
    cleanupServers.add(server);
    const paired = pairedURLRecord(server.baseURL);
    record = paired.record;

    const catalog = await new GatewayURLClient(paired.secretStore).catalog(record);

    expect(catalog.environments).toEqual([expect.objectContaining({
      gateway_env_id: 'env_demo',
      capabilities: ['open'],
    })]);
    expect(catalog.gateway.status).toBe('online');
    expect(server.requests[0]?.url).toBe('/gateway/v1/catalog');
    expect(server.requests[0]?.headers.authorization).toBeUndefined();
    expect(server.requests[0]?.headers['x-redeven-request-signature']).toBeTruthy();
    expect(server.requests[0]?.body).toContain('redeven-runtime-gateway-v1');
  });

  it('rejects non-loopback HTTP Gateway URLs', async () => {
    const { record, secretStore } = pairedURLRecord('http://gateway.example/', false);
    await expect(new GatewayURLClient(secretStore).catalog(record)).rejects.toMatchObject({
      code: 'GATEWAY_URL_INSECURE',
    });
  });

  it('rejects non-loopback HTTP even when loopback development mode is enabled', async () => {
    for (const baseURL of [
      'http://192.168.1.20:24000/',
      'http://localhost.evil.test/',
    ]) {
      const { record, secretStore } = pairedURLRecord(baseURL, true);
      await expect(new GatewayURLClient(secretStore).catalog(record)).rejects.toMatchObject({
        code: 'GATEWAY_URL_INSECURE',
      });
    }
  });

  it('rejects catalog responses with non-exact protocol versions', async () => {
    for (const protocolVersion of ['', ' redeven-runtime-gateway-v1 ', 'v0']) {
      let record!: GatewayRecord;
      const server = await startServer((_request, _body, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          ok: true,
          data: {
            protocol_version: protocolVersion,
            gateway: {
              gateway_id: 'gw_demo',
              display_name: 'Demo Gateway',
              status: 'online',
              capabilities: ['env_catalog'],
              gateway_public_key_fingerprint: signedGatewayFingerprint(record),
            },
            environments: [],
          },
        }));
      });
      cleanupServers.add(server);
      const paired = pairedURLRecord(server.baseURL);
      record = paired.record;

      await expect(new GatewayURLClient(paired.secretStore).catalog(record)).rejects.toMatchObject({
        code: 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED',
      });
    }
  });

  it('rejects catalog identity changes before using environments', async () => {
    const server = await startServer((_request, _body, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        data: {
          protocol_version: 'redeven-runtime-gateway-v1',
          gateway: { gateway_id: 'gw_other', display_name: 'Other Gateway', capabilities: [] },
          environments: [],
        },
      }));
    });
    cleanupServers.add(server);
    const { record, secretStore } = pairedURLRecord(server.baseURL);
    await expect(new GatewayURLClient(secretStore).catalog(record)).rejects.toMatchObject({
      code: 'GATEWAY_ID_MISMATCH',
    });
  });

  it('requires the pinned Gateway fingerprint on authenticated catalog responses', async () => {
    const server = await startServer((_request, _body, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        data: {
          protocol_version: 'redeven-runtime-gateway-v1',
          gateway: {
            gateway_id: 'gw_demo',
            display_name: 'Demo Gateway',
            status: 'online',
            capabilities: ['env_catalog'],
          },
          environments: [{
            gateway_env_id: 'env_demo',
            display_name: 'Demo Env',
            env_kind: 'reachable_env',
            state: 'available',
            capabilities: ['open'],
            origin: { kind: 'network_target', label: '10.0.0.10' },
          }],
        },
      }));
    });
    cleanupServers.add(server);
    const { record, secretStore } = pairedURLRecord(server.baseURL);

    await expect(new GatewayURLClient(secretStore).catalog(record)).rejects.toMatchObject({
      code: 'GATEWAY_FINGERPRINT_REQUIRED',
    });
  });

  it('rejects pinned Gateway fingerprint changes before returning catalog environments', async () => {
    const server = await startServer((_request, _body, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        data: {
          protocol_version: 'redeven-runtime-gateway-v1',
          gateway: {
            gateway_id: 'gw_demo',
            display_name: 'Demo Gateway',
            status: 'online',
            capabilities: ['env_catalog'],
            gateway_public_key_fingerprint: 'SHA256:changed-fingerprint',
          },
          environments: [{
            gateway_env_id: 'env_demo',
            display_name: 'Demo Env',
            env_kind: 'reachable_env',
            state: 'available',
            capabilities: ['open'],
            origin: { kind: 'network_target', label: '10.0.0.10' },
          }],
        },
      }));
    });
    cleanupServers.add(server);
    const { record, secretStore } = pairedURLRecord(server.baseURL);

    await expect(new GatewayURLClient(secretStore).catalog(record)).rejects.toMatchObject({
      code: 'GATEWAY_TRUST_CHANGED',
    });
  });

  it('does not reflect Gateway error bodies or messages into thrown errors', async () => {
    for (const payload of [
      'plain proof-secret signature-secret private_key-secret',
      JSON.stringify({
        ok: false,
        error: {
          code: 'GATEWAY_REFLECTED_SECRET',
          message: 'proof-secret signature-secret private_key-secret',
        },
      }),
    ]) {
      const server = await startServer((_request, _body, response) => {
        response.statusCode = 502;
        response.setHeader('Content-Type', 'application/json');
        response.end(payload);
      });
      cleanupServers.add(server);
      const { record, secretStore } = pairedURLRecord(server.baseURL);

      let message = '';
      try {
        await new GatewayURLClient(secretStore).catalog(record);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).not.toContain('proof-secret');
      expect(message).not.toContain('signature-secret');
      expect(message).not.toContain('private_key-secret');
    }
  });

  it('uses Gateway redacted_detail as the only Gateway-provided error copy', async () => {
    const server = await startServer((_request, _body, response) => {
      response.statusCode = 400;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        ok: false,
        error: {
          code: 'INVALID_REQUEST',
          message: 'proof-secret',
          redacted_detail: 'Gateway request was rejected.',
        },
      }));
    });
    cleanupServers.add(server);
    const { record, secretStore } = pairedURLRecord(server.baseURL);

    await expect(new GatewayURLClient(secretStore).catalog(record)).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
      message: 'Gateway request was rejected.',
    });
  });

  it('validates open-session artifacts and requested environment correlation', async () => {
    let record!: GatewayRecord;
    let gatewayPrivateKey = '';
    const gatewaySessionID = 'gws_demo';
    const gatewayEnvID = 'env_demo';
    const requestedCapability = 'env_app' as const;
    const clientNonce = 'client-nonce';
    const server = await startServer((_request, _body, response) => {
      const artifact = {
        kind: 'desktop_bridge_artifact' as const,
        bridge_session_id: 'bridge_demo',
        route_id: 'route_demo',
        expires_at_unix_ms: Date.now() + 60_000,
        artifact_nonce: randomBytes(8).toString('hex'),
      };
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        data: {
          protocol_version: 'redeven-runtime-gateway-v1',
          gateway_session_id: gatewaySessionID,
          gateway_env_id: gatewayEnvID,
          connect_artifact: {
            ...artifact,
            proof: gatewayArtifactProof({
              privateKey: gatewayPrivateKey,
              record,
              gatewayEnvID,
              gatewaySessionID,
              requestedCapability,
              clientNonce,
              artifact,
            }),
          },
        },
      }));
    });
    cleanupServers.add(server);
    const paired = pairedURLRecord(server.baseURL);
    record = paired.record;
    gatewayPrivateKey = paired.gatewayPrivateKey;

    const response = await new GatewayURLClient(paired.secretStore).openSession(record, {
      gateway_env_id: gatewayEnvID,
      requested_capability: requestedCapability,
      client_nonce: clientNonce,
    });

    expect(response.connect_artifact).toMatchObject({
      kind: 'desktop_bridge_artifact',
      bridge_session_id: 'bridge_demo',
      route_id: 'route_demo',
    });
    expect(server.requests[0]?.url).toBe('/gateway/v1/open-session');
  });

  it('accepts URL Gateway direct artifacts only on the paired Gateway origin without URL-carried secrets', async () => {
    for (const artifactURL of [
      'http://127.0.0.1:1/_redeven_proxy/env/',
      'http://user:pass@127.0.0.1:1/_redeven_proxy/env/',
      'http://127.0.0.1:1/_redeven_proxy/env/?token=secret',
      'http://127.0.0.1:1/_redeven_proxy/env/#proof',
    ]) {
      let record!: GatewayRecord;
      let gatewayPrivateKey = '';
      const gatewaySessionID = 'gws_demo';
      const gatewayEnvID = 'env_demo';
      const requestedCapability = 'env_app' as const;
      const clientNonce = 'client-nonce';
      const server = await startServer((_request, _body, response) => {
        const artifact = {
          kind: 'local_direct_artifact' as const,
          url: artifactURL,
          expires_at_unix_ms: Date.now() + 60_000,
          artifact_nonce: randomBytes(8).toString('hex'),
        };
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          ok: true,
          data: {
            protocol_version: 'redeven-runtime-gateway-v1',
            gateway_session_id: gatewaySessionID,
            gateway_env_id: gatewayEnvID,
            connect_artifact: {
              ...artifact,
              proof: gatewayArtifactProof({
                privateKey: gatewayPrivateKey,
                record,
                gatewayEnvID,
                gatewaySessionID,
                requestedCapability,
                clientNonce,
                artifact,
              }),
            },
          },
        }));
      });
      cleanupServers.add(server);
      const paired = pairedURLRecord(server.baseURL);
      record = paired.record;
      gatewayPrivateKey = paired.gatewayPrivateKey;

      await expect(new GatewayURLClient(paired.secretStore).openSession(record, {
        gateway_env_id: gatewayEnvID,
        requested_capability: requestedCapability,
        client_nonce: clientNonce,
      })).rejects.toMatchObject({ code: 'GATEWAY_INVALID_ARTIFACT' });
    }

    let artifactURL = '';
    let record!: GatewayRecord;
    let gatewayPrivateKey = '';
    const gatewaySessionID = 'gws_demo';
    const gatewayEnvID = 'env_demo';
    const requestedCapability = 'env_app' as const;
    const clientNonce = 'client-nonce';
    const server = await startServer((_request, _body, response) => {
      const artifact = {
        kind: 'local_direct_artifact' as const,
        url: artifactURL,
        expires_at_unix_ms: Date.now() + 60_000,
        artifact_nonce: randomBytes(8).toString('hex'),
      };
      response.setHeader('Set-Cookie', 'redeven_local_access=session-secret; Path=/; HttpOnly; SameSite=Lax');
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        data: {
          protocol_version: 'redeven-runtime-gateway-v1',
          gateway_session_id: gatewaySessionID,
          gateway_env_id: gatewayEnvID,
          connect_artifact: {
            ...artifact,
            proof: gatewayArtifactProof({
              privateKey: gatewayPrivateKey,
              record,
              gatewayEnvID,
              gatewaySessionID,
              requestedCapability,
              clientNonce,
              artifact,
            }),
          },
        },
      }));
    });
    cleanupServers.add(server);
    const paired = pairedURLRecord(server.baseURL);
    artifactURL = `${server.baseURL}_redeven_proxy/env/`;
    record = paired.record;
    gatewayPrivateKey = paired.gatewayPrivateKey;

    const response = await new GatewayURLClient(paired.secretStore).openSession(record, {
      gateway_env_id: gatewayEnvID,
      requested_capability: requestedCapability,
      client_nonce: clientNonce,
    });

    expect(response.connect_artifact).toMatchObject({
      kind: 'local_direct_artifact',
      url: `${server.baseURL}_redeven_proxy/env/`,
    });
    expect(response.set_cookie_headers).toEqual([
      'redeven_local_access=session-secret; Path=/; HttpOnly; SameSite=Lax',
    ]);
  });

  it('rejects expired artifacts and mismatched open-session environment ids', async () => {
    let record!: GatewayRecord;
    let gatewayPrivateKey = '';
    const server = await startServer((_request, _body, response) => {
      const artifact = {
        kind: 'local_direct_artifact' as const,
        url: 'https://gateway.example/session',
        expires_at_unix_ms: Date.now() - 1,
        artifact_nonce: 'nonce',
      };
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        data: {
          protocol_version: 'redeven-runtime-gateway-v1',
          gateway_session_id: 'gws_demo',
          gateway_env_id: 'env_other',
          connect_artifact: {
            ...artifact,
            proof: gatewayArtifactProof({
              privateKey: gatewayPrivateKey,
              record,
              gatewayEnvID: 'env_other',
              gatewaySessionID: 'gws_demo',
              requestedCapability: 'env_app',
              clientNonce: 'client-nonce',
              artifact,
            }),
          },
        },
      }));
    });
    cleanupServers.add(server);
    const paired = pairedURLRecord(server.baseURL);
    record = paired.record;
    gatewayPrivateKey = paired.gatewayPrivateKey;

    await expect(new GatewayURLClient(paired.secretStore).openSession(record, {
      gateway_env_id: 'env_demo',
      requested_capability: 'env_app',
      client_nonce: 'client-nonce',
    })).rejects.toMatchObject({ code: 'GATEWAY_INVALID_ARTIFACT' });
  });

  it('rejects open-session responses with non-exact protocol versions', async () => {
    let record!: GatewayRecord;
    let gatewayPrivateKey = '';
    const artifact = {
      kind: 'desktop_bridge_artifact' as const,
      bridge_session_id: 'bridge_demo',
      route_id: 'route_demo',
      expires_at_unix_ms: Date.now() + 60_000,
      artifact_nonce: 'artifact-nonce',
    };
    const server = await startServer((_request, _body, response) => {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        ok: true,
        data: {
          protocol_version: ' redeven-runtime-gateway-v1 ',
          gateway_session_id: 'gws_demo',
          gateway_env_id: 'env_demo',
          connect_artifact: {
            ...artifact,
            proof: gatewayArtifactProof({
              privateKey: gatewayPrivateKey,
              record,
              gatewayEnvID: 'env_demo',
              gatewaySessionID: 'gws_demo',
              requestedCapability: 'env_app',
              clientNonce: 'client-nonce',
              artifact,
            }),
          },
        },
      }));
    });
    cleanupServers.add(server);
    const paired = pairedURLRecord(server.baseURL);
    record = paired.record;
    gatewayPrivateKey = paired.gatewayPrivateKey;

    await expect(new GatewayURLClient(paired.secretStore).openSession(record, {
      gateway_env_id: 'env_demo',
      requested_capability: 'env_app',
      client_nonce: 'client-nonce',
    })).rejects.toMatchObject({ code: 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED' });
  });

  it('redacts proof, signatures, private keys, and tokens from diagnostics', () => {
    expect(redactGatewayDiagnosticValue({
      proof: 'proof-secret',
      signature: 'signature-secret',
      private_key: 'PRIVATE KEY',
      nested: {
        authorization: 'Bearer runtime-control-token',
        safe: 'visible',
      },
    })).toEqual({
      proof: '[redacted]',
      signature: '[redacted]',
      private_key: '[redacted]',
      nested: {
        authorization: '[redacted]',
        safe: 'visible',
      },
    });
  });
});

describe('GatewayBridgeClient', () => {
  it('fetches catalog through the gateway_protocol bridge with signed binding audience headers', async () => {
    const paired = pairedURLRecord('https://gateway.example/');
    const harness = createBridgeHandle(() => bridgeHTTPResponse({
      protocol_version: 'redeven-runtime-gateway-v1',
      gateway: {
        gateway_id: 'gw_demo',
        display_name: 'Demo Gateway',
        status: 'online',
        capabilities: ['env_catalog'],
        gateway_public_key_fingerprint: signedGatewayFingerprint(paired.record),
      },
      environments: [{
        gateway_env_id: 'env_demo',
        display_name: 'Demo Env',
        env_kind: 'reachable_env',
        state: 'available',
        capabilities: ['open'],
        origin: { kind: 'network_target', label: '10.0.0.10' },
      }],
    }));

    const catalog = await new GatewayBridgeClient(paired.secretStore, harness.bridge).catalog(paired.record);

    expect(catalog.environments).toHaveLength(1);
    expect(harness.requests[0]).toMatchObject({
      surface: 'gateway_protocol',
      requestLine: 'POST /gateway/v1/catalog HTTP/1.1',
    });
    expect(harness.requests[0]?.headers.authorization).toBeUndefined();
    expect(harness.requests[0]?.headers['x-redeven-gateway-transport']).toBe('desktop_bridge');
    expect(harness.requests[0]?.headers['x-redeven-gateway-binding-audience']).toBe('https://gateway.example/');
    expect(harness.requests[0]?.headers['x-redeven-request-signature']).toBeTruthy();
  });

  it('uses unauthenticated gateway_protocol bridge requests for pairing', async () => {
    const base: GatewayRecord = {
      schema_version: 1,
      gateway_id: 'gw_demo',
      display_name: 'Demo Gateway',
      connection: {
        kind: 'ssh_host',
        ssh_destination: 'bastion',
        runtime_root: '/opt/redeven',
      },
      created_at_ms: 1,
      updated_at_ms: 1,
    };
    const clientMaterial = createGatewayPairingMaterial(base);
    const gatewayMaterial = createGatewayPairingMaterial(base);
    const harness = createBridgeHandle(() => bridgeHTTPResponse(bridgePairingChallengeResponse({
      material: clientMaterial,
      gatewayID: base.gateway_id,
      gatewayPrivateKey: gatewayMaterial.client_private_key,
      gatewayPublicKey: gatewayMaterial.client_public_key,
      gatewayNonce: 'gateway-nonce',
    })));

    const response = await new GatewayBridgeClient(memorySecretStore(), harness.bridge).pairingChallenge(base, {
      protocol_version: 'redeven-runtime-gateway-v1',
      client_nonce: clientMaterial.client_nonce,
      client_public_key: clientMaterial.client_public_key,
      binding_audience: clientMaterial.binding_audience,
    });

    expect(response.gateway_id).toBe('gw_demo');
    expect(harness.requests[0]).toMatchObject({
      surface: 'gateway_protocol',
      requestLine: 'POST /gateway/v1/pairing/challenge HTTP/1.1',
    });
    expect(harness.requests[0]?.headers['x-redeven-request-signature']).toBeUndefined();
    expect(harness.requests[0]?.headers['x-redeven-gateway-binding-audience']).toBeUndefined();
    expect(harness.requests[0]?.body).toContain('ssh://bastion:22/opt/redeven');
  });

  it('opens sessions through the gateway_protocol bridge without direct URL transport', async () => {
    const paired = pairedURLRecord('https://gateway.example/');
    const artifact = {
      kind: 'desktop_bridge_artifact' as const,
      bridge_session_id: 'bridge_demo',
      route_id: 'route_demo',
      expires_at_unix_ms: Date.now() + 60_000,
      artifact_nonce: randomBytes(8).toString('hex'),
    };
    const harness = createBridgeHandle(() => bridgeHTTPResponse({
      protocol_version: 'redeven-runtime-gateway-v1',
      gateway_session_id: 'gws_demo',
      gateway_env_id: 'env_demo',
      connect_artifact: {
        ...artifact,
        proof: gatewayArtifactProof({
          privateKey: paired.gatewayPrivateKey,
          record: paired.record,
          gatewayEnvID: 'env_demo',
          gatewaySessionID: 'gws_demo',
          requestedCapability: 'env_app',
          clientNonce: 'client-nonce',
          artifact,
        }),
      },
    }));

    const response = await new GatewayBridgeClient(paired.secretStore, harness.bridge).openSession(paired.record, {
      gateway_env_id: 'env_demo',
      requested_capability: 'env_app',
      client_nonce: 'client-nonce',
      bridge_session_id: 'bridge_demo',
      route_id: 'route_demo',
    });

    expect(response.connect_artifact.kind).toBe('desktop_bridge_artifact');
    expect(harness.requests[0]).toMatchObject({
      surface: 'gateway_protocol',
      requestLine: 'POST /gateway/v1/open-session HTTP/1.1',
    });
    expect(harness.requests[0]?.headers.host).toBe('redeven-gateway.local');
    expect(harness.requests[0]?.headers['x-redeven-gateway-binding-audience']).toBe('https://gateway.example/');
    expect(JSON.parse(harness.requests[0]?.body ?? '{}')).toMatchObject({
      bridge_session_id: 'bridge_demo',
      route_id: 'route_demo',
    });
    expect(harness.requests[0]?.raw).not.toContain('provider');
    expect(harness.requests[0]?.raw).not.toContain('__redeven_runtime_control');
  });
});
