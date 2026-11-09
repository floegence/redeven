// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { registerSandboxWindow } from './sandboxWindowRegistry';
import { isHostApplicationSettingsRequest } from './hostApplicationSettingsTarget';
function fixture(appPath = '/_redeven_host_app/') {
 const source = { postMessage: vi.fn(), closed: false } as unknown as Window;
 registerSandboxWindow(source, { origin: 'https://viewer.example', floe_app:'pf', code_space_id:'exact-forward', app_path:appPath });
 return { source, event: { source, origin:'https://viewer.example', data:{ type:'redeven:host-application-settings' } } as MessageEvent };
}
it('accepts only the registered exact live product viewer and origin', () => {
 const {source,event} = fixture(); expect(isHostApplicationSettingsRequest(event)).toBe(true);
 expect(isHostApplicationSettingsRequest({...event,source:null} as MessageEvent)).toBe(false);
 expect(isHostApplicationSettingsRequest({...event,origin:'https://other.example'} as MessageEvent)).toBe(false);
 expect(isHostApplicationSettingsRequest({...event,source:{postMessage:vi.fn()}} as unknown as MessageEvent)).toBe(false);
 Object.assign(source,{closed:true}); expect(isHostApplicationSettingsRequest(event)).toBe(false);
});
it('rejects third-party forwarded pages and unrelated messages', () => {
 expect(isHostApplicationSettingsRequest(fixture('/third-party/').event)).toBe(false);
 const {event}=fixture(); expect(isHostApplicationSettingsRequest({...event,data:{type:'other'}} as MessageEvent)).toBe(false);
});
