import { EnvironmentSettingsDialog } from './EnvironmentSettingsDialog';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { EnvironmentAccessSettingsForm } from './App';
import { createDesktopI18n } from '../shared/i18n';
import { buildDesktopSettingsSurfaceSnapshot } from '../main/settingsPageContent';
import { applyDesktopAccessModeToDraft, applyDesktopAccessFixedPortToDraft } from '../shared/desktopAccessModel';
import type { DesktopCertificateReport, DesktopCertificateRequest } from '../shared/desktopCertificate';
import type { SecurityRequest, SecurityResult } from '../shared/runtimeSecurity';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';
import { IDLE_LAUNCHER_BUSY_STATE } from './launcherBusyState';

const disposers: Array<() => void> = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find((item) => !item.closest('[hidden], [aria-hidden="true"]') && (item.textContent?.trim() === label || item.getAttribute('aria-label') === label));
  if (!result) throw new Error(`Button missing: ${label}`);
  return result;
}

async function mount(options: { url?: string; protocol?: 'http' | 'https' | 'legacy'; remote?: boolean; urls?: string[]; pending?: boolean; passwordConfigured?: boolean; security?: (request: SecurityRequest) => Promise<SecurityResult>; certificate?: (request: DesktopCertificateRequest) => Promise<DesktopCertificateReport> } = {}) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const host = document.createElement('div');
  document.body.append(host);
  const baseline: DesktopSettingsDraft = {
    local_ui_bind: 'localhost:23998', local_ui_protocol: options.protocol === 'legacy' ? undefined : options.protocol ?? 'http',
    local_ui_password: '', local_ui_password_mode: 'keep', auto_runtime_probe_enabled: true,
  };
  const url = options.url ?? '';
  const snapshot = { ...buildDesktopSettingsSurfaceSnapshot('environment_settings', baseline, {
    environment_id: 'local', environment_label: 'Local Environment', environment_kind: options.remote ? 'runtime_target' : 'local',
    runtime_connection: { host_access: options.remote ? { kind: 'ssh_host', ssh: { ssh_destination: 'gzcom', ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 } } : { kind: 'local_host' }, placement: { kind: 'host_process', runtime_root: '' } },
    current_runtime_url: url, current_runtime_urls: options.urls ?? (url ? [url] : []), current_runtime_running: Boolean(url),
    local_ui_password_configured: options.passwordConfigured ?? true,
  }), runtime_configuration_pending: options.pending };
  const [draft, setDraft] = createSignal(baseline);
  const [liveSnapshot, setSnapshot] = createSignal(snapshot);
  const [isOpen, setOpen] = createSignal(true);
  const [runtimeStatus, setRuntimeStatus] = createSignal(url ? 'Running' : 'Not running');
  const [settingsError, setSettingsError] = createSignal('');
  const copy = vi.fn(async () => {});
  const save = vi.fn(async () => {});
  const open = vi.fn(async () => {});
  const certificate = vi.fn(options.certificate ?? (async () => ({ status: 'failed', code: 'local_ui_device_ca_missing' })));
  disposers.push(render(() => (
    <EnvironmentSettingsDialog open={isOpen()} environment={{ id: 'local', label: 'Local Environment',
      registration_ref: { kind: options.remote ? 'runtime_target' : 'local_environment', id: 'local' } } as DesktopEnvironmentEntry}
      tab="access" i18n={createDesktopI18n('en-US')} onClose={() => setOpen(false)} onTabChange={() => {}} connection={null} access={(
    <EnvironmentAccessSettingsForm open={isOpen()} snapshot={liveSnapshot()} baselineSnapshot={liveSnapshot()} draft={draft()}
      i18n={createDesktopI18n('en-US')} busyState={IDLE_LAUNCHER_BUSY_STATE} settingsError={settingsError()}
      settingsErrorRef={() => {}} updateDraftField={(name, value) => setDraft((current) => ({ ...current, [name]: value, ...(name === 'local_ui_password' ? {local_ui_password_mode: value ? 'replace' : 'keep'} : {}) }))}
      applyAccessMode={(mode) => setDraft((current) => applyDesktopAccessModeToDraft(current, mode))}
      applyAccessFixedPort={(port) => setDraft((current) => applyDesktopAccessFixedPortToDraft(current, port))}
      toggleAutoPort={() => {}} saveSettings={save} runtimeRestartAvailable={Boolean(url)} runtimeRunning={Boolean(url)}
      runtimeStatusLabel={runtimeStatus()} runtimeStatusTone="neutral" dark={false}
      desktopOpenLabel="Open Env App" openInDesktop={() => {}} openInBrowser={open} copyEnvironmentValue={copy}
      resetAccess={() => setDraft(baseline)} cancelSettings={() => setOpen(false)} clearStoredLocalUIPassword={() => setDraft(current => ({...current, local_ui_password: '', local_ui_password_mode: 'clear'}))} certificate={certificate} security={options.security} />)} />
  ), host));
  await settle();
  return { snapshot, draft, setDraft, copy, save, open, certificate, setSnapshot, setOpen, setRuntimeStatus, setSettingsError };
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function input(id: string, value: string) {
  const field = document.getElementById(id) as HTMLInputElement;
  field.value = value; field.dispatchEvent(new Event('input', { bubbles: true }));
}
async function editAccess() { button('Change access').click(); await settle(); }
async function review() { button('Review changes').click(); await settle(); }
const ready = { status: 'ready', code: '', identity: 'ready', trust: 'untrusted', can_manage: true, can_install: true };
const disabledSecurity: SecurityResult = { https_ready: true, enabled: false, password_configured: true, recovery_pending: false, recovery_codes_remaining: 0, revision: 1 };

describe('Environment access workflows', () => {
  it('starts with task summaries and opens only the selected configuration workflow', async () => {
    await mount();
    expect(document.querySelector('#local-ui-port')).toBeNull();
    expect(document.querySelector('#local-ui-password')).toBeNull();
    await editAccess();
    expect(document.querySelector('[aria-label="Connection security"]')).not.toBeNull();
    expect(document.querySelector('#local-ui-password')).toBeNull();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });
  it('keeps save failures beside fixed actions and retains the draft for editing', async () => {
    const test = await mount(); await editAccess(); input('local-ui-port', '26000'); await review();
    const viewport = document.querySelector<HTMLElement>('.environment-settings-scroll')!;
    viewport.scrollTop = 120; test.setSettingsError('Connection lost while saving.'); await settle();
    expect(document.getElementById('settings-error')?.closest('.environment-settings-actions')).not.toBeNull();
    expect(viewport.scrollTop).toBe(120);
    button('Edit changes').click(); await settle();
    expect((document.getElementById('local-ui-port') as HTMLInputElement).value).toBe('26000');
  });
  it('guides HTTP through identity verification and explicit two-factor commit in the same window', async () => {
    const status = { ...disabledSecurity, enabled: true };
    const requests: SecurityRequest[] = [];
    const test = await mount({protocol:'https',url:'https://localhost:23998/',certificate:async()=>ready,security:async request=>{
      requests.push(request);
      if(request.action==='disable') return {...status,operation_id:'disable-op'};
      if(request.action==='commit') return {...disabledSecurity,revision:2};
      return status;
    }});
    await editAccess(); button('HTTP').click(); button('Verify and continue').click(); await settle();
    expect(requests.map(r=>r.action)).toEqual(['status']);
    button('Verify and continue').click(); await settle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    const fields=[...document.querySelectorAll<HTMLInputElement>('.two-factor-form input')];
    fields[0].value='owner';fields[0].dispatchEvent(new Event('input',{bubbles:true}));fields[1].value='123456';fields[1].dispatchEvent(new Event('input',{bubbles:true}));
    button('Continue').click();await settle();
    expect(requests.at(-1)?.action).toBe('disable');expect(test.save).not.toHaveBeenCalled();
    button('Turn off two-factor').click();await settle();
    expect(requests.at(-1)).toEqual({action:'commit',operation_id:'disable-op',saved:false});
    expect(document.body.textContent).toContain('Two-factor is now off');expect(document.body.textContent).toContain('Review and apply');
    button('Save and restart').click();expect(test.save).toHaveBeenCalledWith({restartRuntime:true});
  });
  it('does not undo a committed security change when the remaining access task is canceled', async () => {
    let enabled=true;
    const test=await mount({protocol:'https',security:async request=>{
      if(request.action==='commit')enabled=false;
      return {...disabledSecurity,enabled,operation_id:request.action==='disable'?'disable-op':undefined};
    }});
    button('Manage protection').click();await settle();button('Change password').click();button('Verify and continue').click();await settle();
    const fields=[...document.querySelectorAll<HTMLInputElement>('.two-factor-form input')];fields.forEach((f,i)=>{f.value=i?'123456':'owner';f.dispatchEvent(new Event('input',{bubbles:true}));});
    button('Continue').click();await settle();button('Turn off two-factor').click();await settle();
    expect(document.getElementById('local-ui-password')).not.toBeNull();button('Cancel').click();await settle();
    expect(enabled).toBe(false);expect(test.save).not.toHaveBeenCalled();expect(document.body.textContent).toContain('Two-factor is now off');
  });
  it('requires recovery before a protected password change without sending disable credentials', async () => {
    const manage=vi.fn(async()=>({...disabledSecurity,enabled:false,recovery_pending:true}));
    await mount({protocol:'https',security:manage});button('Manage protection').click();await settle();button('Change password').click();await settle();
    expect(document.body.textContent).toContain('Restore two-factor protection first');button('Set up').click();await settle();
    expect(document.querySelectorAll('.two-factor-form input[type="password"]')).toHaveLength(2);expect(manage).toHaveBeenCalledTimes(1);
  });
  it('collects and confirms a password in the first network access workflow', async () => {
    const test=await mount({passwordConfigured:false});await editAccess();button('Network-reachable devices').click();await review();
    expect(document.getElementById('local-ui-password')).not.toBeNull();input('local-ui-password','new-secret');input('access-password-confirm','wrong');button('Continue').click();await settle();
    expect(document.body.textContent).toContain('The passwords do not match');expect(test.save).not.toHaveBeenCalled();
    input('access-password-confirm','new-secret');button('Continue').click();await settle();
    expect(document.body.textContent).toContain('Review and apply');expect(document.querySelector('.access-flow-review')?.textContent).not.toContain('new-secret');
    button('Save for next restart').click();expect(test.save).toHaveBeenCalledWith(undefined);
  });
  it('rejects an oversized multibyte password before saving', async () => {
    const test=await mount();button('Manage protection').click();await settle();button('Change password').click();await settle();
    input('local-ui-password','密'.repeat(25));input('access-password-confirm','密'.repeat(25));button('Continue').click();await settle();
    expect(document.body.textContent).toContain('at most 72 UTF-8 bytes');expect(test.save).not.toHaveBeenCalled();
  });
  it('reviews password removal together with the required local-only access change', async () => {
    const test=await mount();test.setDraft(d=>({...d,local_ui_bind:'0.0.0.0:23998'}));button('Manage protection').click();await settle();button('Remove stored password').click();await settle();
    expect(test.draft().local_ui_bind).toBe('localhost:23998');expect(test.draft().local_ui_password_mode).toBe('clear');expect(document.body.textContent).toContain('Review both changes');
  });
  it('preserves advanced edits and focus across unrelated runtime snapshots', async () => {
    const test=await mount({url:'http://localhost:23998/'});await editAccess();const details=document.querySelector<HTMLDetailsElement>('.environment-access-advanced')!;details.open=true;await settle();
    const field=document.getElementById('local-ui-port') as HTMLInputElement;input('local-ui-port','26000');field.focus();field.setSelectionRange(1,3);
    const viewport=field.closest<HTMLElement>('.environment-settings-scroll')!;viewport.scrollTop=180;
    for(let n=0;n<3;n++){test.setSnapshot(s=>({...structuredClone(s),current_runtime_urls:['http://localhost:24120/']}));await settle();
      expect(document.getElementById('local-ui-port')).toBe(field);expect(field.value).toBe('26000');expect(document.activeElement).toBe(field);expect([field.selectionStart,field.selectionEnd]).toEqual([1,3]);expect(details.open).toBe(true);expect(viewport.scrollTop).toBe(180);}
    expect(test.certificate).toHaveBeenCalledTimes(1);
  });
  it('validates an invalid listening port in the access step',async()=>{
    const test=await mount();await editAccess();input('local-ui-port','99999');await review();expect(document.body.textContent).toContain('1 to 65535');expect(document.activeElement?.id).toBe('local-ui-port');expect(test.save).not.toHaveBeenCalled();
  });
  it('keeps saved settings pending when reopened, with an explicit review before restart',async()=>{
    const test=await mount({url:'http://localhost:24120/',pending:true});expect(document.body.textContent).toContain('Changes not yet applied');await review();button('Save and restart').click();expect(test.save).toHaveBeenCalledWith({restartRuntime:true});
  });
  it('blocks HTTPS restart until certificate inspection completes but allows saving for later',async()=>{
    let finish!:(r:DesktopCertificateReport)=>void;
    const test=await mount({protocol:'https',url:'http://localhost:23998/',pending:true,certificate:()=>new Promise(r=>{finish=r})});
    test.setDraft(d=>({...d,local_ui_bind:'localhost:26000'}));await review();expect(button('Save and restart').disabled).toBe(true);expect(button('Save for next restart').disabled).toBe(false);
    const anchor=button('Save and restart').closest<HTMLElement>('[data-redeven-tooltip-anchor]')!;expect(anchor.tabIndex).toBe(0);anchor.focus();await settle();expect(document.querySelector('[role="tooltip"]')?.textContent).toContain('valid certificate');
    finish(ready);await settle();expect(button('Save and restart').disabled).toBe(false);
  });
  it('prepares HTTPS for enrollment and hands off without automatically beginning security setup',async()=>{
    const security=vi.fn(async()=>({...disabledSecurity,https_ready:false}));
    const test=await mount({url:'http://localhost:23998/',security,certificate:async r=>r.operation==='status'?{...ready,identity:'missing'}:{...ready,status:'updated'}});
    button('Manage protection').click();await settle();button('Configure HTTPS').click();await settle();expect(test.draft().local_ui_protocol).toBe('https');
    expect(button('Save and restart').disabled).toBe(true);button('Create certificate').click();await settle();expect(button('Save and restart').disabled).toBe(false);
    button('Save and restart').click();expect(test.save).toHaveBeenCalledWith({restartRuntime:true,continueTwoFactor:true});expect(security.mock.calls).toHaveLength(1);
  });
  it('keeps certificate details and status through task navigation without repeating reads',async()=>{
    const test=await mount({certificate:async()=>({...ready,certificate_path:'/isolated/device-ca.pem'})});button('Manage certificate').click();await settle();const detail=document.querySelector<HTMLDetailsElement>('details')!;detail.open=true;
    button('Back to overview').click();await settle();await editAccess();button('Back to overview').click();button('Manage certificate').click();await settle();expect(document.querySelector('details')).toBe(detail);expect(detail.open).toBe(true);expect(test.certificate).toHaveBeenCalledTimes(1);
    test.setOpen(false);await settle();test.setOpen(true);await settle();expect(test.certificate).toHaveBeenCalledTimes(2);
  });
  it('preserves legacy HTTP defaults and stored passwords when changing access scope',async()=>{
    const test=await mount({protocol:'legacy'});await editAccess();expect(button('HTTP').getAttribute('aria-checked')).toBe('true');button('Network-reachable devices').click();expect(test.draft().local_ui_password_mode).toBe('keep');button('This device only').click();expect(test.draft().local_ui_password_mode).toBe('keep');
  });
  it('keeps a large address list filter stable across runtime updates and clears it for a new target',async()=>{
    const urls=Array.from({length:100},(_,n)=>`https://192.0.2.${n+1}:23998/`);const test=await mount({remote:true,url:urls[0],urls});const group=document.querySelector('[data-address-scope="network"]')!;
    const filter=group.querySelector<HTMLInputElement>('[aria-label="Filter addresses"]')!;filter.value='.100:';filter.dispatchEvent(new Event('input',{bubbles:true}));test.setSnapshot(s=>({...s,current_runtime_urls:[...urls].reverse()}));await settle();expect(filter.value).toBe('.100:');expect(group.querySelectorAll('[data-endpoint-kind="address"]')).toHaveLength(1);
    button('Copy Environment URL').click();expect(test.copy).toHaveBeenCalledWith(urls[99],'Environment URL');test.setSnapshot(s=>({...s,environment_id:'another'}));await settle();expect((document.querySelector('[aria-label="Filter addresses"]') as HTMLInputElement).value).toBe('');
  });
  it('separates remote listeners from browser addresses and never opens remote loopback',async()=>{
    const test=await mount({remote:true,url:'http://localhost:23998/'});expect(document.querySelector('.redeven-endpoint-listener')).not.toBeNull();expect(document.body.textContent).toContain('Only inside gzcom');expect(document.querySelector('[aria-label="Open in browser"]')).toBeNull();expect(document.querySelector('[aria-label="Copy Environment URL"]')).toBeNull();expect(document.querySelector('[aria-label="Copy SSH host"]')).not.toBeNull();expect(test.open).not.toHaveBeenCalled();
  });
  it('selects a reachable network address when a remote host also reports loopback',async()=>{
    const test=await mount({remote:true,url:'http://localhost:23998/',urls:['http://localhost:23998/','http://192.0.2.20:23998/']});button('Open in browser').click();expect(test.open).toHaveBeenCalledWith('http://192.0.2.20:23998/');
  });
  it('keeps the live endpoint stable while reviewing draft changes and both save timings',async()=>{
    const test=await mount({url:'http://localhost:24120/'});await editAccess();input('local-ui-port','26000');button('Back to overview').click();await settle();expect(document.body.textContent).toContain('http://localhost:24120/');expect(document.body.textContent).not.toContain('http://localhost:26000/');button('Copy Environment URL').click();expect(test.copy).toHaveBeenCalledWith('http://localhost:24120/',expect.any(String));await review();button('Save for next restart').click();await settle();expect(test.save).toHaveBeenCalledWith(undefined);button('Save and restart').click();expect(test.save).toHaveBeenCalledWith({restartRuntime:true});
  });
  it('does not present a saved listener as a running endpoint',async()=>{
    await mount();expect(document.body.textContent).toContain('Not running');expect(document.body.textContent).not.toContain('http://');expect(document.querySelector('img')).toBeNull();expect(document.querySelector('[aria-label="Share connection"]')).toBeNull();
  });
  it('shares network addresses and clears QR state when the target or address changes',async()=>{
    const test=await mount({url:'https://192.0.2.20:23998/',remote:true});button('Share connection').click();await settle();expect(document.querySelector('.redeven-endpoint-qr-image')).not.toBeNull();test.setSnapshot(s=>({...s,environment_id:'other'}));await settle();expect(document.querySelector('.redeven-endpoint-qr-image')).toBeNull();button('Share connection').click();await settle();test.setSnapshot(s=>({...s,current_runtime_url:'http://localhost:23998/',current_runtime_urls:['http://localhost:23998/']}));await settle();expect(document.querySelector('.redeven-endpoint-qr-image')).toBeNull();expect(document.querySelector('[aria-label="Share connection"]')).toBeNull();
  });
  it('keeps local loopback browser access without a cross-device QR code or implicit trust',async()=>{
    const test=await mount({url:'https://localhost:23998/',protocol:'https'});expect(test.certificate).toHaveBeenCalledWith({environment_id:'local',operation:'status'});expect(test.certificate).not.toHaveBeenCalledWith(expect.objectContaining({operation:'install'}));expect(document.querySelector('[aria-label="Share connection"]')).toBeNull();button('Open in browser').click();expect(test.open).toHaveBeenCalledWith('https://localhost:23998/');
  });
});
