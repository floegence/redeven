import { describe, expect, it, vi } from 'vitest';
import { createCloudSessionRenewal, isCloudSessionRenewalDocument } from './cloudSessionRenewal';

const origin = 'https://env-demo.dev.redeven-sandbox.test';
function launchURL(overrides: Record<string, unknown> = {}) {
  const payload = { v: 2, env_public_id: 'env_demo', floe_app: 'com.floegence.redeven.agent', code_space_id: 'env-ui', app_path: '/_redeven_proxy/env/', boot_ticket: 'one-shot-ticket', ...overrides };
  return `${origin}/_redeven_boot/#redeven=${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
}
function fixture() {
  const requestOpenSession = vi.fn(async () => launchURL());
  const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ success: true, data: { env_public_id: 'env_demo', floe_app: 'com.floegence.redeven.agent', code_space_id: 'env-ui' } })));
  const isCurrent = vi.fn(() => true);
  return { requestOpenSession, fetch, isCurrent, renew: createCloudSessionRenewal({ origin, envPublicID: 'env_demo', requestOpenSession, fetch, isCurrent }) };
}
describe('provider sandbox session renewal', () => {
  it('admits only the owning bootstrap document as a native renewal caller', () => {
    expect(isCloudSessionRenewalDocument(`${origin}/_redeven_boot/`, origin)).toBe(true);
    for (const url of ['invalid', `${origin}/_redeven_proxy/env/`, `${origin}/_redevplugin/`, 'https://other.test/_redeven_boot/']) {
      expect(isCloudSessionRenewalDocument(url, origin)).toBe(false);
    }
  });
  it('coalesces concurrent expiry recovery and exchanges only the native authorized ticket', async () => {
    const f = fixture();
    expect(await Promise.all([f.renew(), f.renew()])).toEqual([true, true]);
    expect(f.requestOpenSession).toHaveBeenCalledTimes(1);
    expect(f.fetch).toHaveBeenCalledWith(`${origin}/api/srv/v1/floeproxy/boot/exchange`, expect.objectContaining({ method: 'POST', credentials: 'include', redirect: 'error', headers: { Origin: origin, Authorization: 'Bearer one-shot-ticket' } }));
    await f.renew();
    expect(f.requestOpenSession).toHaveBeenCalledTimes(2);
  });
  it.each([{ env_public_id: 'env_other' }, { floe_app: 'com.floegence.redeven.code' }, { code_space_id: 'other' }, { app_path: '/' }, { v: 1 }, { boot_ticket: '' }])('rejects a mismatched launch binding: %o', async (overrides) => {
    const f = fixture(); f.requestOpenSession.mockResolvedValue(launchURL(overrides));
    expect(await f.renew()).toBe(false); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('rejects changed origins and redirects before sending a capability', async () => {
    const f = fixture(); f.requestOpenSession.mockResolvedValue(launchURL().replace(origin, 'https://other.test'));
    expect(await f.renew()).toBe(false); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('does not retry rejected authorization or revive a closed owner', async () => {
    const f = fixture(); f.requestOpenSession.mockRejectedValue(new Error('Authorization revoked'));
    expect(await f.renew()).toBe(false); expect(f.fetch).not.toHaveBeenCalled();
    f.requestOpenSession.mockImplementation(async () => { f.isCurrent.mockReturnValue(false); return launchURL(); });
    expect(await f.renew()).toBe(false); expect(f.fetch).not.toHaveBeenCalled();
  });
  it('preserves rejection from the cookie exchange', async () => {
    const f = fixture(); f.fetch.mockResolvedValue(new Response('{}', { status: 401 }));
    expect(await f.renew()).toBe(false); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
});
