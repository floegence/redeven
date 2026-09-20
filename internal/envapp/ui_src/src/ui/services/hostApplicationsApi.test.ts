import { describe, expect, it, vi } from 'vitest';
import { observeHostApplicationSetup, uploadHostApplicationSetup } from './hostApplicationsApi';
const api = vi.hoisted(() => ({ raw: vi.fn(), json: vi.fn() }));
vi.mock('./localApi', () => ({ fetchLocalApi: api.raw, fetchLocalApiJSON: api.json }));

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
