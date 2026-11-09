import '../../index.css';
import axe from 'axe-core';
import { FloeProvider, useTheme } from '@floegence/floe-webapp-core';
import { SettingsDialog } from '../../../../../settings_ui/src/SettingsDialog';
import { SettingsPanelContext } from '../../../../../settings_ui/src/SettingsPanelHost';
import { createSettingsSession, type SettingsSection } from '../../../../../settings_ui/src/settingsSession';
import { render } from 'solid-js/web';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { I18nProvider, useI18n } from '../i18n/I18nProvider';
import { SUPPORTED_LOCALES } from '../i18n/localeMeta';
import { loadEnvAppDictionary } from '../i18n/locales';
import { writeStoredLanguagePreference } from '../i18n/storage';
import { EnvHostApplicationsPage } from './EnvHostApplicationsPage';
import { HostApplicationSetupPanel } from './HostApplicationSetupPanel';
import { HostAccessFeatureSettings, HostAccessManagement, HostAccessPermissions, HostAccessSystemPermissions, HostAccessWelcome } from './HostAccessControls';

const media = commands as unknown as { emulateMediaPreferences: (preferences: { forcedColors?: 'active' | 'none'; reducedMotion?: 'reduce' | 'no-preference' }) => Promise<void> };

const state=vi.hoisted(()=>({screen:false,input:false,access:'unconfigured',desktopAccess:'unconfigured',local:false,scope:'',permissionApp:'',picture:vi.fn(),openSettings:vi.fn(),save:vi.fn(),permission:vi.fn(),check:vi.fn(),launch:vi.fn()}));
vi.mock('./EnvContext',()=>({useEnvContext:()=>({env:()=>({name:'Work Mac',permissions:{can_read:true,can_write:true,can_execute:true}}),env_id:()=>state.scope,openSettings:state.openSettings,localRuntime:()=>({}),resourceCacheAccess:()=>({phase:'ready',generation:0,scope:state.scope})})}));
vi.mock('../services/desktopSessionContext',async original=>({...await original<object>(),readDesktopSessionContextSnapshot:()=>state.local?{target_kind:'local_environment',target_route:'local_host',label:'Local Environment'}:null}));
vi.mock('../services/localApi', async original => ({...await original<object>(), fetchLocalApiJSON: state.picture}));
vi.mock('../services/hostAccess',async original=>({...await original<object>(),setHostAccess:state.save}));
vi.mock('../services/remoteDesktopApi',async original=>({...await original<object>(),getRemoteDesktopStatus:async()=>({access_state:state.desktopAccess,permission_app_name:state.permissionApp,capabilities:{backend:'macos',state:state.screen&&state.input?'ready':'host_action_required',screen:state.screen,input:state.input,displays:[]}})}));
vi.mock('../services/hostApplicationsApi',async original=>({...await original<object>(),
 listHostApplications:async()=>({access_state:state.access,availability:{backend:'macos',permission_app_name:state.permissionApp,supported:true,native_ready:true,ready:state.screen&&state.input,reason:'macos_permissions',permissions:{screen_recording:state.screen,accessibility:state.input}},applications:[{id:'notes',name:'Notes',description:'',categories:[],icon:'',custom:false}],sessions:[]}),
 listHostApplicationSessions:async()=>[],listRunningHostApplications:async()=>[],requestHostApplicationPermission:(permission: string) => permission === 'check_permissions' ? state.check() : state.permission(permission),launchHostApplication:state.launch,
}));
// IMPORTANT: Exercise the actual global modal and presentation owner. A local
// replacement dialog cannot verify nested permission recovery or retained state.
function FixtureTheme(props: { mode: 'light' | 'dark' }) {
 const theme = useTheme();
 const initial = theme.theme();
 onMount(() => theme.setTheme(props.mode));
 onCleanup(() => theme.setTheme(initial));
 return null;
}
function HostApplicationsFixture(props: { theme?: 'light' | 'dark' } = {}) {
 const i18n = useI18n();
 const session = createSettingsSession();
 state.openSettings.mockImplementation((section: SettingsSection) => session.open({ section }));
 return <FloeProvider>{props.theme && <FixtureTheme mode={props.theme} />}<SettingsPanelContext.Provider value={{ ...session, register: () => () => {} }}>
   <EnvHostApplicationsPage />
   <SettingsDialog open={session.target() !== null} present={session.present()} onPresenceChange={session.setPresent} onClose={session.close}
     title={i18n.t('settings.runtimeTitle')} closeLabel={i18n.t('common.actions.close')}>
     <EnvHostApplicationsPage settingsOnly />
   </SettingsDialog>
 </SettingsPanelContext.Provider></FloeProvider>;
}
let dispose:(()=>void)|undefined;
beforeEach(()=>{state.screen=false;state.input=false;state.access='unconfigured';state.desktopAccess='unconfigured';state.local=false;state.permissionApp='';state.scope=crypto.randomUUID();state.picture.mockReset();state.picture.mockResolvedValue({mode:'auto',max_dimension:0,frame_rate:0});state.openSettings.mockReset();state.save.mockReset();state.permission.mockReset();state.check.mockReset();state.check.mockResolvedValue(undefined);state.launch.mockReset();state.save.mockImplementation(async(feature,value)=>{if(feature==='desktop')state.desktopAccess=value;else state.access=value;return {state:value};});state.permission.mockImplementation(async permission=>{if(permission==='screen_recording')state.screen=true;if(permission==='accessibility')state.input=true;});});
afterEach(async()=>{dispose?.();document.body.replaceChildren();writeStoredLanguagePreference('system');document.documentElement.classList.remove('dark');await media.emulateMediaPreferences({forcedColors:'none',reducedMotion:'no-preference'});});

it.each(SUPPORTED_LOCALES)('keeps compact paused and incomplete cards readable at 320px in %s', async locale => {
 await page.viewport(320, 900); await loadEnvAppDictionary(locale); writeStoredLanguagePreference(locale);
 const host = document.createElement('main'); host.style.padding = '18px'; document.body.append(host);
 dispose = render(() => <I18nProvider><div class="host-access-settings">
   <HostAccessFeatureSettings feature="applications" state="paused" allowed busy={false} onChange={async () => {}} onReconfigure={() => {}} />
   <HostAccessFeatureSettings feature="desktop" state="enabled" ready={false} allowed busy={false} onChange={async () => {}} onReconfigure={() => {}} />
 </div></I18nProvider>, host);
 for (const element of host.querySelectorAll<HTMLElement>('.host-access-feature-settings, .host-access-feature-title, [role=status], button')) {
   expect(element.scrollWidth, element.outerHTML).toBeLessThanOrEqual(element.clientWidth + 1);
   expect(element.getBoundingClientRect().right).toBeLessThanOrEqual(320);
 }
 if (locale === 'zh-CN') await page.screenshot({ element: host, path: '__screenshots__/host-access-compact-states-narrow.png' });
});

it.each(SUPPORTED_LOCALES)('keeps first-entry actions readable at 320px in %s',async locale=>{
 await page.viewport(320,900);await loadEnvAppDictionary(locale);writeStoredLanguagePreference(locale);
 const host=document.createElement('main');host.style.height='880px';document.body.append(host);dispose=render(()=><I18nProvider><HostApplicationsFixture /></I18nProvider>,host);
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
 const host=document.createElement('main');host.style.height='820px';document.body.append(host);dispose=render(()=><I18nProvider><HostApplicationsFixture /></I18nProvider>,host);
 await userEvent.click(page.getByRole('button',{name:'Set up application access',exact:true}));
 expect(document.querySelector('[data-scene=screen]')).not.toBeNull();expect(document.querySelector('[data-scene=input]')).toBeNull();
 expect(document.querySelectorAll('.host-access-permission-progress li')).toHaveLength(2);
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
 await userEvent.click(page.getByRole('switch', {name:'Remote application windows', exact:true}).element().closest('label')!);
 expect(state.save).toHaveBeenCalledTimes(1);
 await userEvent.click(page.getByRole('button',{name:'Pause',exact:true}));
 await expect.poll(()=>state.access).toBe('paused');
 expect(state.screen&&state.input).toBe(true);
 expect(document.querySelector('.host-access-feature-settings[aria-label="Remote application windows"] .floe-setting-row__label p')?.textContent).toBe('Paused · settings retained');
 await page.screenshot({element:document.querySelector<HTMLElement>('[role=dialog]')!,path:'__screenshots__/host-access-management-paused.png'});
 await userEvent.click(page.getByRole('switch', {name:'Remote application windows', exact:true}).element().closest('label')!);
 await expect.poll(()=>state.access).toBe('enabled');
 expect(state.launch).not.toHaveBeenCalled();
 await page.getByRole('button', {name:'Manage this feature · Remote application windows',exact:true}).click();
 await page.getByRole('menuitem', {name:'Remove settings…',exact:true}).click();
 expect(state.access).toBe('enabled');
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
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await expect.poll(() => host.querySelector('.host-apps-library')).not.toBeNull();
 const dictionary = await loadEnvAppDictionary(locale);
 await userEvent.click(page.getByRole('button', { name: dictionary.hostAccess.settings, exact: true }));
 const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
 await expect.poll(() => dialog.querySelectorAll('.host-access-feature-settings').length).toBe(2);
 // Measure actual content, not the intermediate opening opacity/scale.
 await expect.poll(() => {
   const style = getComputedStyle(dialog);
   return Number(style.opacity) === 1 && (style.transform === 'none' || new DOMMatrixReadOnly(style.transform).isIdentity);
 }).toBe(true);
 for (const feature of dialog.querySelectorAll('.host-access-feature-settings')) {
   expect(feature.querySelectorAll('.floe-setting-row__title')).toHaveLength(1);
   expect(feature.querySelector('.floe-setting-row__title')?.textContent).toBe(feature.getAttribute('aria-label'));
   const identity = feature.querySelector('.floe-setting-row__label')!.getBoundingClientRect();
   const control = feature.querySelector('.host-access-feature-control')!.getBoundingClientRect();
   expect(Math.abs((identity.top + identity.bottom) / 2 - (control.top + control.bottom) / 2)).toBeLessThan(4);
   expect(control.left).toBeGreaterThanOrEqual(identity.right);

 }
 expect(dialog.textContent).not.toContain('Work Mac');
 expect(dialog.querySelector('.host-access-permissions')).toBeNull();
 expect(dialog.querySelector('.remote-desktop-connect')).toBeNull();
 expect(dialog.querySelector('.host-apps > button')).toBeNull();
 expect(dialog.querySelector('.host-access-system > button')?.getAttribute('aria-expanded')).toBe('false');
 await page.getByRole('button', {name: dictionary.hostAccess.systemSettings, exact: true}).click();
 expect([...dialog.querySelectorAll('.host-access-system-row .floe-setting-row__label p')].map(node => node.textContent)).toEqual([dictionary.hostAccess.allowed, dictionary.hostAccess.allowed]);
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
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await userEvent.click(page.getByRole('button', { name: '访问设置', exact: true }));
 const desktop = page.getByRole('region', { name: '远程桌面', exact: true });
 await userEvent.click(desktop.getByRole('switch', {name:'远程桌面', exact:true}).element().closest('label')!);
 expect(state.save).not.toHaveBeenCalled();
 await page.getByRole('button', {name:'停用', exact:true}).click();
 await expect.poll(() => state.desktopAccess).toBe('paused');
 expect(state.access).toBe('enabled'); expect(state.screen && state.input).toBe(true);
 await page.screenshot({ element: document.querySelector<HTMLElement>('[role=dialog]')!, path: '__screenshots__/host-access-local-desktop-paused.png' });
 await userEvent.click(desktop.getByRole('switch', {name:'远程桌面',exact:true}).element().closest('label')!);
 await expect.poll(() => state.desktopAccess).toBe('enabled');
 expect(state.launch).not.toHaveBeenCalled(); expect(state.permission).not.toHaveBeenCalled();
 expect(document.querySelector('.remote-desktop-connect')).toBeNull();
});

it('keeps the feature switch authoritative until confirmation and fences retained confirmations by category', async () => {
 await page.viewport(1024, 850); writeStoredLanguagePreference('en-US');
 state.screen = true; state.input = true; state.access = 'enabled'; state.desktopAccess = 'enabled';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await page.getByRole('button', {name:'Access settings', exact:true}).click();
 const control = page.getByRole('switch', {name:'Remote application windows', exact:true});
 const input = control.element() as HTMLInputElement;
 await userEvent.click(input.closest('label')!);
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(2);
 expect(input.checked).toBe(true); expect(state.save).not.toHaveBeenCalled();
 await page.getByRole('button', {name:'Cancel', exact:true}).click();
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(1);
 expect(input.checked).toBe(true); expect(state.save).not.toHaveBeenCalled();
 input.focus(); await userEvent.keyboard(' ');
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(2);
 expect(input.checked).toBe(true);
 state.openSettings('appearance');
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(1);
 state.openSettings('applications');
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(1);
 expect(state.save).not.toHaveBeenCalled();
 await userEvent.click(input.closest('label')!);
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(2);
 await page.getByRole('button', {name:'Cancel', exact:true}).click();
 expect(state.save).not.toHaveBeenCalled();
 expect(state.permission).not.toHaveBeenCalled(); expect(state.launch).not.toHaveBeenCalled();
});

it('closes an open feature action menu when Settings changes category or closes', async () => {
 const warnings = vi.spyOn(console, 'warn');
 await page.viewport(1024, 850); writeStoredLanguagePreference('en-US');
 state.screen = true; state.input = true; state.access = 'enabled'; state.desktopAccess = 'enabled';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await page.getByRole('button', {name:'Access settings',exact:true}).click();
 const menu = page.getByRole('button', {name:'Manage this feature · Remote application windows',exact:true});
 await menu.click();
 await expect.element(page.getByRole('menuitem', {name:'Remove settings…',exact:true})).toBeVisible();
 state.openSettings('appearance');
 await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
 state.openSettings('applications');
 await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
 await menu.click();
 await userEvent.keyboard('{Escape}');
 await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
 await menu.click();
 await page.getByRole('button', {name:'Close',exact:true}).click();
 await expect.element(page.getByRole('menu')).not.toBeInTheDocument();
 expect(state.save).not.toHaveBeenCalled();
 expect(warnings.mock.calls.filter(([message]) => String(message).includes('computations created outside'))).toEqual([]);
 warnings.mockRestore();
});

it('shows the current permission and retains completed steps during first application setup', async () => {
 await page.viewport(390, 850); await loadEnvAppDictionary('zh-CN'); writeStoredLanguagePreference('zh-CN');
 const host = document.createElement('main'); host.style.height = '820px'; document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await userEvent.click(page.getByRole('button', { name: '设置应用访问', exact: true }));
 const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
 expect(dialog.querySelectorAll('.host-access-permission')).toHaveLength(1);
 expect(dialog.querySelector('[aria-current=step]')?.textContent).toContain('屏幕录制');
 expect(dialog.querySelector('.host-access-management')).toBeNull();
 expect(dialog.querySelector('.host-access-system')).toBeNull();
 expect(dialog.textContent).not.toContain('Work Mac');
 await page.screenshot({ element: dialog, path: '__screenshots__/host-access-application-first-setup.png' });
 await userEvent.click(page.getByRole('button', { name: '去允许显示画面', exact: true }));
 await expect.poll(() => dialog.querySelector('[aria-current=step]')?.textContent).toContain('辅助功能');
 expect(dialog.querySelectorAll('[data-complete=true]')).toHaveLength(1);
 expect(dialog.querySelector('[data-scene=screen]')).toBeNull();
});

it('returns from connection to one settings host and scopes setup to its nested modal', async () => {
 await page.viewport(1024, 850); writeStoredLanguagePreference('en-US');
 state.screen = true; state.input = true; state.access = 'enabled'; state.desktopAccess = 'unconfigured';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await userEvent.click(page.getByRole('button', { name: 'Remote desktop', exact: true }));
 await expect.poll(() => document.querySelector('.remote-desktop-connect')).not.toBeNull();
 await userEvent.click(page.getByRole('dialog').getByRole('button', { name: 'Access settings', exact: true }));
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(1);
 await expect.poll(() => document.querySelector('.remote-desktop-connect')).toBeNull();
 expect(document.querySelectorAll('.host-access-feature-settings')).toHaveLength(2);
 const settings = document.querySelector<HTMLElement>('[role=dialog]')!;
 const feature = settings.querySelector('.host-access-feature-settings');
 await userEvent.click(page.getByRole('region', { name: 'Remote desktop', exact: true }).getByRole('button', { name: 'Set up', exact: true }));
 // The setup action owns one nested modal; the global settings owner is retained.
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(2);
 await expect.poll(() => document.querySelector('.remote-desktop-connect')).not.toBeNull();
 expect(settings.querySelector('.host-access-feature-settings')).toBe(feature);
 expect([...document.querySelectorAll('[data-floe-dialog-mode]')].map(node => node.getAttribute('data-floe-dialog-mode'))).toEqual(['global', 'global']);
 const connection = document.querySelector('.remote-desktop-connect')!.closest('[role=dialog]')!;
 await expect.poll(() => connection.contains(document.activeElement)).toBe(true);
 await userEvent.keyboard('{Escape}');
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(1);
 expect(document.querySelector('[role=dialog]')).toBe(settings);
 expect(settings.querySelector('.host-access-feature-settings')).toBe(feature);
 await expect.poll(() => settings.contains(document.activeElement)).toBe(true);
 await userEvent.click(page.getByRole('region', { name: 'Remote desktop', exact: true }).getByRole('button', { name: 'Set up', exact: true }));
 await userEvent.click(page.getByRole('dialog', { name: 'Remote desktop', exact: true }).getByRole('button', { name: 'Access settings', exact: true }));
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(1);
 expect(document.querySelector('[role=dialog]')).toBe(settings);
 expect(state.save).not.toHaveBeenCalled(); expect(state.permission).not.toHaveBeenCalled();
});

it.each(['Redeven Desktop Dev', ''] as const)('identifies the system permission destination for %s', async name => {
 await page.viewport(1024, 850); await loadEnvAppDictionary('zh-CN'); writeStoredLanguagePreference('zh-CN');
 state.local = true; state.screen = true; state.input = true; state.access = 'enabled'; state.desktopAccess = 'enabled'; state.permissionApp = name;
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await userEvent.click(page.getByRole('button', { name: '访问设置', exact: true }));
 const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
 await userEvent.click(page.getByText('管理系统权限', { exact: true }));
 const destination = dialog.querySelector('.host-access-permission-destination')!;
 expect(destination.textContent).toContain(name || '不可用');
 if (!name) expect(destination.textContent).not.toContain('找到“Redeven');
 await userEvent.click(page.getByRole('button', { name: '打开系统设置', exact: true }).first());
 expect(state.permission).toHaveBeenCalledExactlyOnceWith('screen_recording_settings');
 expect(state.save).not.toHaveBeenCalled();
 document.documentElement.classList.add('dark');
 await page.screenshot({ element: dialog, path: `__screenshots__/host-access-permission-owner-${name ? 'known' : 'unknown'}.png` });
 state.screen = false; state.input = false;
 window.dispatchEvent(new Event('focus'));
 await expect.poll(() => dialog.querySelector('.host-access-system')).toBeNull();
 await expect.poll(() => dialog.querySelector('.host-access-feature-settings .floe-setting-row__label p')?.textContent).toBe('需要完成设置');
 await page.getByRole('region', {name: '远程应用窗口', exact: true}).getByRole('button', {name: '继续设置', exact: true}).click();
 await userEvent.click(page.getByRole('button', { name: '去允许显示画面', exact: true }));
 expect(state.permission).toHaveBeenLastCalledWith('screen_recording');
 expect(state.access).toBe('enabled');
});

it.each(SUPPORTED_LOCALES)('offers precise helper recovery without restarting the host in %s', async locale => {
 await page.viewport(320, 1000); await loadEnvAppDictionary(locale); writeStoredLanguagePreference(locale);
 const dictionary = await loadEnvAppDictionary(locale);
 const host = document.createElement('main'); host.style.padding = '16px'; document.body.append(host);
 const permission = vi.fn(), recovery = vi.fn();
 dispose = render(() => <I18nProvider><HostAccessPermissions permissionAppName="Redeven Desktop Access Dev" screen={false} input={false} needsInput allowed busy={false} onPermission={permission} onRefresh={() => {}} onRecovery={recovery} /></I18nProvider>, host);
 await userEvent.click(page.getByRole('button', {name: dictionary.hostAccess.allowScreen, exact: true}));
 expect(permission).toHaveBeenCalledExactlyOnceWith('screen_recording');
 await userEvent.click(page.getByRole('button', {name: dictionary.hostAccess.openSystemSettings, exact: true}));
 expect(permission).toHaveBeenLastCalledWith('screen_recording', true);
 await userEvent.click(page.getByText(dictionary.hostAccess.permissionHelp, {exact: true}));
 expect(host.querySelector('[data-scene=locate]')).not.toBeNull();
 expect(host.querySelector('[data-scene=restart]')).not.toBeNull();
 await userEvent.click(page.getByRole('button', {name: dictionary.hostAccess.revealApplication, exact: true}));
 expect(recovery).toHaveBeenCalledExactlyOnceWith('reveal_application');
 await userEvent.click(page.getByRole('button', {name: dictionary.hostAccess.applyPermissions, exact: true}));
 expect(recovery).toHaveBeenCalledTimes(1);
 expect(host.querySelector('[role=alert]')?.textContent).toBe(dictionary.hostAccess.helperRestartConfirm);
 await userEvent.click(page.getByRole('button', {name: dictionary.hostAccess.restartHelper, exact: true}));
 expect(recovery).toHaveBeenLastCalledWith('restart_application');
 for (const element of host.querySelectorAll<HTMLElement>('button, .host-access-recovery, .host-access-recovery-step')) {
   expect(element.scrollWidth, element.outerHTML).toBeLessThanOrEqual(element.clientWidth + 1);
   expect(element.getBoundingClientRect().right).toBeLessThanOrEqual(320);
 }
 expect((await axe.run(host, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa']}})).violations).toEqual([]);
 if (locale === 'zh-CN') await page.screenshot({element: host, path: '__screenshots__/host-access-helper-recovery-narrow.png'});
});

it('preserves feature intent and refreshes after explicit helper recovery', async () => {
 await page.viewport(900, 850); writeStoredLanguagePreference('en-US');
 state.local = true; state.screen = true; state.input = true; state.access = 'enabled'; state.desktopAccess = 'paused'; state.permissionApp = 'Redeven Desktop Access Dev';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await userEvent.click(page.getByRole('button', {name: 'Access settings', exact: true}));
 await userEvent.click(page.getByText('Manage system permissions', {exact: true}));
 await userEvent.click(page.getByText('Cannot find the app or permissions are not taking effect?', {exact: true}));
 await userEvent.click(page.getByRole('button', {name: 'Show app in Finder', exact: true}));
 expect(state.permission).toHaveBeenCalledExactlyOnceWith('reveal_application');
 await userEvent.click(page.getByRole('button', {name: 'Apply permission changes', exact: true}));
 expect(state.permission).toHaveBeenCalledTimes(1);
 await userEvent.click(page.getByRole('button', {name: 'Restart Desktop Access', exact: true}));
 await expect.poll(() => state.permission.mock.calls.length).toBe(2);
 expect(state.permission).toHaveBeenLastCalledWith('restart_application');
 expect(state.access).toBe('enabled'); expect(state.desktopAccess).toBe('paused');
 expect(state.save).not.toHaveBeenCalled(); expect(state.launch).not.toHaveBeenCalled();
});


it.each([
 ['screen_recording', 'Allow screen display'],
 ['accessibility', 'Allow mouse and keyboard'],
] as const)('offers explicit Settings navigation after an unanswered %s request in management', async (permission, label) => {
 await page.viewport(640, 850); writeStoredLanguagePreference('en-US');
 const host = document.createElement('main'); document.body.append(host);
 const request = vi.fn();
 dispose = render(() => <I18nProvider><HostAccessSystemPermissions permissionAppName="Redeven Desktop Access Dev" screen={false} input={false} allowed busy={false} onPermission={request} /></I18nProvider>, host);
 await userEvent.click(page.getByText('Manage system permissions', {exact: true}));
 await userEvent.click(page.getByRole('button', {name: label, exact: true}));
 expect(request).toHaveBeenCalledExactlyOnceWith(permission, false);
 await userEvent.click(page.getByRole('button', {name: 'Open system settings', exact: true}));
 expect(request).toHaveBeenLastCalledWith(permission, true);
 expect(host.querySelector('[role=status]')?.textContent).toContain('This page checks automatically');
});

it.each(['applications', 'desktop'] as const)('rejects retained %s resume after switching categories', async feature => {
 await page.viewport(900, 850); writeStoredLanguagePreference('en-US');
 state.local = true; state.screen = true; state.input = true; state.access = 'paused'; state.desktopAccess = 'paused';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await page.getByRole('button', { name: 'Access settings', exact: true }).click();
 const name = feature === 'applications' ? 'Remote application windows' : 'Remote desktop';
 const toggle = page.getByRole('switch', { name, exact: true }).element() as HTMLInputElement;
 state.openSettings('appearance');
 toggle.click();
 expect(state.save).not.toHaveBeenCalled(); expect(toggle.disabled).toBe(true);
 state.openSettings('applications');
 expect(state.save).not.toHaveBeenCalled();
});

it.each(['paused', 'unconfigured'] as const)('rejects hidden compact %s setup callbacks', async access => {
 await page.viewport(900, 850); writeStoredLanguagePreference('en-US');
 const host = document.createElement('main'); document.body.append(host);
 const reconfigure = vi.fn(); let session!: ReturnType<typeof createSettingsSession>;
 dispose = render(() => {
   session = createSettingsSession(); session.open({ section: 'applications' }); session.setPresent(true);
   return <I18nProvider><SettingsPanelContext.Provider value={{ ...session, register: () => () => {} }}>
     <HostAccessFeatureSettings feature="applications" state={access} ready={false} allowed busy={false} onChange={async () => {}} onReconfigure={reconfigure} />
   </SettingsPanelContext.Provider></I18nProvider>;
 }, host);
 const setup = host.querySelector<HTMLButtonElement>('button')!;
 session.open({ section: 'appearance' }); setup.click();
 expect(reconfigure).not.toHaveBeenCalled(); expect(setup.disabled).toBe(true);
 session.open({ section: 'applications' });
 expect(reconfigure).not.toHaveBeenCalled();
});


it.each(['unconfigured', 'paused', 'enabled'] as const)('keeps picture tuning out of the incomplete %s access stage', async access => {
 await page.viewport(1024, 850); writeStoredLanguagePreference('en-US');
 state.local = true; state.access = access; state.desktopAccess = 'unconfigured';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await page.getByRole('button', {name: 'Access settings', exact: true}).click();
 const settings = document.querySelector<HTMLElement>('[role=dialog]')!;
 expect(settings.querySelectorAll('.host-access-feature-settings')).toHaveLength(2);
 expect(settings.querySelector('[data-testid=application-picture-settings]')).toBeNull();
 expect(settings.querySelector('.host-access-system')).toBeNull();
 expect(settings.querySelector('[data-scene=screen]')).toBeNull();
 expect(state.permission).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
 await page.getByRole('region', {name: 'Remote application windows', exact: true}).getByRole('button', {name: access === 'unconfigured' ? 'Set up' : access === 'paused' ? 'Enable again' : 'Continue setup', exact: true}).click();
 await expect.poll(() => document.querySelectorAll('[role=dialog]').length).toBe(2);
 expect(document.querySelector('.host-apps-dialog [data-scene=screen]')).not.toBeNull();
 expect(document.querySelector('.host-apps-dialog [data-scene=input]')).toBeNull();
 expect(state.permission).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
});


it.each(['unconfigured', 'paused'] as const)('does not expose tuning just because system grants exist while %s', async access => {
 await page.viewport(1024, 850); writeStoredLanguagePreference('en-US');
 state.screen = true; state.input = true; state.access = access; state.desktopAccess = access;
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await page.getByRole('button', {name: 'Access settings', exact: true}).click();
 expect(document.querySelector('.host-access-picture:not([hidden])')).toBeNull();
 expect(document.querySelector('.host-access-system')).toBeNull();
 expect(state.picture).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
});

it('keeps application tuning separate from an enabled desktop', async () => {
 await page.viewport(1024, 850); writeStoredLanguagePreference('en-US');
 state.screen = true; state.input = true; state.access = 'unconfigured'; state.desktopAccess = 'enabled';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await page.getByRole('button', {name: 'Access settings', exact: true}).click();
 expect(document.querySelector('.host-access-picture:not([hidden])')).toBeNull();
 expect(state.picture).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
});

it.each(['pause', 'permission loss'] as const)('collapses optional tuning after %s without losing the saved preference or reopening it', async reason => {
 await page.viewport(1024, 850); writeStoredLanguagePreference('en-US');
 state.screen = true; state.input = true; state.access = 'enabled'; state.desktopAccess = 'unconfigured';
 state.picture.mockResolvedValue({mode:'clarity', max_dimension:1920, frame_rate:30});
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await page.getByRole('button', {name: 'Access settings', exact: true}).click();
 expect(state.picture).not.toHaveBeenCalled();
 const details = document.querySelector<HTMLElement>('.host-access-picture')!;
 expect(details.dataset.open).toBe('false');
 await page.getByText('Application picture settings', {exact: true}).click();
 await expect.poll(() => state.picture.mock.calls.length).toBe(1);
 expect(state.picture).toHaveBeenCalledExactlyOnceWith('/_redeven_proxy/api/host-applications/picture', {method:'GET'});
 await expect.element(page.getByRole('combobox', {name: 'Picture quality', exact:true})).toBeEnabled();
 const fields = document.querySelector('[data-testid=application-picture-settings]');
 if (reason === 'pause') {
   const control = page.getByRole('switch', {name:'Remote application windows',exact:true}).element() as HTMLInputElement;
   await userEvent.click(control.closest('label')!);
   await page.getByRole('button', {name:'Pause',exact:true}).click();
   await expect.poll(() => state.access).toBe('paused');
 } else { state.screen = false; window.dispatchEvent(new Event('focus')); }
 await expect.poll(() => details.hidden).toBe(true);
 await expect.poll(() => details.dataset.open).toBe('false');
 expect(document.querySelector('[data-testid=application-picture-settings]')).toBe(fields);
 expect(state.picture.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
 if (reason === 'pause') {
   const control = page.getByRole('switch', {name:'Remote application windows',exact:true}).element() as HTMLInputElement;
   await userEvent.click(control.closest('label')!);
 } else { state.screen = true; window.dispatchEvent(new Event('focus')); }
 await expect.poll(() => details.hidden).toBe(false);
 expect(details.dataset.open).toBe('false');
 await page.getByText('Application picture settings', {exact:true}).click();
 expect(document.querySelector('[data-testid=application-picture-settings]')).toBe(fields);
 await expect.element(page.getByRole('combobox', {name:'Picture quality',exact:true})).toBeEnabled();
 expect(state.picture).toHaveBeenCalledTimes(1);
});

it.each(['zh-CN','en-US'] as const)('presents only the relevant settings stage in %s', async locale => {
 document.documentElement.classList.toggle('dark', locale === 'zh-CN');
 await page.viewport(1080, 850); await loadEnvAppDictionary(locale); writeStoredLanguagePreference(locale);
 const dictionary = await loadEnvAppDictionary(locale);
 state.local = true; state.permissionApp = 'Redeven Desktop Access Dev';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await page.getByRole('button', {name:dictionary.hostAccess.settings,exact:true}).click();
 const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
 await expect.poll(() => getComputedStyle(dialog).opacity).toBe('1');
 expect((await axe.run(dialog, {runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations).toEqual([]);
 await page.screenshot({element:dialog,path:`__screenshots__/host-access-stages-initial-${locale}.png`});
 state.screen = true; state.input = true; state.access = 'enabled'; window.dispatchEvent(new Event('focus'));
 await expect.poll(() => dialog.querySelector('.host-access-picture:not([hidden])')).not.toBeNull();
 expect(state.picture).not.toHaveBeenCalled();
 await page.screenshot({element:dialog,path:`__screenshots__/host-access-stages-ready-${locale}.png`});
 await page.getByText(dictionary.hostAccess.pictureSettings,{exact:true}).click();
 await expect.element(page.getByRole('combobox',{name:dictionary.hostApplications.macPicture,exact:true})).toBeEnabled();
 await page.screenshot({element:dialog,path:`__screenshots__/host-access-stages-picture-${locale}.png`});
 await page.viewport(320,850);
 expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth+1);
 expect((await axe.run(dialog, {runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations).toEqual([]);
 await page.screenshot({element:dialog,path:`__screenshots__/host-access-stages-narrow-${locale}.png`});
});


it('rechecks a cached denial with a fresh idle helper and advances only the granted permission', async () => {
 await page.viewport(900, 850); writeStoredLanguagePreference('en-US');
 state.permissionApp = 'Redeven Desktop Access Dev';
 state.permission.mockResolvedValue(undefined);
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await page.getByRole('button', {name: 'Set up application access', exact: true}).click();
 await expect.poll(() => state.check.mock.calls.length).toBe(1);
 state.check.mockImplementation(async () => { state.screen = true; });
 await page.getByRole('button', {name: 'Allow screen display', exact: true}).click();
 await expect.poll(() => state.permission.mock.calls.length).toBe(1);
 expect(document.querySelectorAll('.host-access-permission')).toHaveLength(1);
 expect(page.getByRole('button', {name:'Allow screen display', exact:true}).query()).toBeNull();
 window.dispatchEvent(new Event('focus'));
 await expect.poll(() => state.check.mock.calls.length).toBe(2);
 await expect.poll(() => document.querySelector('[aria-current=step]')?.textContent).toContain('Accessibility');
 expect(document.querySelectorAll('[data-complete=true]')).toHaveLength(1);
 expect(state.input).toBe(false); expect(state.save).not.toHaveBeenCalled(); expect(state.launch).not.toHaveBeenCalled();
 window.dispatchEvent(new Event('focus'));
 await expect.poll(() => state.check.mock.calls.length).toBe(2);
});

it('defers a return check until the permission request completes and preserves failures for retry', async () => {
 await page.viewport(420, 700); writeStoredLanguagePreference('en-US');
 const host = document.createElement('main'); document.body.append(host);
 const [busy, setBusy] = createSignal(false), [screen, setScreen] = createSignal(false);
 const check = vi.fn();
 dispose = render(() => <I18nProvider><HostAccessPermissions permissionAppName="Redeven Desktop Access Dev" screen={screen()} input={false} needsInput allowed busy={busy()} onPermission={() => setBusy(true)} onRefresh={check} /></I18nProvider>, host);
 expect(check).toHaveBeenCalledTimes(1); check.mockClear();
 await page.getByRole('button', {name:'Allow screen display',exact:true}).click();
 window.dispatchEvent(new Event('focus')); expect(check).not.toHaveBeenCalled();
 setBusy(false); await expect.poll(() => check.mock.calls.length).toBe(1);
 expect(host.querySelector('[aria-current=step]')?.textContent).toContain('Screen recording');
 await page.getByRole('button', {name:'Check again',exact:true}).click(); expect(check).toHaveBeenCalledTimes(2);
 setScreen(true); await expect.poll(() => host.querySelector('[aria-current=step]')?.textContent).toContain('Accessibility');
 expect(host.querySelectorAll('.host-access-permission')).toHaveLength(1);
});

it.each(['light', 'dark'] as const)('presents a compact permission step in %s mode', async theme => {
 await page.viewport(960, 760); await loadEnvAppDictionary('zh-CN'); writeStoredLanguagePreference('zh-CN');
 document.documentElement.classList.toggle('dark', theme === 'dark');
 state.local = true; state.access = 'enabled'; state.permissionApp = 'Redeven Desktop Access Dev';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture theme={theme} /></I18nProvider>, host);
 await page.getByRole('button', {name:'访问设置',exact:true}).click();
 await page.getByRole('region', {name:'远程应用窗口',exact:true}).getByRole('button',{name:'继续设置',exact:true}).click();
 document.documentElement.classList.toggle('dark', theme === 'dark');
 const dialog = [...document.querySelectorAll<HTMLElement>('[role=dialog]')].at(-1)!;
 expect(dialog.getBoundingClientRect().height).toBeLessThan(510);
 expect((await axe.run(dialog, {runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations).toEqual([]);
 await page.screenshot({element:dialog,path:`__screenshots__/host-access-permission-step-${theme}.png`});
});


it('keeps hidden setup passive and checks when it becomes visible', async () => {
 await page.viewport(420, 700); writeStoredLanguagePreference('en-US');
 const host = document.createElement('main'); document.body.append(host);
 const [active, setActive] = createSignal(false); const check = vi.fn();
 dispose = render(() => <I18nProvider><HostAccessPermissions active={active()} screen={false} input={false} needsInput allowed busy={false} onPermission={() => {}} onRefresh={check} /></I18nProvider>, host);
 window.dispatchEvent(new Event('focus')); expect(check).not.toHaveBeenCalled();
 setActive(true); await expect.poll(() => check.mock.calls.length).toBe(1);
 await page.getByRole('button', {name:'Allow screen display',exact:true}).click();
 setActive(false); window.dispatchEvent(new Event('focus')); expect(check).toHaveBeenCalledTimes(1);
});

it('reconciles an existing system grant when setup opens without requesting it again', async () => {
 await page.viewport(900, 850); writeStoredLanguagePreference('en-US');
 state.check.mockImplementation(async () => { state.screen = true; });
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await page.getByRole('button', {name:'Set up application access',exact:true}).click();
 await expect.poll(() => document.querySelector('[aria-current=step]')?.textContent).toContain('Accessibility');
 expect(state.permission).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
});

it.each(['light', 'dark'] as const)('keeps expanded host settings in shared rounded groups in %s', async theme => {
 document.documentElement.classList.toggle('dark', theme === 'dark');
 await page.viewport(1080, 900); await loadEnvAppDictionary('zh-CN'); writeStoredLanguagePreference('zh-CN');
 const dictionary = await loadEnvAppDictionary('zh-CN');
 state.local = true; state.screen = true; state.input = true; state.access = 'enabled'; state.desktopAccess = 'enabled'; state.permissionApp = 'Redeven Desktop Access Dev';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture theme={theme} /></I18nProvider>, host);
 await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(theme === 'dark');
 await page.getByRole('button', {name:dictionary.hostAccess.settings, exact:true}).click();
 const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
 await page.getByRole('button', {name:dictionary.hostAccess.systemSettings, exact:true}).click();
 await page.getByRole('button', {name:dictionary.hostAccess.permissionHelp, exact:true}).click();
 const settle = async () => { await expect.poll(() => dialog.getAnimations({subtree:true}).filter(animation => animation.playState === 'running').length).toBe(0); };
 await settle();
 const reference = getComputedStyle(dialog.querySelector('.host-access-feature-group')!);
 for (const group of dialog.querySelectorAll<HTMLElement>('.host-access-system, .host-access-recovery, .host-access-system .floe-settings-list')) {
   const style = getComputedStyle(group);
   expect(style.borderRadius).toBe(reference.borderRadius);
   expect(style.borderTopStyle).toBe('solid');
   expect(style.backgroundColor).toBe(reference.backgroundColor);
 }
 expect(dialog.querySelectorAll('.host-access-system-row.floe-setting-row')).toHaveLength(2);
 expect(dialog.querySelectorAll('.host-access-recovery-step.floe-setting-row')).toHaveLength(2);
 await page.screenshot({element:dialog,path:`__screenshots__/host-access-disclosures-${theme}-zh-CN.png`});
 await page.getByRole('button', {name:dictionary.hostAccess.pictureSettings, exact:true}).click();
 await expect.element(page.getByRole('combobox',{name:dictionary.hostApplications.macPicture,exact:true})).toBeEnabled();
 await settle();
 await page.screenshot({element:dialog,path:`__screenshots__/host-access-disclosures-all-${theme}-zh-CN.png`});
 await page.viewport(320, 900); await settle();
 expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
 for (const group of dialog.querySelectorAll<HTMLElement>('.floe-settings-disclosure')) {
   expect(group.scrollWidth, group.className).toBeLessThanOrEqual(group.clientWidth + 1);
   expect(group.getBoundingClientRect().right).toBeLessThanOrEqual(320);
 }
 expect((await axe.run(dialog,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations).toEqual([]);
 await page.screenshot({element:dialog,path:`__screenshots__/host-access-disclosures-narrow-${theme}-zh-CN.png`});
 const restart = page.getByRole('button',{name:dictionary.hostAccess.applyPermissions,exact:true}).element() as HTMLButtonElement;
 restart.scrollIntoView({block:'nearest'});
 await expect.poll(() => restart.getBoundingClientRect().bottom).toBeLessThanOrEqual(dialog.getBoundingClientRect().bottom);
 await page.screenshot({element:dialog,path:`__screenshots__/host-access-disclosures-recovery-${theme}-zh-CN.png`});
});

it('retires hidden recovery intent and permission callbacks when the group closes', async () => {
 await page.viewport(900, 900); writeStoredLanguagePreference('en-US');
 const host = document.createElement('main'); document.body.append(host);
 const recovery = vi.fn(), permission = vi.fn();
 dispose = render(() => <I18nProvider><HostAccessSystemPermissions permissionAppName="Redeven Desktop Access Dev" screen input allowed busy={false} onPermission={permission} onRecovery={recovery}/></I18nProvider>, host);
 const system = page.getByRole('button',{name:'Manage system permissions',exact:true});
 await system.click();
 await page.getByRole('button',{name:'Cannot find the app or permissions are not taking effect?',exact:true}).click();
 await page.getByRole('button',{name:'Apply permission changes',exact:true}).click();
 const restart = page.getByRole('button',{name:'Restart Desktop Access',exact:true}).element() as HTMLButtonElement;
 const permissionButton = host.querySelector<HTMLButtonElement>('.host-access-system-row button')!;
 await system.click();
 expect(host.querySelector('.host-access-system > .floe-settings-disclosure__panel')?.getAttribute('aria-hidden')).toBe('true');
 restart.click(); permissionButton.click();
 expect(recovery).not.toHaveBeenCalled(); expect(permission).not.toHaveBeenCalled();
 await system.click();
 expect(page.getByRole('button',{name:'Restart Desktop Access',exact:true}).query()).toBeNull();
 await expect.element(page.getByRole('button',{name:'Apply permission changes',exact:true})).toBeVisible();
});

it.each(['no-preference', 'reduce'] as const)('uses reversible Floe motion inside the host settings dialog with %s', async reducedMotion => {
 await media.emulateMediaPreferences({reducedMotion});
 await page.viewport(1080, 900); writeStoredLanguagePreference('en-US');
 state.screen = true; state.input = true; state.access = 'enabled'; state.desktopAccess = 'enabled'; state.permissionApp = 'Redeven Desktop Access Dev';
 const host = document.createElement('main'); document.body.append(host);
 dispose = render(() => <I18nProvider><HostApplicationsFixture /></I18nProvider>, host);
 await page.getByRole('button',{name:'Access settings',exact:true}).click();
 const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
 for (const selector of ['.host-access-picture','.host-access-system','.host-access-recovery']) {
   const group = dialog.querySelector<HTMLElement>(selector)!;
   const trigger = group.querySelector<HTMLButtonElement>(':scope > button')!;
   const panel = group.querySelector<HTMLElement>(':scope > .floe-settings-disclosure__panel')!;
   const sample = async () => {
     void getComputedStyle(panel).gridTemplateRows;
     trigger.click();
     void getComputedStyle(panel).gridTemplateRows;
     await new Promise(requestAnimationFrame);
     const motions = panel.getAnimations().filter(animation => (animation as CSSTransition).transitionProperty === 'grid-template-rows');
     const read = () => panel.getBoundingClientRect().height;
     motions.forEach(animation => { animation.pause(); animation.currentTime = 0; });
     const start = read();
     motions.forEach(animation => { animation.currentTime = Number(animation.effect!.getTiming().duration) / 2; });
     const middle = read();
     motions.forEach(animation => animation.finish());
     await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
     return {start,middle,end:read(),count:motions.length};
   };
   const opening = await sample();
   if (reducedMotion === 'reduce') expect(opening.count).toBe(0);
   else { expect(opening.count).toBe(1); expect(opening.middle).toBeGreaterThan(opening.start); expect(opening.middle).toBeLessThan(opening.end); }
   const closing = await sample();
   expect(panel.inert).toBe(true);
   if (reducedMotion === 'reduce') expect(closing.count).toBe(0);
   else { expect(closing.count).toBe(1); expect(closing.middle).toBeLessThan(closing.start); expect(closing.middle).toBeGreaterThan(closing.end); }
   expect(closing.end).toBe(0);
   trigger.click();
   await expect.poll(() => panel.getAnimations().length).toBe(0);
 }
 expect(state.permission).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled();
});


it.each(['zh-CN','de-DE'] as const)('keeps Linux preparation disclosures consistent and usable at 320px in %s', async locale => {
 await page.viewport(320, 900); await loadEnvAppDictionary(locale); writeStoredLanguagePreference(locale);
 const dictionary = await loadEnvAppDictionary(locale);
 const host = document.createElement('main'); host.style.padding = '12px'; document.body.append(host);
 const upload = vi.fn(), start = vi.fn();
 dispose = render(() => <I18nProvider><HostApplicationSetupPanel setup={null} allowed submitting={false} canRelay disconnected={false} inDialog
   downloadMethod="host" onDownloadMethodChange={() => {}} onStart={start} onCancel={() => {}} onReconnect={() => {}} onUpload={upload} /></I18nProvider>, host);
 expect(host.querySelector('input[type=file]')).toBeNull();
 for (const title of [dictionary.hostApplications.prepare.details, dictionary.hostApplications.prepare.offline]) {
   const trigger = page.getByRole('button',{name:title,exact:true});
   await trigger.click();
   expect(trigger.element().getAttribute('aria-expanded')).toBe('true');
 }
 const picker = host.querySelector<HTMLInputElement>('input[type=file]')!;
 expect(picker.disabled).toBe(false);
 for (const group of host.querySelectorAll<HTMLElement>('.floe-settings-disclosure')) {
   expect(group.scrollWidth).toBeLessThanOrEqual(group.clientWidth + 1);
   expect(group.getBoundingClientRect().right).toBeLessThanOrEqual(320);
   expect(getComputedStyle(group).borderTopStyle).toBe('solid');
 }
 await page.getByRole('button',{name:dictionary.hostApplications.prepare.offline,exact:true}).click();
 expect(picker.isConnected).toBe(true); expect(picker.disabled).toBe(true);
 expect(upload).not.toHaveBeenCalled(); expect(start).not.toHaveBeenCalled();
 await page.getByRole('button',{name:dictionary.hostApplications.prepare.offline,exact:true}).click();
 expect(host.querySelector('input[type=file]')).toBe(picker);
 expect((await axe.run(host,{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations).toEqual([]);
});
