// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { prepareCenterApplication } from './centerApplication';
afterEach(() => { vi.unstubAllGlobals(); });
it('requires a separately scoped HTTPS child and bounded handoff path', async () => {
  vi.stubGlobal('window', { location: { href: 'https://env.example.test:8443/' } });
  const origin = 'https://app-' + 'a'.repeat(40) + '.example.test:8443';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ok:true,data:{origin,destination:origin+'/__center/start?operation=one'}}))));
  expect(await prepareCenterApplication('cs','space')).toBe(origin+'/__center/start?operation=one');
  for(const destination of ['https://evil.test/__center/start','https://env.example.test:8443/__center/start',origin+'/api/local/runtime',origin.replace('8443','9443')+'/__center/start']) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ok:true,data:{origin:new URL(destination).origin,destination}}))));
    await expect(prepareCenterApplication('pf','forward')).rejects.toThrow('CENTER_INVALID_TARGET');
  }
});
