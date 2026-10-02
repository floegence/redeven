import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { BrowserWindow } from 'electron';
import { createGatewayProxyTransport, type GatewayProxyTransport } from '../../src/main/gatewayProxyTransport';
import type { GatewayURLClient } from '../../src/main/gatewayClient';
import type { GatewayRecord } from '../../src/main/gatewayStore';

export async function assertDirectTCPBlocked(target: string): Promise<void> {
  const url = new URL(target);
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host: url.hostname, port: Number(url.port || (url.protocol === 'https:' ? 443 : 80)) });
    socket.setTimeout(1500);
    socket.once('connect', () => { socket.destroy(); reject(new Error('Runtime is directly reachable; a genuinely isolated Docker network is required')); });
    socket.once('error', error => {
      if (['ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT'].includes((error as NodeJS.ErrnoException).code ?? '')) resolve();
      else reject(error);
    });
    socket.once('timeout', () => { socket.destroy(); resolve(); });
  });
}

type Fixture = { gateway: string; plain: string; secure: string; transport: string; state: string; accessLog: string };
type View = { window: BrowserWindow; proxy?: GatewayProxyTransport };

export async function verifyGatewayDeployment(input: {
  fixture: Fixture; client: GatewayURLClient; record: GatewayRecord; proxies: Map<number, GatewayProxyTransport>;
  open: (id: string, mode: 'gateway_proxy' | 'direct_url') => Promise<View>;
  call: (view: View, route: string, body?: unknown) => Promise<{ status: number; body: { data: { unlocked: boolean } } }>;
}): Promise<string[]> {
  const { fixture, client, record, proxies, open, call } = input;
  const cases: string[] = [];
  for (const target of [fixture.plain, fixture.secure, fixture.transport]) await assertDirectTCPBlocked(target);
  cases.push('operating-system TCP probes cannot reach any unpublished Runtime or transport port');
  await client.upsertEnvironmentProfile(record, { gateway_env_id: 'env_transport', display_name: 'Transport qualification', access_mode: 'gateway_proxy', access_route: { kind: 'url', url: fixture.transport } });
  const opened = await client.openSession(record, { gateway_env_id: 'env_transport', requested_capability: 'env_app', access_mode: 'gateway_proxy', client_nonce: crypto.randomUUID() });
  const artifact = opened.connect_artifact.url!;
  assert.equal(new URL(artifact).origin, new URL(fixture.gateway).origin);
  assert.equal(new URL(artifact).protocol, 'https:');
  const token = new URL(artifact).pathname.split('/')[4]!;
  const proxy = await createGatewayProxyTransport(artifact, fixture.transport);
  proxies.set(Number(new URL(proxy.proxyURL).port), proxy);
  const send = (url: string, options: http.RequestOptions = {}, body = Buffer.alloc(0)) => new Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const transport = url.startsWith('https:') ? https : http;
    const request = transport.request(url, options, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks), headers: response.headers }));
    });
    request.setTimeout(10_000, () => request.destroy(new Error('Transport request timed out')));
    request.once('error', reject);
    request.end(body);
  });
  const binary = randomBytes(3 * 1024 * 1024);
  for (const [url, agent] of [[`${fixture.transport}/echo`, proxy.agent], [`${artifact}echo`, undefined]] as const) {
    const result = await send(url, { method: 'POST', agent, headers: { 'Content-Type': 'application/octet-stream' } }, binary);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, binary);
    console.log(`PASS 3 MiB binary round trip through ${agent ? 'Desktop tunnel' : 'Gateway HTTP access'}`);
  }
  const tunneled = await send(`${fixture.transport}/redirect`, { agent: proxy.agent });
  assert.equal(tunneled.headers.location, `${fixture.transport}/echo`);
  const forwarded = await send(`${artifact}redirect`);
  assert.equal(forwarded.headers.location, `${artifact}echo`);
  cases.push('3 MiB binary uploads and absolute redirects survive both reverse-proxy access paths');

  const streams: { request: http.ClientRequest; response: http.IncomingMessage }[] = [];
  try {
    for (const [url, agent] of [[`${fixture.transport}/stream`, proxy.agent], [`${artifact}stream`, undefined]] as const) {
      await new Promise<void>((resolve, reject) => {
        const request = (url.startsWith('https:') ? https : http).get(url, { agent }, response => {
          assert.equal(response.statusCode, 200);
          streams.push({ request, response });
          response.once('data', chunk => { clearTimeout(timer); assert.equal(String(chunk), 'data: ready\n\n'); resolve(); });
          response.once('error', reject);
        });
        const timer = setTimeout(() => { request.destroy(); reject(new Error('Reverse proxy buffered the SSE response')); }, 5000);
        request.once('error', error => { clearTimeout(timer); reject(error); });
      });
    }
    cases.push('SSE flushes immediately through HTTP forwarding and the Desktop tunnel');
    console.log('PASS deployment binary, redirect and SSE checks; waiting across the production ten-minute lease');
    const expired = new Promise<string>(resolve => proxy.subscribeFailure(error => resolve(error.code)));
    const expiry = opened.connect_artifact.expires_at_unix_ms;
    assert.ok(expiry > Date.now() && expiry <= Date.now() + 610_000);
    const idleUntil = Date.now() + 70_000;
    while (Date.now() < expiry + 1000) {
      await delay(Math.min(30_000, expiry + 1000 - Date.now()));
      if (Date.now() < expiry - 2000) assert.ok(streams.every(stream => !stream.response.destroyed), 'reverse proxy ended an idle stream before its lease');
      if (Date.now() >= idleUntil && !cases.includes('idle streams survive the reverse proxy beyond sixty seconds')) {
        cases.push('idle streams survive the reverse proxy beyond sixty seconds');
        console.log('PASS reverse-proxy idle lifetime beyond sixty seconds');
      }
    }
    assert.equal(await Promise.race([expired, delay(5000).then(() => 'timeout')]), 'GATEWAY_SESSION_EXPIRED');
    assert.ok(streams.every(stream => stream.response.destroyed));
    assert.equal((await send(`${artifact}echo`)).status, 401);
    await assert.rejects(proxy.openConnection(), (error: unknown) => (error as { code: string }).code === 'GATEWAY_SESSION_EXPIRED');
    cases.push('the actual ten-minute Gateway lease closes idle streams and rejects token reuse');
  } finally {
    for (const stream of streams) stream.request.destroy();
  }

  const view = await open('env_tls', 'gateway_proxy');
  assert.equal((await call(view, '/api/local/access/status')).status, 200);
  await writeFile(path.join(fixture.state, 'stop-gateway'), '');
  const stopDeadline = Date.now() + 5000;
  while (await access(path.join(fixture.state, 'gateway-stopped')).then(() => false, () => true)) {
    assert.ok(Date.now() < stopDeadline, 'Gateway did not acknowledge shutdown');
    await delay(50);
  }
  await assert.rejects(view.proxy!.openConnection());
  const browserResult = await view.window.webContents.executeJavaScript(`fetch('/api/local/access/status', {cache:'no-store',signal:AbortSignal.timeout(5000)}).then(r => r.status, () => 0)`);
  assert.notEqual(browserResult, 200);
  await assertDirectTCPBlocked(fixture.secure);
  assert.equal((await send(`${artifact}echo`)).status, 502);
  cases.push('Gateway shutdown breaks existing Desktop access without any direct fallback');
  await delay(100);
  const log = await readFile(fixture.accessLog, 'utf8');
  assert.ok(log.includes('status=101') && log.includes('status=401') && log.includes('status=502'));
  assert.ok(!log.includes(token) && !log.includes('/gateway/') && !log.includes('Cookie') && !log.includes('qualification-code'));
  cases.push('Nginx records useful success and failure status without request paths, cookies or access tokens');
  return cases;
}
