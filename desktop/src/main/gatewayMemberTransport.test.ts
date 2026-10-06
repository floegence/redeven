import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { once } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createGatewayMemberTransport, verifyMemberServiceProof } from './gatewayMemberTransport';
import type { GatewayMemberOffer, GatewayMemberServiceResponse } from '../shared/gatewayMembership';

/** This suite exercises the published Node SDK against a real Go member owner. */
describe.runIf(process.env.REDEVEN_GATEWAY_INTEROP === '1')('Gateway Go/Node reverse access', () => {
  it('carries TLS through outbound membership, confines targets, closes on removal and cancels its listener', async () => {
    const peer = spawn('go', ['run', './internal/gatewaymembership/testpeer'], {
      cwd: path.resolve(__dirname, '../../..'), env: { ...process.env, GOWORK: 'off' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: peer.stdout });
    const exit = once(peer, 'exit');
    let phase = 'starting';
    let diagnostics = '';
    peer.stderr.on('data', chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4096); });
    let id = 0;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
    let readyResolve!: (value: Record<string, unknown>) => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<Record<string, unknown>>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const fail = () => { readyReject(new Error('Go peer stopped')); for (const request of pending.values()) request.reject(new Error('Go peer stopped')); pending.clear(); };
    peer.once('error', fail); peer.once('exit', fail);
    lines.on('line', line => {
      const result = JSON.parse(line) as Record<string, unknown>;
      if (result.ready) { readyResolve(result); return; }
      const request = pending.get(Number(result.id)); pending.delete(Number(result.id));
      if (result.error) request?.reject(new Error(String(result.error))); else request?.resolve(result.data);
    });
    const command = (action: string) => new Promise<unknown>((resolve, reject) => {
      const next = ++id; pending.set(next, { resolve, reject }); peer.stdin.write(`${JSON.stringify({ id: next, action })}\n`);
    });
    const lifetime = new AbortController();
    let transport: Awaited<ReturnType<typeof createGatewayMemberTransport>> | undefined;
    try {
      const data = await ready;
      const offer = await command('offer') as GatewayMemberOffer;
      verifyMemberServiceProof(offer.service, offer.delegation, String(data.gateway_id), String(data.member_id), String(data.runtime_id));
      expect(() => verifyMemberServiceProof(offer.service, { ...offer.delegation, manage_cloud_publication: false }, String(data.gateway_id), String(data.member_id), String(data.runtime_id))).toThrow();
      expect(() => verifyMemberServiceProof({ ...offer.service, certificate_sha256: '0'.repeat(64) }, offer.delegation, String(data.gateway_id), String(data.member_id), String(data.runtime_id))).toThrow();
      transport = await createGatewayMemberTransport({
        memberID: String(data.member_id), memberVersion: Number(data.member_version), runtimeID: String(data.runtime_id),
        gatewayID: String(data.gateway_id), gatewayURL: String(data.gateway_url), gatewayTLSRootPEM: String(data.gateway_tls_root_pem),
        signal: lifetime.signal, refreshService: async () => await command('service') as GatewayMemberServiceResponse, acquire: async () => await command('offer') as GatewayMemberOffer,
      });
      const owner = transport;
      const fetch = (path: string, body?: string, keepAlive = false) => new Promise<string>((resolve, reject) => {
        const request = https.request(new URL(path, owner.origin), { headers: { Connection: keepAlive ? 'keep-alive' : 'close' }, agent: owner.agent, method: body ? 'POST' : 'GET', timeout: 5000 }, response => {
          const chunks: Buffer[] = []; response.on('data', data => chunks.push(data)); response.once('error', reject);
          response.once('end', () => resolve(Buffer.concat(chunks).toString()));
        });
        request.once('error', reject); request.once('timeout', () => request.destroy(new Error('timeout'))); request.end(body);
      });
      phase = 'application request';
      expect(await fetch('/app')).toBe('private-runtime-content');
      expect(await fetch('/echo', 'Unicode payload: café')).toBe('Unicode payload: café');
      phase = 'concurrent application requests';
      expect(await Promise.all(Array.from({ length: 64 }, () => fetch('/app', undefined, true))))
        .toEqual(Array(64).fill('private-runtime-content'));
      await expect(owner.connectionPath.connect({ hostname: 'public.example', port: 443, signal: lifetime.signal })).rejects.toThrow('denied');
      const connect = (target: string, authorized: boolean) => new Promise<number>((resolve, reject) => {
        const request = http.request(owner.proxyURL, { method: 'CONNECT', path: target, headers: authorized ? {
          'Proxy-Authorization': `Basic ${Buffer.from(`redeven:${owner.token}`).toString('base64')}`,
        } : {} });
        request.once('connect', (response, socket) => { socket.destroy(); resolve(response.statusCode!); });
        request.once('error', reject); request.end();
      });
      expect(await connect('public.example:443', true)).toBe(403);
      expect(await connect(`${new URL(owner.origin).hostname}:443`, false)).toBe(407);
      phase = 'streaming request';
      const streaming = https.get(new URL('/stream', owner.origin), { agent: owner.agent });
      const [stream] = await once(streaming, 'response');
      await once(stream, 'data');
      const previousRevision = owner.service.revision;
      phase = 'rotation';
      await command('rotate');
      phase = 'application after rotation';
      expect(await fetch('/app')).toBe('private-runtime-content');
      expect(owner.service.revision).toBe(previousRevision + 1);
      expect(stream.destroyed).toBe(false);
      streaming.destroy();
      await command('remove');
      await expect(fetch('/app')).rejects.toThrow();
      lifetime.abort(); await owner.close();
      const socket = net.connect(Number(new URL(owner.proxyURL).port), '127.0.0.1');
      const [error] = await once(socket, 'error');
      expect(error.code).toBe('ECONNREFUSED'); socket.destroy();
    } catch (error) { throw new Error(`Member interop failed during ${phase}: ${diagnostics}`, { cause: error });
    } finally {
      lifetime.abort(); await transport?.close(); peer.stdin.end();
      peer.kill('SIGTERM'); await exit; lines.close();
    }
  }, 60_000);
});
