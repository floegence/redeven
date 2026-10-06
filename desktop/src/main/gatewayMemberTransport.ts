import http from 'node:http';
import type net from 'node:net';
import { randomBytes, timingSafeEqual, createHash, X509Certificate, createPublicKey, verify } from 'node:crypto';
import type { Duplex } from 'node:stream';
import {
  createArtifactLease, parseArtifact, createByteStreamDuplex,
  createConnectionController, createConnectionPathAgent,
  type NodeConnectionPath, type ConnectionSnapshot,
} from '@floegence/flowersec-core/node';
import { GATEWAY_ACCESS_STREAM, GATEWAY_PROTOCOL_VERSION, type GatewayMemberOffer, type GatewayMemberService, type GatewayMemberDelegation, type GatewayMemberServiceResponse } from '../shared/gatewayMembership';

export type GatewayMemberTransport = Readonly<{
  origin: string;
  service: GatewayMemberService;
  connectionPath: NodeConnectionPath;
  agent: ReturnType<typeof createConnectionPathAgent>;
  proxyURL: string;
  token: string;
  subscribe: (listener: (snapshot: ConnectionSnapshot) => void) => () => void;
  close: () => Promise<void>;
}>;

export function validateMemberService(service: GatewayMemberService, runtimeID: string): void {
  const id = createHash('sha256').update(runtimeID).digest('hex').slice(0, 40);
  if (!Number.isSafeInteger(service.revision) || service.revision < 1 || service.origin !== `https://r-${id}.redeven.invalid` || service.certificate_pem.length > 16_384) throw new Error('Invalid member origin.');
  const certificate = new X509Certificate(service.certificate_pem);
  const fingerprint = createHash('sha256').update(certificate.raw).digest('hex');
  if (fingerprint !== service.certificate_sha256 || certificate.checkHost(new URL(service.origin).hostname) === undefined
    || Date.parse(certificate.validTo) !== service.expires_at_unix_ms || Date.parse(certificate.validFrom) > Date.now()
    || service.expires_at_unix_ms <= Date.now() || !certificate.verify(certificate.publicKey)) {
    throw new Error('Invalid member service identity.');
  }
}

export function verifyMemberServiceProof(service: GatewayMemberService, delegation: GatewayMemberDelegation, gatewayID: string, memberID: string, runtimeID: string): void {
  validateMemberService(service, runtimeID);
  const member = createHash('sha256').update(`redeven.gateway.member.v4\0${delegation.invitation_id}\0${delegation.public_key_b64u}`).digest('hex').slice(0, 48);
  const rawKey = Buffer.from(delegation.public_key_b64u, 'base64url');
  if (rawKey.length !== 32 || rawKey.toString('base64url') !== delegation.public_key_b64u
    || delegation.protocol_version !== GATEWAY_PROTOCOL_VERSION || delegation.gateway_id !== gatewayID
    || delegation.member_id !== memberID || memberID !== `member_${member}` || delegation.runtime_public_id !== runtimeID
    || !delegation.manage_access || !delegation.manage_cloud_publication || !Number.isSafeInteger(delegation.consented_at_unix_ms)
    || delegation.consented_at_unix_ms <= 0) throw new Error('Invalid member delegation.');
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), rawKey]), format: 'der', type: 'spki' });
  const check = (domain: string, body: unknown, signature: string) => {
    const bytes = Buffer.from(signature, 'base64url');
    if (bytes.length !== 64 || bytes.toString('base64url') !== signature || !verify(null, Buffer.from(`${domain}\0${JSON.stringify(body)}`), key, bytes)) {
      throw new Error('Invalid member proof.');
    }
  };
  check('redeven.gateway.delegation.v4', {
    protocol_version: delegation.protocol_version, gateway_id: delegation.gateway_id, member_id: delegation.member_id,
    runtime_public_id: delegation.runtime_public_id, public_key_b64u: delegation.public_key_b64u,
    invitation_id: delegation.invitation_id, consented_at_unix_ms: delegation.consented_at_unix_ms,
    manage_access: delegation.manage_access, manage_cloud_publication: delegation.manage_cloud_publication, signature: '',
  }, delegation.signature);
  check('redeven.gateway.service.v4', { member_id: memberID, runtime_public_id: runtimeID, service: {
    revision: service.revision, origin: service.origin, certificate_pem: service.certificate_pem, certificate_sha256: service.certificate_sha256,
    expires_at_unix_ms: service.expires_at_unix_ms, signature: '',
  } }, service.signature);
}

/** The public SDK owns carrier selection, TLS, stream framing and reconnection.
 * This adapter restricts every reverse stream to one approved Runtime origin.
 */
export async function createGatewayMemberTransport(options: Readonly<{
  memberID: string;
  memberVersion: number;
  runtimeID: string;
  gatewayID: string;
  gatewayURL: string;
  gatewayTLSRootPEM: string;
  gatewayConnectionPath?: NodeConnectionPath;
  refreshService: (signal: AbortSignal) => Promise<GatewayMemberServiceResponse>;
  acquire: (signal: AbortSignal) => Promise<GatewayMemberOffer>;
  signal?: AbortSignal;
}>): Promise<GatewayMemberTransport> {
  const lifetime = new AbortController();
  const signal = options.signal ? AbortSignal.any([lifetime.signal, options.signal]) : lifetime.signal;
  let service: GatewayMemberService | undefined;
  const serviceRoots: string[] = [];
  const acceptService = (response: GatewayMemberServiceResponse) => {
    if (response.protocol_version !== GATEWAY_PROTOCOL_VERSION || response.member_id !== options.memberID
      || response.member_version !== options.memberVersion) throw new Error('Invalid member service.');
    verifyMemberServiceProof(response.service, response.delegation, options.gatewayID, options.memberID, options.runtimeID);
    if (service && (response.service.revision < service.revision
      || (response.service.revision === service.revision && response.service.certificate_sha256 !== service.certificate_sha256))) {
      throw new Error('Member service identity rolled back.');
    }
    service = response.service;
    serviceRoots.splice(0, serviceRoots.length, service.certificate_pem);
  };
  const controller = createConnectionController({ acquire: async ({ signal }) => {
    try {
      const offer = await options.acquire(signal);
      if (offer.protocol_version !== GATEWAY_PROTOCOL_VERSION || offer.member_id !== options.memberID
        || offer.member_version !== options.memberVersion || !offer.channel_id || offer.expires_at_unix_ms <= Date.now()) {
        return { kind: 'failure', code: 'artifact_invalid', disposition: { kind: 'terminal' } };
      }
      try {
        acceptService(offer);
        const artifact = parseArtifact(JSON.stringify(offer.artifact));
        return { kind: 'lease', lease: createArtifactLease(artifact, async () => {}) };
      } catch {
        return { kind: 'failure', code: 'artifact_invalid', disposition: { kind: 'terminal' } };
      }
    } catch (error) {
      const code = (error as { code?: string }).code;
      const terminal = ['MEMBER_DENIED', 'MEMBER_REMOVED', 'ACCESS_REQUIRED', 'UNAUTHORIZED', 'GATEWAY_INVALID_RESPONSE', 'GATEWAY_PROTOCOL_VERSION_UNSUPPORTED'].includes(code ?? '');
      return { kind: 'failure', code: 'connection_failed', disposition: { kind: terminal ? 'terminal' : 'retryable' } };
    }
  } }, { origin: options.gatewayURL, roots: options.gatewayTLSRootPEM, connectionPath: options.gatewayConnectionPath });
  let agent: ReturnType<typeof createConnectionPathAgent> | undefined;
  let proxy: http.Server | undefined;
  const sockets = new Set<Duplex>();
  const track = <T extends Duplex>(socket: T): T => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => undefined);
    return socket;
  };
  const abort = () => { void close(); };
  let closeTask: Promise<void> | undefined;
  const close = () => closeTask ??= (async () => {
    signal.removeEventListener('abort', abort);
    lifetime.abort();
    agent?.destroy();
    for (const socket of sockets) socket.destroy();
    const closed = proxy ? new Promise<void>(resolve => proxy!.close(() => resolve())) : Promise.resolve();
    await Promise.all([closed, controller.close()]);
  })();
  signal.addEventListener('abort', abort, { once: true });
  controller.start();
  try {
    signal.throwIfAborted();
    await controller.waitForSession({ signal });
    if (!service) throw new Error('Missing Runtime service identity.');
    const trustedService: GatewayMemberService = service;
    const host = new URL(trustedService.origin).hostname;
    const connectionPath: NodeConnectionPath = { connect: async ({ hostname, port, signal: requestSignal }) => {
      if (hostname !== host || port !== 443 || signal.aborted) throw new Error('Gateway member target denied.');
      const operationSignal = AbortSignal.any([signal, requestSignal]);
      const session = await controller.waitForSession({ signal: operationSignal });
      acceptService(await options.refreshService(operationSignal));
      operationSignal.throwIfAborted();
      const stream = await session.openStream(GATEWAY_ACCESS_STREAM, { signal: operationSignal });
      return track(createByteStreamDuplex(stream, operationSignal));
    } };
    agent = createConnectionPathAgent({ connectionPath, ca: serviceRoots, signal });
    // Shell asset probes share a bounded pool and leave room for browser and
    // application streams within the member's common 32-connection budget.
    agent.maxSockets = 6;
    agent.maxTotalSockets = 6;
    agent.maxFreeSockets = 1;
    // Chromium requires a local CONNECT endpoint. It forwards opaque TLS only;
    // all application trust remains in the isolated member browser partition.
    const token = randomBytes(32).toString('base64url');
    const authorization = Buffer.from(`Basic ${Buffer.from(`redeven:${token}`).toString('base64')}`);
    proxy = http.createServer((_request, response) => { response.writeHead(403); response.end(); });
    proxy.on('connection', socket => track(socket));
    proxy.on('connect', (request, socket, head) => {
      const actual = Buffer.from(String(request.headers['proxy-authorization'] ?? ''));
      if (actual.length !== authorization.length || !timingSafeEqual(actual, authorization)) {
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="Redeven Gateway"\r\nContent-Length: 0\r\n\r\n'); return;
      }
      if (request.url !== `${host}:443`) { socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'); return; }
      const requestLifetime = new AbortController();
      socket.once('close', () => requestLifetime.abort());
      void connectionPath.connect({ hostname: host, port: 443, signal: requestLifetime.signal }).then(remote => {
        if (socket.destroyed) { remote.destroy(); return; }
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) remote.write(head);
        socket.pipe(remote).pipe(socket);
        socket.once('close', () => remote.destroy());
        remote.once('close', () => socket.destroy());
      }, () => { socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n'); });
    });
    await new Promise<void>((resolve, reject) => { proxy!.once('error', reject); proxy!.listen(0, '127.0.0.1', resolve); });
    if (signal.aborted) throw new Error('Gateway member access canceled.');
    const address = proxy.address() as net.AddressInfo;
    return { origin: trustedService.origin, get service() { return service!; }, connectionPath, agent,
      proxyURL: `http://127.0.0.1:${address.port}`, token, subscribe: listener => controller.subscribe(listener), close };
  } catch (error) { await close(); throw error; }
}
