import { bindTestSessionHTTP } from '../../test/sessionHTTPFixture';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { observeHostApplicationSetup, uploadHostApplicationSetup, quitHostApplication, terminateHostApplication, detachHostApplication, listRunningHostApplications, listHostApplications, listHostApplicationSessions, launchHostApplication } from './hostApplicationsApi';
const api = vi.hoisted(() => ({ raw: vi.fn(), json: vi.fn() }));
vi.mock('./sessionHTTP', async importOriginal => ({...await importOriginal<object>(), fetchSessionHTTP:api.raw, fetchSessionJSON:api.json}));

describe('host component transfer', () => {
 it('sends bounded ordered chunks and admits validation only after the last acknowledgement', async () => {
  api.raw.mockReset().mockResolvedValue(new Response('{}'));
  api.json.mockReset().mockResolvedValue({ state: 'verifying' });
  const data = new Blob([new Uint8Array(256 * 1024 + 3)]);
  expect(await uploadHostApplicationSetup('owned/id', data, new AbortController().signal)).toEqual({ state: 'verifying' });
  expect(api.raw.mock.calls.map(([url, init]) => [url, init.body.size])).toEqual([
   ['/_redeven_proxy/api/host-applications/setup/owned%2Fid/content?offset=0', 256 * 1024],
   ['/_redeven_proxy/api/host-applications/setup/owned%2Fid/content?offset=262144', 3],
  ]);
  expect(api.json).toHaveBeenCalledWith('/_redeven_proxy/api/host-applications/setup/owned%2Fid/complete', expect.objectContaining({ method: 'POST' }));
 });
 it('never completes a transfer after a rejected chunk', async () => {
  api.raw.mockReset().mockResolvedValue(new Response('', { status: 403 }));
  api.json.mockReset();
  await expect(uploadHostApplicationSetup('id', new Blob(['a']), new AbortController().signal)).rejects.toThrow();
  expect(api.json).not.toHaveBeenCalled();
 });
 it('delivers authoritative snapshots and reports a closed observation as disconnected', async () => {
  api.raw.mockReset().mockResolvedValue(new Response('event: setup\ndata: {"state":"validating"}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
  const receive = vi.fn();
  await expect(observeHostApplicationSetup(receive, new AbortController().signal)).rejects.toThrow('stream ended');
  expect(receive).toHaveBeenCalledWith({ state: 'validating' });
 });
});


it('separates process-generation quit from owner-scoped sharing detach', async () => {
 api.json.mockReset().mockResolvedValue([]);
 await listRunningHostApplications();
 expect(api.json).toHaveBeenLastCalledWith('/_redeven_proxy/api/host-applications/running', expect.objectContaining({ method: 'GET' }));
 await quitHostApplication('catalog-app', ['first-generation', 'second-generation']);
 expect(api.json).toHaveBeenLastCalledWith('/_redeven_proxy/api/host-applications/quit', { method: 'POST', body: JSON.stringify({ application_id: 'catalog-app', instances: ['first-generation', 'second-generation'] }) });
 await terminateHostApplication('catalog-app', ['first-generation']);
 expect(api.json).toHaveBeenLastCalledWith('/_redeven_proxy/api/host-applications/terminate', { method: 'POST', body: JSON.stringify({ application_id: 'catalog-app', instances: ['first-generation'] }) });
 await detachHostApplication('owned/id');
 expect(api.json).toHaveBeenLastCalledWith('/_redeven_proxy/api/host-applications/sessions/owned%2Fid/detach', { method: 'POST' });
});

it('carries one stable client identity across catalog, sessions, and launch requests', async () => {
 api.json.mockReset().mockResolvedValue({ availability: { supported: true, ready: true }, applications: [], sessions: [] });
 await listHostApplications('en-US');
 const catalogURL = api.json.mock.calls.at(-1)?.[0] as string;
 await listHostApplicationSessions();
 const sessionsURL = api.json.mock.calls.at(-1)?.[0] as string;
 await launchHostApplication('editor', 'en-US', { locale: 'en-US', connecting: 'Connecting', reconnecting: 'Reconnecting', disconnected: 'Disconnected', connectionHint: 'Connection interrupted', reconnect: 'Reconnect', starting: 'Starting', failed: 'Failed', ended: 'Ended', retry: 'Retry' });
 const launchBody = JSON.parse(api.json.mock.calls.at(-1)?.[1].body as string) as { client_id: string };
 const catalogClient = new URL(`http://localhost${catalogURL}`).searchParams.get('client_id');
 const sessionsClient = new URL(`http://localhost${sessionsURL}`).searchParams.get('client_id');
 expect(catalogClient).toMatch(/^[A-Za-z0-9._:-]{1,128}$/);
 expect(sessionsClient).toBe(catalogClient);
 expect(launchBody.client_id).toBe(catalogClient);
});

let releaseTestTransport: (() => void) | undefined;
beforeEach(async () => {
  releaseTestTransport = await bindTestSessionHTTP(api.raw);
});
afterEach(() => releaseTestTransport?.());
