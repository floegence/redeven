import '../../index.css';
import axe from 'axe-core';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { I18nProvider } from '../i18n/I18nProvider';
import { SUPPORTED_LOCALES } from '../i18n/localeMeta';
import { loadEnvAppDictionary } from '../i18n/locales';
import { writeStoredLanguagePreference } from '../i18n/storage';
import { EnvHostApplicationsPage } from './EnvHostApplicationsPage';
import { HostAccessManagement, HostAccessPermissions, HostAccessWelcome } from './HostAccessControls';

const media = commands as unknown as { emulateMediaPreferences: (preferences: { forcedColors?: 'active' | 'none'; reducedMotion?: 'reduce' | 'no-preference' }) => Promise<void> };

const state=vi.hoisted(()=>({screen:false,input:false,access:'unconfigured',desktopAccess:'unconfigured',local:false,scope:'',save:vi.fn(),permission:vi.fn(),launch:vi.fn()}));
vi.mock('./EnvContext',()=>({useEnvContext:()=>({env:()=>({name:'Work Mac',permissions:{can_read:true,can_write:true,can_execute:true}}),env_id:()=>state.scope,localRuntime:()=>({}),resourceCacheAccess:()=>({phase:'ready',generation:0,scope:state.scope})})}));
vi.mock('../services/desktopSessionContext',async original=>({...await original<object>(),readDesktopSessionContextSnapshot:()=>state.local?{target_kind:'local_environment',target_route:'local_host',label:'Local Environment'}:null}));
vi.mock('../services/hostAccess',async original=>({...await original<object>(),setHostAccess:state.save}));
vi.mock('../services/remoteDesktopApi',async original=>({...await original<object>(),getRemoteDesktopStatus:async()=>({access_state:state.desktopAccess,capabilities:{backend:'macos',state:state.screen&&state.input?'ready':'host_action_required',screen:state.screen,input:state.input,displays:[]}})}));
vi.mock('../services/hostApplicationsApi',async original=>({...await original<object>(),
 listHostApplications:async()=>({access_state:state.access,availability:{backend:'macos',supported:true,native_ready:true,ready:state.screen&&state.input,reason:'macos_permissions',permissions:{screen_recording:state.screen,accessibility:state.input}},applications:[{id:'notes',name:'Notes',description:'',categories:[],icon:'',custom:false}],sessions:[]}),
 listHostApplicationSessions:async()=>[],listRunningHostApplications:async()=>[],requestHostApplicationPermission:state.permission,launchHostApplication:state.launch,
}));
let dispose:(()=>void)|undefined;
beforeEach(()=>{state.screen=false;state.input=false;state.access='unconfigured';state.desktopAccess='unconfigured';state.local=false;state.scope=crypto.randomUUID();state.save.mockReset();state.permission.mockReset();state.launch.mockReset();state.save.mockImplementation(async(feature,value)=>{if(feature==='desktop')state.desktopAccess=value;else state.access=value;return {state:value};});state.permission.mockImplementation(async permission=>{if(permission==='screen_recording')state.screen=true;if(permission==='accessibility')state.input=true;});});
afterEach(async()=>{dispose?.();document.body.replaceChildren();writeStoredLanguagePreference('system');document.documentElement.classList.remove('dark');await media.emulateMediaPreferences({forcedColors:'none',reducedMotion:'no-preference'});});

it.each(SUPPORTED_LOCALES)('keeps first-entry actions readable at 320px in %s',async locale=>{
 await page.viewport(320,900);await loadEnvAppDictionary(locale);writeStoredLanguagePreference(locale);
 const host=document.createElement('main');host.style.height='880px';document.body.append(host);dispose=render(()=><I18nProvider><EnvHostApplicationsPage/></I18nProvider>,host);
 await expect.poll(()=>host.querySelector('.host-access-welcome')).not.toBeNull();
 const welcome=host.querySelector<HTMLElement>('.host-access-welcome')!;
 expect(welcome.scrollWidth).toBeLessThanOrEqual(welcome.clientWidth+1);
 for(const scene of welcome.querySelectorAll('svg[data-scene]')){expect(scene.getAttribute('aria-hidden')).toBe('true');expect(scene.getBoundingClientRect().right).toBeLessThanOrEqual(320);}
 for(const button of welcome.querySelectorAll('button')){const box=button.getBoundingClientRect();expect(box.right).toBeLessThanOrEqual(320);expect(box.left).toBeGreaterThanOrEqual(0);expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth+1);}
 expect(state.permission).not.toHaveBeenCalled();expect(state.save).not.toHaveBeenCalled();
 if(locale==='zh-CN')await page.screenshot({element:host,path:'__screenshots__/host-access-welcome-narrow-zh-CN.png'});
});

it('completes interrupted setup, returns to applications, and keeps management available',async()=>{
 await page.viewport(1024,850);writeStoredLanguagePreference('en-US');
 const host=document.createElement('main');host.style.height='820px';document.body.append(host);dispose=render(()=><I18nProvider><EnvHostApplicationsPage/></I18nProvider>,host);
 await userEvent.click(page.getByRole('button',{name:'Set up application access',exact:true}));
 expect(document.querySelector('[data-scene=screen]')).not.toBeNull();expect(document.querySelector('[data-scene=input]')).not.toBeNull();
 await userEvent.click(page.getByRole('button',{name:'Allow screen display',exact:true}));
 await expect.poll(()=>state.screen).toBe(true);
 await userEvent.click(page.getByRole('button',{name:'Close',exact:true}));
 await expect.poll(()=>document.querySelector('[role=dialog]')).toBeNull();
 await userEvent.click(page.getByRole('button',{name:'Continue setup',exact:true}));
 expect(document.querySelector('[role=dialog] [data-scene=screen]')).toBeNull();
 await userEvent.click(page.getByRole('button',{name:'Allow mouse and keyboard',exact:true}));
 await userEvent.click(page.getByRole('button',{name:'Enable and view applications',exact:true}));
 await expect.poll(()=>host.querySelector('.host-apps-library')).not.toBeNull();
 expect(state.save).toHaveBeenCalledWith('applications','enabled');expect(state.launch).not.toHaveBeenCalled();
 await expect.poll(()=>document.querySelector('[role=dialog]')).toBeNull();
 await userEvent.click(page.getByRole('button',{name:'Access settings',exact:true}));
 await userEvent.click(page.getByRole('button',{name:'Pause',exact:true}));
 expect(state.save).toHaveBeenCalledTimes(1);
 await userEvent.click(page.getByRole('button',{name:'Pause',exact:true}));
 await expect.poll(()=>state.access).toBe('paused');
 expect(state.screen&&state.input).toBe(true);
 expect(document.querySelector('.host-access-state[data-state=paused]')).not.toBeNull();
 await page.screenshot({element:document.querySelector<HTMLElement>('[role=dialog]')!,path:'__screenshots__/host-access-management-paused.png'});
 await userEvent.click(page.getByRole('region',{name:'Manage this feature',exact:true}).getByRole('button',{name:'Enable again',exact:true}));
 await expect.poll(()=>state.access).toBe('enabled');
 expect(state.launch).not.toHaveBeenCalled();
 await userEvent.click(page.getByRole('button',{name:'Remove settings…',exact:true}));
 await userEvent.click(page.getByRole('button',{name:'Remove settings…',exact:true}));
 await expect.poll(()=>state.access).toBe('unconfigured');
 expect(state.screen&&state.input).toBe(true);
 await userEvent.click(page.getByRole('region',{name:'Remote application windows',exact:true}).getByRole('button',{name:'Set up',exact:true}));
 await userEvent.click(page.getByRole('button',{name:'Enable and view applications',exact:true}));
 await expect.poll(()=>state.access).toBe('enabled');
 expect(state.permission).toHaveBeenCalledTimes(2);
 expect(state.launch).not.toHaveBeenCalled();
});

it.each([
 {theme:'light',forcedColors:'none',reducedMotion:'no-preference'},
 {theme:'dark',forcedColors:'none',reducedMotion:'reduce'},
 {theme:'light',forcedColors:'active',reducedMotion:'no-preference'},
] as const)('explains access scope with visible static artwork in $theme/$forcedColors/$reducedMotion',async preferences=>{
 await page.viewport(920,900);await loadEnvAppDictionary('zh-CN');writeStoredLanguagePreference('zh-CN');
 document.documentElement.classList.toggle('dark',preferences.theme==='dark');
 await media.emulateMediaPreferences({forcedColors:preferences.forcedColors,reducedMotion:preferences.reducedMotion});
 const host=document.createElement('main');host.style.cssText='padding:24px;background:var(--background);color:var(--foreground)';document.body.append(host);
 dispose=render(()=><I18nProvider><HostAccessWelcome allowed onApplications={()=>{}} onDesktop={()=>{}} onBrowse={()=>{}} /></I18nProvider>,host);
 await expect.poll(()=>host.querySelector('[data-scene=applications]')).not.toBeNull();
 const app=host.querySelector<SVGElement>('[data-scene=applications]')!;const desktop=host.querySelector<SVGElement>('[data-scene=desktop]')!;
 expect(app.querySelector('[data-part=unshared-desktop] rect')?.getAttribute('stroke-dasharray')).toBeTruthy();
 expect(app.querySelector('[data-part=single-window-viewer]')).not.toBeNull();
 expect(desktop.querySelector('[data-part=whole-desktop]')).not.toBeNull();
 expect(desktop.querySelector('[data-part=desktop-viewer]')).not.toBeNull();
 await userEvent.tab();
 expect(host.querySelector('.host-access-choice')?.contains(document.activeElement)).toBe(true);
 for(const scene of [app,desktop]){
   const stroke=getComputedStyle(scene.querySelector('.host-access-art-selected')!).stroke;
   expect(stroke).not.toBe('none');expect(stroke).not.toBe('rgba(0, 0, 0, 0)');
   if(preferences.forcedColors==='active'||preferences.reducedMotion==='reduce'){expect(getComputedStyle(scene.querySelector('.host-access-transfer')!).animationName).toBe('none');}
 }
 await page.screenshot({element:host,path:`__screenshots__/host-access-scenes-${preferences.theme}-${preferences.forcedColors}.png`});
});

it.each(['unconfigured','enabled','paused'] as const)('shows purposeful permissions and %s settings at 320px',async access=>{
 await page.viewport(320,900);await loadEnvAppDictionary('zh-CN');writeStoredLanguagePreference('zh-CN');
 const host=document.createElement('main');host.style.cssText='padding:18px;background:var(--background);color:var(--foreground)';document.body.append(host);
 dispose=render(()=><I18nProvider><HostAccessPermissions screen={access!=='unconfigured'} input={access!=='unconfigured'} needsInput desktop allowed busy={false} onPermission={()=>{}} onRefresh={()=>{}}/><HostAccessManagement state={access} allowed busy={false} onChange={async()=>{}} onReconfigure={()=>{}} /></I18nProvider>,host);
 await expect.poll(()=>host.querySelector(`.host-access-state[data-state=${access}]`)).not.toBeNull();
 expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth+1);
 for(const row of host.querySelectorAll('.host-access-permission')){const title=row.querySelector('h3')!.getBoundingClientRect();const visual=row.querySelector('svg')!.getBoundingClientRect();expect(visual.right).toBeLessThanOrEqual(title.left);}
 await page.screenshot({element:host,path:`__screenshots__/host-access-settings-${access}-narrow.png`});
 if(access==='paused'){
   await userEvent.click(page.getByRole('button',{name:'移除设置…',exact:true}));
   expect(host.querySelector('[data-scene=remove]')).not.toBeNull();
   await page.screenshot({element:host,path:'__screenshots__/host-access-settings-remove-narrow.png'});
   await userEvent.click(page.getByRole('button',{name:'取消',exact:true}));
   expect(host.querySelector('.host-access-state[data-state=paused]')).not.toBeNull();
 }
});

it.each(['zh-CN', 'de-DE', 'zh-TW'] as const)('shows direct feature controls and separate system settings in %s', async locale => {
 await page.viewport(1024, 850); await loadEnvAppDictionary(locale); writeStoredLanguagePreference(locale);
 state.screen = true; state.input = true; state.access = 'enabled'; state.desktopAccess = 'enabled';
 const host = document.createElement('main'); host.style.height = '820px'; document.body.append(host);
 dispose = render(() => <I18nProvider><EnvHostApplicationsPage /></I18nProvider>, host);
 await expect.poll(() => host.querySelector('.host-apps-library')).not.toBeNull();
 const dictionary = await loadEnvAppDictionary(locale);
 await userEvent.click(page.getByRole('button', { name: dictionary.hostAccess.settings, exact: true }));
 const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
 await expect.poll(() => dialog.querySelectorAll('.host-access-feature-settings').length).toBe(2);
 expect(dialog.textContent).not.toContain('Work Mac');
 expect(dialog.querySelector('.host-access-permissions')).toBeNull();
 expect(dialog.querySelector('.remote-desktop-connect')).toBeNull();
 expect(dialog.querySelector<HTMLDetailsElement>('.host-access-system')?.open).toBe(false);
 expect((await axe.run(dialog, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations).toEqual([]);
 await page.screenshot({ element: dialog, path: `__screenshots__/host-access-direct-settings-${locale}.png` });
 await page.viewport(320, 850);
 await expect.poll(() => dialog.getBoundingClientRect().right).toBeLessThanOrEqual(320);
 expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
 for (const button of dialog.querySelectorAll<HTMLButtonElement>('.host-access-feature-settings button')) {
   expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(320);
   expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
 }
 await page.screenshot({ element: dialog, path: `__screenshots__/host-access-direct-settings-narrow-${locale}.png` });
});

it('keeps local app use independent and manages desktop without opening a viewer', async () => {
 await page.viewport(1024, 850); await loadEnvAppDictionary('zh-CN'); writeStoredLanguagePreference('zh-CN');
 state.local = true; state.screen = true; state.input = true; state.access = 'enabled'; state.desktopAccess = 'enabled';
 const host = document.createElement('main'); host.style.height = '820px'; document.body.append(host);
 dispose = render(() => <I18nProvider><EnvHostApplicationsPage /></I18nProvider>, host);
 await userEvent.click(page.getByRole('button', { name: '访问设置', exact: true }));
 const desktop = page.getByRole('region', { name: '远程桌面', exact: true });
 await userEvent.click(desktop.getByRole('button', { name: '停用', exact: true }));
 expect(state.save).not.toHaveBeenCalled();
 await userEvent.click(desktop.getByRole('button', { name: '停用', exact: true }));
 await expect.poll(() => state.desktopAccess).toBe('paused');
 expect(state.access).toBe('enabled'); expect(state.screen && state.input).toBe(true);
 await page.screenshot({ element: document.querySelector<HTMLElement>('[role=dialog]')!, path: '__screenshots__/host-access-local-desktop-paused.png' });
 await userEvent.click(desktop.getByRole('button', { name: '重新开启', exact: true }));
 await expect.poll(() => state.desktopAccess).toBe('enabled');
 expect(state.launch).not.toHaveBeenCalled(); expect(state.permission).not.toHaveBeenCalled();
 expect(document.querySelector('.remote-desktop-connect')).toBeNull();
});

it('shows only missing permissions during first application setup', async () => {
 await page.viewport(390, 850); await loadEnvAppDictionary('zh-CN'); writeStoredLanguagePreference('zh-CN');
 const host = document.createElement('main'); host.style.height = '820px'; document.body.append(host);
 dispose = render(() => <I18nProvider><EnvHostApplicationsPage /></I18nProvider>, host);
 await userEvent.click(page.getByRole('button', { name: '设置应用访问', exact: true }));
 const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
 expect(dialog.querySelectorAll('.host-access-permission')).toHaveLength(2);
 expect(dialog.querySelector('.host-access-management')).toBeNull();
 expect(dialog.querySelector('.host-access-system')).toBeNull();
 expect(dialog.textContent).not.toContain('Work Mac');
 await page.screenshot({ element: dialog, path: '__screenshots__/host-access-application-first-setup.png' });
 await userEvent.click(page.getByRole('button', { name: '去允许显示画面', exact: true }));
 await expect.poll(() => dialog.querySelectorAll('.host-access-permission').length).toBe(1);
 expect(dialog.querySelector('[data-scene=screen]')).toBeNull();
});

it('navigates from connection to direct settings without stacking dialogs', async () => {
 await page.viewport(1024, 850); writeStoredLanguagePreference('en-US');
 state.screen = true; state.input = true; state.access = 'enabled'; state.desktopAccess = 'unconfigured';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><EnvHostApplicationsPage /></I18nProvider>, host);
 await userEvent.click(page.getByRole('button', { name: 'Remote desktop', exact: true }));
 await expect.poll(() => document.querySelector('.remote-desktop-connect')).not.toBeNull();
 await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Access settings', exact: true }));
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(1);
 await expect.poll(() => document.querySelector('.remote-desktop-connect')).toBeNull();
 expect(document.querySelectorAll('.host-access-feature-settings')).toHaveLength(2);
 await userEvent.click(page.getByRole('region', { name: 'Remote desktop', exact: true }).getByRole('button', { name: 'Set up', exact: true }));
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(1);
 await expect.poll(() => document.querySelector('.remote-desktop-connect')).not.toBeNull();
 expect(document.querySelector('.host-access-feature-settings')).toBeNull();
 expect(state.save).not.toHaveBeenCalled(); expect(state.permission).not.toHaveBeenCalled();
});
