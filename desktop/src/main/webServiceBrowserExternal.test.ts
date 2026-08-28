import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { openWebServiceInSystemBrowser } from './webServiceBrowserExternal';

const BRIDGE_TOKEN = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  return (server.address() as AddressInfo).port;
}

describe('openWebServiceInSystemBrowser', () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it('mints an exact private handoff before opening the system browser', async () => {
    let receivedBody: unknown;
    let receivedToken = '';
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      receivedToken = String(request.headers['x-redeven-desktop-bridge-token'] ?? '');
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        receivedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
        const port = (server.address() as AddressInfo).port;
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          entry_url: `http://pf-demo.localhost:${port}/docs?__redeven_browser_handoff_v1=${'B'.repeat(43)}&q=one%20two#part`,
          expires_at_unix_ms: Date.now() + 60_000,
        }));
      });
    });
    servers.push(server);
    const port = await listen(server);
    const openURL = vi.fn<(targetURL: string) => Promise<void>>().mockResolvedValue(undefined);

    await openWebServiceInSystemBrowser({
      currentRouteURL: `http://pf-demo.localhost:${port}/docs?q=one%20two#part`,
      bridgeBaseURL: `http://127.0.0.1:${port}/`,
      bridgeToken: BRIDGE_TOKEN,
      allowedBaseURL: `http://127.0.0.1:${port}/`,
      forwardID: 'demo',
    }, { openURL });

    expect(receivedToken).toBe(BRIDGE_TOKEN);
    expect(receivedBody).toEqual({ forward_id: 'demo', app_path: '/docs?q=one%20two#part' });
    expect(openURL).toHaveBeenCalledOnce();
    expect(openURL.mock.calls[0]?.[0]).toMatch(new RegExp(`^http://pf-demo\\.localhost:${port}/docs\\?`, 'u'));
  });

  it('does not open any URL when minting or response validation fails', async () => {
    const server = http.createServer((_request, response) => {
      const port = (server.address() as AddressInfo).port;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({
        entry_url: `http://pf-other.localhost:${port}/?__redeven_browser_handoff_v1=${'B'.repeat(43)}`,
        expires_at_unix_ms: Date.now() + 60_000,
      }));
    });
    servers.push(server);
    const port = await listen(server);
    const openURL = vi.fn<(targetURL: string) => Promise<void>>().mockResolvedValue(undefined);

    await expect(openWebServiceInSystemBrowser({
      currentRouteURL: `http://pf-demo.localhost:${port}/`,
      bridgeBaseURL: `http://127.0.0.1:${port}/`,
      bridgeToken: BRIDGE_TOKEN,
      allowedBaseURL: `http://127.0.0.1:${port}/`,
      forwardID: 'demo',
    }, { openURL })).rejects.toThrow(/different Web Service/iu);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('keeps the system browser closed when the Runtime mint endpoint fails', async () => {
    const server = http.createServer((_request, response) => {
      response.statusCode = 503;
      response.end();
    });
    servers.push(server);
    const port = await listen(server);
    const openURL = vi.fn<(targetURL: string) => Promise<void>>().mockResolvedValue(undefined);

    await expect(openWebServiceInSystemBrowser({
      currentRouteURL: `http://pf-demo.localhost:${port}/`,
      bridgeBaseURL: `http://127.0.0.1:${port}/`,
      bridgeToken: BRIDGE_TOKEN,
      allowedBaseURL: `http://127.0.0.1:${port}/`,
      forwardID: 'demo',
    }, { openURL })).rejects.toThrow(/HTTP 503/iu);
    expect(openURL).not.toHaveBeenCalled();
  });

  it('never falls back to a private URL when the Desktop bridge is unavailable', async () => {
    const openURL = vi.fn<(targetURL: string) => Promise<void>>().mockResolvedValue(undefined);

    await expect(openWebServiceInSystemBrowser({
      currentRouteURL: 'http://pf-demo.localhost:43123/',
      allowedBaseURL: 'http://127.0.0.1:43123/',
      forwardID: 'demo',
    }, { openURL })).rejects.toThrow(/bridge authorization is unavailable/iu);

    expect(openURL).not.toHaveBeenCalled();
  });

  it('never falls back to a private URL when its bridge port does not match', async () => {
    const openURL = vi.fn<(targetURL: string) => Promise<void>>().mockResolvedValue(undefined);

    await expect(openWebServiceInSystemBrowser({
      currentRouteURL: 'http://pf-demo.localhost:43123/',
      bridgeBaseURL: 'http://127.0.0.1:43124/',
      bridgeToken: BRIDGE_TOKEN,
      allowedBaseURL: 'http://127.0.0.1:43123/',
      forwardID: 'demo',
    }, { openURL })).rejects.toThrow(/bridge authorization is unavailable/iu);

    expect(openURL).not.toHaveBeenCalled();
  });

  it('opens an explicitly blocked external link without minting a handoff', async () => {
    const openURL = vi.fn<(targetURL: string) => Promise<void>>().mockResolvedValue(undefined);
    await openWebServiceInSystemBrowser({
      currentRouteURL: 'http://pf-demo.localhost:43123/',
      pendingExternalURL: 'https://example.com/docs?q=1#part',
      bridgeBaseURL: 'http://127.0.0.1:1/',
      bridgeToken: BRIDGE_TOKEN,
      allowedBaseURL: 'http://127.0.0.1:43123/',
      forwardID: 'demo',
    }, { openURL });
    expect(openURL).toHaveBeenCalledWith('https://example.com/docs?q=1#part');
  });

  it('keeps an authorized remote pf route on its existing origin', async () => {
    const openURL = vi.fn<(targetURL: string) => Promise<void>>().mockResolvedValue(undefined);
    const route = 'https://pf-demo.sg.redeven.online/docs?q=1#part';
    await openWebServiceInSystemBrowser({
      currentRouteURL: route,
      allowedBaseURL: 'https://env-session.sg.redeven.online/',
      forwardID: 'demo',
    }, { openURL });
    expect(openURL).toHaveBeenCalledWith(route);
  });
});
