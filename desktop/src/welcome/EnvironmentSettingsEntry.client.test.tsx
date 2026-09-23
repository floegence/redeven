import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from './App';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { buildDesktopSettingsSurfaceSnapshot } from '../main/settingsPageContent';
import { testDesktopPreferences, testProviderEnvironment } from '../testSupport/desktopTestHelpers';
import { desktopRuntimeTargetID } from '../shared/desktopRuntimePlacement';
import type { DesktopWelcomeSnapshot, DesktopLauncherActionRequest, DesktopLauncherActionResult, DesktopEnvironmentEntry, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import type { DesktopSettingsResult } from '../shared/settingsIPC';
import { runtimeLifecycleProgress } from '../shared/desktopRuntimeLifecycleProgress';
import { openConnectionProgress } from '../shared/desktopOpenConnectionProgress';

const disposers: Array<() => void> = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
function button(label: string) {
  const found = [...document.querySelectorAll<HTMLElement>('button, [role=tab]')].find(el => el.textContent?.trim() === label || el.getAttribute('aria-label') === label || el.title === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
const hostAccess = { kind: 'ssh_host' as const, ssh: { ssh_destination: 'fixture-host', ssh_port: 22, auth_mode: 'key_agent' as const, connect_timeout_seconds: 10 } };
const placement = { kind: 'host_process' as const, runtime_root: '/srv/redeven', bootstrap_strategy: 'auto' as const, release_base_url: '' };
const id = desktopRuntimeTargetID(hostAccess, placement);
const success: DesktopSettingsResult = { ok: true, snapshot: buildDesktopSettingsSurfaceSnapshot('environment_settings', {
  local_ui_bind: 'localhost:23998', local_ui_protocol: 'http', local_ui_password: '', local_ui_password_mode: 'keep', auto_runtime_probe_enabled: true,
}, { environment_id: id, environment_label: 'Fixture SSH', environment_kind: 'runtime_target', runtime_connection: { host_access: hostAccess, placement } }) };
async function mount(load: (request: { environment_id: string }) => Promise<DesktopSettingsResult>, action?: (request: DesktopLauncherActionRequest) => Promise<DesktopLauncherActionResult>) {
  document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const cloud = testProviderEnvironment('https://provider.example.invalid', 'cloud-fixture');
  let snapshot = buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences({
    provider_environments: [cloud],
    saved_runtime_targets: [{ schema_version: 2, id, label: 'Fixture SSH', host_access: hostAccess, placement,
      pinned: false, auto_runtime_probe_enabled: true, ssh_password: '', ssh_password_configured: false,
      created_at_ms: 1, updated_at_ms: 1, last_used_at_ms: 1 }],
  }) });
  const other = { ...structuredClone(snapshot.environments.find(entry => entry.id === id)!),
    id: 'runtime:other', label: 'Other SSH', registration_ref: { kind: 'runtime_target' as const, id: 'runtime:other' as never } };
  snapshot = { ...snapshot, environments: [...snapshot.environments, other] };
  let receive: ((value: DesktopWelcomeSnapshot) => void) | undefined;
  const performAction = vi.fn<(request: DesktopLauncherActionRequest) => Promise<DesktopLauncherActionResult>>(action ?? (async () => ({ ok: true, outcome: 'saved_environment', environment_id: id })));
  const settings = { load: vi.fn(load), save: vi.fn(async () => success), cancel: vi.fn(),
    requestRuntimeFlower: vi.fn(async () => ({ ok: false, error: { message: 'Fixture has no Flower runtime' } })),
  } as unknown as DesktopWelcomeRuntime['settings'];
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{
    launcher: { getSnapshot: async () => snapshot, performAction, subscribeSnapshot: listener => { receive = listener; return () => {}; }, getSSHConfigHosts: async () => [] }, settings,
  }} />, host));
  await settle();
  return { settings, performAction, cloud, get snapshot() { return snapshot; }, publish: (value: DesktopWelcomeSnapshot) => { snapshot = value; receive?.(value); } };
}
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('environment card settings entry', () => {
  it.each([true, false])('keeps one window and connection drafts when access load succeeds=%s', async ok => {
    const h = await mount(async () => ok ? success : { ok: false, error: 'SSH connection refused' });
    button('Settings for Fixture SSH').click(); await settle();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(h.settings.load).not.toHaveBeenCalled();
    const name = document.getElementById('ssh-settings-label') as HTMLInputElement;
    name.value = 'Unsaved name'; name.dispatchEvent(new Event('input', { bubbles: true }));
    button('Access & security').click(); await settle();
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(h.settings.load).toHaveBeenCalledWith({ environment_id: id, dialog_token: expect.any(Number) });
    if (!ok) expect(dialog?.textContent).toContain('SSH connection refused');
    button('Connection').click(); await settle();
    expect(document.getElementById('ssh-settings-label')).toBe(name);
    expect(name.value).toBe('Unsaved name');
    expect(h.performAction).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'open_environment_settings' }));
  });
  it.each([401, 403])('explains denied access %s, retains diagnostics for Copy, and retries in the same window', async status => {
    const diagnostic = `Runtime control returned HTTP ${status}: Desktop-only Local UI bridge; open this Environment from Desktop`;
    const load = vi.fn().mockResolvedValueOnce({ ok: false, error: diagnostic, code: 'RUNTIME_CONTROL_HTTP_ERROR', status_code: status }).mockResolvedValue(success);
    await mount(load);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText }, userAgent: navigator.userAgent });
    button('Settings for Fixture SSH').click(); await settle();
    input('ssh-settings-label', 'Retained draft');
    const dialog = document.querySelector('[role="dialog"]');
    button('Access & security').click(); await settle();
    expect(dialog?.textContent).toContain('The environment did not authorize Desktop to manage these settings.');
    expect(dialog?.textContent).not.toContain('open this Environment from Desktop');
    button('Copy').click(); await settle();
    expect(writeText).toHaveBeenCalledWith(`RUNTIME_CONTROL_HTTP_ERROR: ${diagnostic}`);
    button('Retry').click(); await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog?.textContent).toContain('Current connection');
    button('Connection').click(); await settle();
    expect((document.getElementById('ssh-settings-label') as HTMLInputElement).value).toBe('Retained draft');
  });
  it('opens Cloud information without Local access controls or requests', async () => {
    const h = await mount(async () => success);
    button('Settings for cloud-fixture').click(); await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('managed by Redeven Cloud');
    expect(document.getElementById('local-ui-port')).toBeNull();
    expect(h.settings.load).not.toHaveBeenCalled();
    expect(h.settings.save).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function input(id: string, value: string) {
  const field = document.getElementById(id) as HTMLInputElement;
  field.value = value; field.dispatchEvent(new Event('input', { bubbles: true }));
}
async function closeEditor() {
  document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]')!.click();
  await new Promise(resolve => setTimeout(resolve, 250));
}

type RestartRequest = Extract<DesktopLauncherActionRequest, { kind: 'restart_environment_runtime' }>;
function restartProgress(request: RestartRequest, status: 'running' | 'succeeded' | 'failed' | 'canceled' = 'running'): DesktopLauncherActionProgress {
  const phase = status === 'succeeded' ? 'runtime_ready' : 'stopping_runtime_process';
  return { action: request.kind, environment_id: request.environment_id, environment_label: 'Fixture SSH',
    operation_key: request.operation_key, started_at_unix_ms: request.operation_started_at_unix_ms,
    status, phase, title: 'Restart Runtime', detail: status === 'failed' ? 'Fixture restart failure' : 'Stopping the running Runtime.',
    cancelable: status === 'running', active_progress_surface: 'runtime_lifecycle',
    lifecycle_progress: runtimeLifecycleProgress({ location: 'ssh_host', operation: 'restart', phase,
      targetID: request.environment_id!, targetLabel: 'Fixture SSH' }),
  };
}
async function restartHarness() {
  const h = await mount(async () => success);
  h.publish({ ...h.snapshot, environments: h.snapshot.environments.map(entry => entry.id === id ? {
    ...entry, runtime_operations: { ...entry.runtime_operations, restart: { ...entry.runtime_operations.restart, availability: 'available' } },
  } : entry) });
  const jobs: Array<{ request: RestartRequest; resolve: (result: DesktopLauncherActionResult) => void }> = [];
  h.performAction.mockImplementation(request => {
    if (request.kind !== 'restart_environment_runtime') return Promise.resolve({ ok: true, outcome: 'canceled_launcher_operation' });
    const pending = deferred<DesktopLauncherActionResult>();
    jobs.push({ request, resolve: pending.resolve });
    return pending.promise;
  });
  const publish = (status: 'running' | 'succeeded' | 'failed' | 'canceled' = 'running') => {
    h.publish({ ...h.snapshot, action_progress: [restartProgress(jobs.at(-1)!.request, status)] });
  };
  const open = async () => { button('Settings for Fixture SSH').click(); await settle(); button('Access & security').click(); await settle(); };
  const submit = async () => { await open(); input('local-ui-port', '25000'); button('Save and restart').click(); await settle(); };
  return { ...h, get snapshot() { return h.snapshot; }, open, submit, jobs, progress: publish };
}
const finishMotion = () => new Promise(resolve => setTimeout(resolve, 220));
const progressPanel = () => document.querySelector('.redeven-environment-progress');

describe('settings restart handoff', () => {
  it('hands a saved draft to the card progress before restart completes', async () => {
    const restart = deferred<DesktopLauncherActionResult>();
    const h = await mount(async () => success);
    h.publish({ ...h.snapshot, environments: h.snapshot.environments.map(entry => entry.id === id ? {
      ...entry, runtime_operations: { ...entry.runtime_operations, restart: { ...entry.runtime_operations.restart, availability: 'available' } },
    } : entry) });
    h.performAction.mockImplementation(request => {
      if (request.kind !== 'restart_environment_runtime') throw new Error('Unexpected action');
      h.publish({ ...h.snapshot, action_progress: [{
        action: request.kind, environment_id: id, environment_label: 'Fixture SSH',
        operation_key: request.operation_key, started_at_unix_ms: request.operation_started_at_unix_ms,
        status: 'running', phase: 'stopping_runtime_process', title: 'Restart Runtime', detail: 'Stopping the running Runtime.',
        active_progress_surface: 'runtime_lifecycle',
        lifecycle_progress: runtimeLifecycleProgress({ location: 'ssh_host', operation: 'restart', phase: 'stopping_runtime_process',
          targetID: id, targetLabel: 'Fixture SSH' }),
      }] });
      return restart.promise;
    });
    button('Settings for Fixture SSH').click(); await settle(); button('Access & security').click(); await settle();
    input('local-ui-port', '25000'); button('Save and restart').click();
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(document.querySelector('.redeven-environment-settings-dialog')).toBeNull();
    expect(document.querySelector('.redeven-environment-progress')?.textContent).toContain('Fixture SSH');
    expect(document.querySelector('.redeven-environment-progress')?.textContent).toContain('Stopping');
    expect(h.settings.save).toHaveBeenCalledTimes(1);
    expect(h.performAction).toHaveBeenCalledTimes(1);
    restart.resolve({ ok: true, outcome: 'restarted_environment_runtime' }); await settle();
  });
  it('shows only the selected save action as pending and retains a rejected draft', async () => {
    const h = await restartHarness(), saved = deferred<DesktopSettingsResult>();
    vi.mocked(h.settings.save).mockReturnValue(saved.promise);
    await h.submit();
    expect(button('Saving…').getAttribute('disabled')).not.toBeNull();
    expect((button('Save for next restart') as HTMLButtonElement).disabled).toBe(true);
    (button('Saving…') as HTMLButtonElement).click();
    expect(h.settings.save).toHaveBeenCalledTimes(1);
    expect(h.jobs).toHaveLength(0);
    saved.resolve({ ok: false, error: 'Fixture save denied' }); await settle();
    expect(document.querySelector('.redeven-environment-settings-dialog')?.textContent).toContain('Fixture save denied');
    expect((document.getElementById('local-ui-port') as HTMLInputElement).value).toBe('25000');
    expect(h.jobs).toHaveLength(0);
  });
  it('shows admission honestly, ignores old progress, and never reopens after Escape', async () => {
    const h = await restartHarness();
    await h.submit(); await finishMotion();
    expect(progressPanel()?.textContent).toContain('Submitting restart request');
    expect(progressPanel()?.querySelector('.redeven-environment-progress__meter')).toBeNull();
    h.publish({ ...h.snapshot, action_progress: [{ ...restartProgress(h.jobs[0].request, 'failed'), operation_key: 'old', started_at_unix_ms: 1 }] });
    await settle(); expect(progressPanel()?.textContent).not.toContain('Fixture restart failure');
    h.progress(); await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await finishMotion();
    expect(progressPanel()).toBeNull();
    h.progress('succeeded'); h.jobs[0].resolve({ ok: true, outcome: 'restarted_environment_runtime' }); await settle();
    expect(progressPanel()).toBeNull();
    expect(h.performAction.mock.calls.some(([request]) => request.kind === 'cancel_launcher_operation')).toBe(false);
  });
  it('retains an instant result after snapshots retire it and returns to freshly loaded access settings', async () => {
    const h = await restartHarness(); await h.submit();
    h.progress('succeeded'); h.jobs[0].resolve({ ok: true, outcome: 'restarted_environment_runtime' });
    await finishMotion();
    expect(progressPanel()?.textContent).toContain('Settings applied. The environment is ready.');
    h.publish({ ...h.snapshot, action_progress: [] }); await settle();
    expect(progressPanel()?.textContent).toContain('Settings applied. The environment is ready.');
    expect((document.querySelector('.redeven-desktop-toast-viewport')?.textContent ?? '')).not.toContain('Runtime restarted');
    button('Return to settings').click(); await finishMotion();
    expect(document.querySelector('.redeven-environment-settings-dialog')).not.toBeNull();
    expect(h.settings.load).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe('Access & security');
  });
  it.each(['failed', 'canceled'] as const)('keeps saved settings distinct from a %s restart and retries only restart', async status => {
    const h = await restartHarness(); await h.submit(); h.progress(status);
    h.jobs[0].resolve({ ok: false, code: 'action_invalid', scope: 'environment', message: 'Fixture restart failure' });
    await finishMotion();
    expect(progressPanel()?.textContent).toContain('Settings are saved, but the restart did not complete.');
    button('Retry restart').click(); await settle();
    expect(h.jobs).toHaveLength(2);
    expect(h.jobs[1].request.operation_key).not.toBe(h.jobs[0].request.operation_key);
    expect(h.settings.save).toHaveBeenCalledTimes(1);
    expect(progressPanel()?.textContent).toContain('Submitting restart request');
    h.progress('succeeded'); h.jobs[1].resolve({ ok: true, outcome: 'restarted_environment_runtime' }); await settle();
  });
  it('keeps an admission error in the same card without inventing lifecycle progress', async () => {
    const h = await restartHarness(); await h.submit();
    h.jobs[0].resolve({ ok: false, code: 'action_invalid', scope: 'environment', message: 'Restart admission refused' }); await finishMotion();
    expect(progressPanel()?.textContent).toContain('Restart admission refused');
    expect(progressPanel()?.textContent).toContain('Settings are saved');
    expect(progressPanel()?.querySelector('.redeven-environment-progress__meter')).toBeNull();
    button('Retry restart').click(); await settle(); expect(h.settings.save).toHaveBeenCalledTimes(1);
    h.progress('succeeded'); h.jobs[1].resolve({ ok: true, outcome: 'restarted_environment_runtime' }); await settle();
  });
  it.each([false, true])('focuses the conflicting owner without claiming settings applied, delayed progress=%s', async delayed => {
    const h = await restartHarness(); await h.submit();
    const owner = { ...restartProgress(h.jobs[0].request), operation_key: 'another-operation', started_at_unix_ms: 42 };
    if (!delayed) h.publish({ ...h.snapshot, action_progress: [owner] });
    h.jobs[0].resolve({ ok: false, code: 'runtime_lifecycle_in_progress', scope: 'environment',
      message: 'Another operation is running', operation_key: owner.operation_key, environment_id: id });
    await finishMotion();
    if (delayed) { h.publish({ ...h.snapshot, action_progress: [owner] }); await settle(); }
    expect(progressPanel()).not.toBeNull();
    expect(progressPanel()?.textContent).toContain('Stopping');
    h.publish({ ...h.snapshot, action_progress: [{ ...owner, status: 'succeeded' }] }); await settle();
    expect(progressPanel()?.textContent).not.toContain('Settings applied.');
    expect(h.jobs).toHaveLength(1); expect(h.settings.save).toHaveBeenCalledTimes(1);
  });
  it('does not reveal delayed conflicting progress after its panel is dismissed', async () => {
    const h = await restartHarness(); await h.submit(); await finishMotion();
    h.jobs[0].resolve({ ok: false, code: 'runtime_lifecycle_in_progress', scope: 'environment',
      message: 'Another operation is running', operation_key: 'another-operation', environment_id: id });
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await finishMotion();
    h.publish({ ...h.snapshot, action_progress: [{ ...restartProgress(h.jobs[0].request), operation_key: 'another-operation', started_at_unix_ms: 42 }] });
    await settle(); expect(progressPanel()).toBeNull();
  });
  it('shows an existing Open operation when it rejects the settings restart', async () => {
    const h = await restartHarness(); await h.submit();
    const owner: DesktopLauncherActionProgress = {
      action: 'open_ssh_environment', environment_id: id, environment_label: 'Fixture SSH',
      operation_key: 'existing-open', started_at_unix_ms: 42, status: 'running', phase: 'opening_window',
      title: 'Opening environment', detail: 'Opening the existing session',
      active_progress_surface: 'open',
      open_progress: openConnectionProgress({ location: 'ssh_host', phase: 'opening_window', environmentID: id, environmentLabel: 'Fixture SSH', targetID: id, targetLabel: 'Fixture SSH' }),
    };
    h.publish({ ...h.snapshot, action_progress: [owner] });
    h.jobs[0].resolve({ ok: false, code: 'runtime_lifecycle_in_progress', scope: 'environment',
      message: 'Another operation is running', operation_key: owner.operation_key, environment_id: id });
    await finishMotion();
    expect(progressPanel()?.textContent).toContain('Opening');
    expect(progressPanel()?.textContent).not.toContain('Settings applied.');
  });
  it('can reopen the saved restart result and its recovery navigation after dismissal', async () => {
    const h = await restartHarness(); await h.submit();
    h.progress('succeeded'); h.jobs[0].resolve({ ok: true, outcome: 'restarted_environment_runtime' }); await finishMotion();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await finishMotion();
    expect(progressPanel()).toBeNull();
    const trigger = document.querySelector<HTMLButtonElement>(`[data-owner-id="${id}"] .redeven-split-action-primary button`)!;
    trigger.click(); await settle();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(progressPanel()?.closest('.redeven-popover-panel-collapse--open')).not.toBeNull();
    expect(progressPanel()?.textContent).toContain('Return to settings');
  });
  it('releases the saved restart result when a newer owner operation arrives', async () => {
    const h = await restartHarness(); await h.submit();
    h.progress('succeeded'); h.jobs[0].resolve({ ok: true, outcome: 'restarted_environment_runtime' }); await finishMotion();
    h.publish({ ...h.snapshot, action_progress: [{
      action: 'open_ssh_environment', environment_id: id, status: 'running', phase: 'opening_window',
      operation_key: 'subsequent-open', started_at_unix_ms: Date.now(), title: 'Opening environment', detail: '',
      active_progress_surface: 'open',
      open_progress: openConnectionProgress({ location: 'ssh_host', phase: 'opening_window', environmentID: id, environmentLabel: 'Fixture SSH', targetID: id, targetLabel: 'Fixture SSH' }),
    }] }); await settle();
    expect(progressPanel()?.textContent).toContain('Opening');
    expect(progressPanel()?.textContent).not.toContain('Settings applied.');
    expect(progressPanel()?.textContent).not.toContain('Return to settings');
  });
  it('protects the connection draft and can discard only that draft without losing access edits', async () => {
    const h = await restartHarness(); await h.open(); input('local-ui-port', '25000');
    button('Connection').click(); await settle(); input('ssh-settings-label', 'Unsaved name');
    button('Access & security').click(); await settle();
    expect((button('Save and restart') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Save for next restart') as HTMLButtonElement).disabled).toBe(false);
    button('Go to connection settings').click(); await settle();
    button('Discard connection changes').click(); await settle();
    expect((document.getElementById('ssh-settings-label') as HTMLInputElement).value).toBe('Fixture SSH');
    button('Access & security').click(); await settle();
    expect((document.getElementById('local-ui-port') as HTMLInputElement).value).toBe('25000');
    expect((button('Save and restart') as HTMLButtonElement).disabled).toBe(false);
    button('Save for next restart').click(); await settle();
    expect(h.jobs).toHaveLength(0);
    expect(document.querySelector('.redeven-environment-settings-dialog')).not.toBeNull();
  });
  it.each([true, false])('continues two-factor setup only on explicit return and owner HTTPS readiness=%s', async ready => {
    const h = await restartHarness();
    let httpsReady = false;
    const security = vi.fn(async () => ({ https_ready: httpsReady, enabled: false, password_configured: false,
      recovery_pending: false, recovery_codes_remaining: 0, revision: 1 }));
    vi.stubGlobal('redevenDesktopSettings', { ...h.settings, security });
    Object.assign(h.settings, { certificate: vi.fn(async () => ({ status: 'ready', code: '', identity: 'ready', can_manage: true, certificate_kind: 'server' })) });
    await h.open(); button('Configure HTTPS').click(); await settle();
    button('Save and restart').click(); await settle();
    h.progress('succeeded'); h.jobs[0].resolve({ ok: true, outcome: 'restarted_environment_runtime' }); await finishMotion();
    expect(document.querySelector('.redeven-environment-settings-dialog')).toBeNull();
    expect(progressPanel()?.textContent).toContain('Continue two-factor setup');
    expect(security).toHaveBeenCalledTimes(1);
    httpsReady = ready;
    button('Continue two-factor setup').click(); await finishMotion();
    expect(security).toHaveBeenCalledTimes(2);
    if (ready) expect(document.activeElement?.textContent).toBe('Set up');
    else expect(document.querySelector('.two-factor-setting')?.textContent).toContain('Set up HTTPS first');
  });
  it('does not restart a registration removed while saving', async () => {
    const h = await restartHarness(), saved = deferred<DesktopSettingsResult>();
    vi.mocked(h.settings.save).mockReturnValue(saved.promise); await h.submit();
    h.publish({ ...h.snapshot, environments: h.snapshot.environments.filter(entry => entry.id !== id) });
    saved.resolve(success); await finishMotion();
    expect(h.jobs).toHaveLength(0); expect(progressPanel()).toBeNull();
  });
});

describe('settings entry asynchronous isolation', () => {
  it.each(['Fixture SSH', 'Other SSH'])('ignores a delayed response after reopening %s from its card', async label => {
    const old = deferred<DesktopSettingsResult>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue({ ok: false, error: 'Current target diagnostic' });
    await mount(load);
    button('Settings for Fixture SSH').click(); await settle();
    button('Access & security').click(); await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Loading access settings');
    await closeEditor();
    button(`Settings for ${label}`).click(); await settle();
    const dialog = document.querySelector('[role="dialog"]');
    button('Access & security').click(); await settle();
    old.resolve(success); await settle();
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog?.textContent).toContain('Current target diagnostic');
    expect(dialog?.textContent).not.toContain('Current connection');
    button('Connection').click(); await settle();
    expect((document.getElementById('ssh-settings-label') as HTMLInputElement).value).toBe(label);
  });
  it('does not deliver a closed connection save failure into the next editor', async () => {
    const old = deferred<DesktopLauncherActionResult>();
    await mount(async () => success, () => old.promise);
    button('Settings for Fixture SSH').click(); await settle();
    input('ssh-settings-label', 'Renamed'); button('Save changes').click(); await settle();
    await closeEditor(); button('Settings for Other SSH').click(); await settle();
    old.resolve({ ok: false, code: 'action_invalid', scope: 'dialog', message: 'Old save rejected' } as DesktopLauncherActionResult);
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Old save rejected');
    expect((document.getElementById('ssh-settings-label') as HTMLInputElement).value).toBe('Other SSH');
  });
  it('closes a deleted target and ignores its pending access response', async () => {
    const old = deferred<DesktopSettingsResult>();
    const h = await mount(() => old.promise);
    button('Settings for Fixture SSH').click(); await settle(); button('Access & security').click();
    h.publish({ ...h.snapshot, environments: h.snapshot.environments.filter(entry => entry.id !== id) });
    await new Promise(resolve => setTimeout(resolve, 250));
    old.resolve(success); await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });
  it('blocks a connection identity edit only while access changes remain, then rebinds the committed ID', async () => {
    const h = await mount(async request => success.ok ? { ...success, snapshot: { ...success.snapshot, environment_id: request.environment_id } } : success);
    button('Settings for Fixture SSH').click(); await settle();
    button('Access & security').click(); await settle(); input('local-ui-port', '25000');
    button('Connection').click(); await settle(); input('ssh-settings-ssh_destination', 'new-host');
    expect((button('Save changes') as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Save or discard');
    button('Access & security').click(); await settle(); input('local-ui-port', '23998');
    button('Connection').click(); await settle();
    expect((button('Save changes') as HTMLButtonElement).disabled).toBe(false);
    const target = h.snapshot.environments.find(entry => entry.id === id)!;
    const committedID = 'runtime:committed';
    h.performAction.mockImplementation(async () => {
      h.publish({ ...h.snapshot, environments: h.snapshot.environments.map(entry => entry.id === id ? {
        ...target, id: committedID, registration_ref: { kind: 'runtime_target', id: committedID as never },
        ssh_details: { ...target.ssh_details!, ssh_destination: 'new-host' },
      } : entry) });
      return { ok: true, outcome: 'saved_environment', environment_id: committedID };
    });
    button('Save changes').click(); await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect((document.getElementById('ssh-settings-ssh_destination') as HTMLInputElement).value).toBe('new-host');
    button('Access & security').click(); await settle();
    expect(h.settings.load).toHaveBeenLastCalledWith({ environment_id: committedID, dialog_token: expect.any(Number) });
  });
  it('preserves an access draft while saving only a connection name', async () => {
    const h = await mount(async () => success);
    button('Settings for Fixture SSH').click(); await settle(); button('Access & security').click(); await settle();
    input('local-ui-port', '25000'); button('Connection').click(); await settle(); input('ssh-settings-label', 'Renamed');
    h.performAction.mockImplementation(async () => {
      h.publish({ ...h.snapshot, environments: h.snapshot.environments.map(entry => entry.id === id ? { ...entry, label: 'Renamed' } : entry) });
      return { ok: true, outcome: 'saved_environment', environment_id: id };
    });
    button('Save changes').click(); await settle(); button('Access & security').click(); await settle();
    expect((document.getElementById('local-ui-port') as HTMLInputElement).value).toBe('25000');
    expect(h.settings.save).not.toHaveBeenCalled(); expect(h.settings.load).toHaveBeenCalledTimes(1);
  });
  it('uses the shared SSH form and validation for creation', async () => {
    const h = await mount(async () => success);
    button('SSH').click(); await settle();
    input('ssh-settings-ssh_destination', 'new-host'); input('ssh-settings-label', 'Created');
    button('Save changes').click(); await settle();
    expect(h.performAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'upsert_environment_registration', registration: expect.objectContaining({ label: 'Created' }) }));
  });

  it('opens Local directly in access settings without a connection tab', async () => {
    const h = await mount(async request => success.ok ? { ...success, snapshot: { ...success.snapshot, environment_id: request.environment_id, environment_kind: 'local' } } : success);
    const local = h.snapshot.environments.find(entry => entry.registration_ref?.kind === 'local_environment')!;
    button(`Settings for ${local.label}`).click(); await settle();
    expect(h.settings.load).toHaveBeenCalledWith({ environment_id: local.id, dialog_token: expect.any(Number) });
    expect(document.querySelector('[role="dialog"] [role="tablist"]')).toBeNull();
    expect(document.getElementById('local-ui-port')).not.toBeNull();
  });
  it.each(['wsl', 'container', 'url', 'gateway'] as const)('opens the %s connection section without access I/O', async kind => {
    const h = await mount(async () => ({ ok: false, code: 'SETTINGS_WSL_STOPPED', error: 'WSL stopped' }));
    const original = h.snapshot.environments.find(entry => entry.id === id)!;
    const entry: DesktopEnvironmentEntry = { ...original, id: `fixture-${kind}`, label: `Fixture ${kind}`,
      ...(kind === 'wsl' ? { kind: 'wsl_environment', managed_runtime_host_access: { kind: 'wsl_host', distribution_name: 'Ubuntu', linux_user: 'dev' } } : {}),
      ...(kind === 'container' ? { managed_runtime_host_access: { kind: 'local_host' }, managed_runtime_placement: {
        kind: 'container_process', container_engine: 'docker', container_id: 'fixture-container', container_ref: 'fixture-container', container_label: 'Container', runtime_root: '/root/.redeven', bridge_strategy: 'exec_stream',
      } } : {}),
      ...(kind === 'url' ? { kind: 'external_local_ui', registration_ref: { kind: 'saved_environment', id: 'fixture-url' }, local_ui_url: 'https://example.invalid/' } : {}),
      ...(kind === 'gateway' ? { kind: 'gateway_environment', registration_ref: { kind: 'gateway_environment', gateway_id: 'fixture-gateway', gateway_env_id: 'fixture-profile' }, gateway_environment_profile_access_route: { kind: 'url', url: 'https://example.invalid/' } } : {}),
    };
    h.publish({ ...h.snapshot, environments: [...h.snapshot.environments, entry] }); await settle();
    button(`Settings for Fixture ${kind}`).click(); await settle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(h.settings.load).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"] [role="tablist"]') !== null).toBe(kind === 'wsl' || kind === 'container');
    if (kind === 'wsl') {
      expect(document.getElementById('wsl-settings-name')).not.toBeNull();
      button('Access & security').click(); await settle();
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Start this WSL');
      expect(h.performAction).not.toHaveBeenCalled();
      button('Connection').click(); await settle(); input('wsl-settings-name', 'Renamed WSL');
      h.performAction.mockResolvedValue({ ok: false, code: 'action_invalid', scope: 'dialog', message: 'WSL name save failed' } as DesktopLauncherActionResult);
      button('Save changes').click(); await settle();
      expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('WSL name save failed');
      expect((document.getElementById('wsl-settings-name') as HTMLInputElement).value).toBe('Renamed WSL');
    }
    if (kind === 'gateway') {
      await closeEditor(); h.publish({ ...h.snapshot, environments: [...h.snapshot.environments.filter(value => value.id !== entry.id), { ...entry, can_edit: false }] }); await settle();
      expect([...document.querySelectorAll('button')].some(el => el.getAttribute('aria-label') === 'Settings for Fixture gateway')).toBe(false);
    }
  });

  it('finishes a submitted save-and-restart for its original target after the window closes', async () => {
    const h = await mount(async () => success);
    const saved = deferred<DesktopSettingsResult>();
    vi.mocked(h.settings.save).mockReturnValue(saved.promise);
    h.publish({ ...h.snapshot, environments: h.snapshot.environments.map(entry => entry.id === id ? {
      ...entry, runtime_operations: { ...entry.runtime_operations, restart: { ...entry.runtime_operations.restart, availability: 'available' } },
    } : entry) });
    button('Settings for Fixture SSH').click(); await settle(); button('Access & security').click(); await settle();
    input('local-ui-port', '25000'); button('Save and restart').click(); await settle();
    await closeEditor(); button('Settings for Other SSH').click(); await settle();
    saved.resolve(success); await settle();
    expect(h.performAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'restart_environment_runtime', environment_id: id }));
    expect((document.getElementById('ssh-settings-label') as HTMLInputElement).value).toBe('Other SSH');
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('could not restart');
  });

});


describe('environment card refresh continuity', () => {
  it('updates copy availability and values in retained fact rows', async () => {
    const h = await mount(async () => success);
    const copy = vi.fn(async () => {});
    vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
    const refresh = (env_public_id: string) => h.publish({ ...structuredClone(h.snapshot),
      environments: h.snapshot.environments.map(entry => entry.kind === 'provider_environment'
        ? { ...entry, env_public_id } : { ...entry }),
    });
    refresh(''); await settle();
    const card = button('Settings for cloud-fixture').closest('.redeven-environment-card')!;
    const fact = [...card.querySelectorAll('.redeven-card-fact-row')].find(row => row.querySelector('.redeven-card-fact-label')?.textContent === 'ENV ID')!;
    const value = fact.querySelector<HTMLElement>('.redeven-card-fact-value')!;
    value.click(); expect(copy).not.toHaveBeenCalled();
    refresh('current-environment-id'); await settle();
    expect(fact.querySelector('.redeven-card-fact-value')).toBe(value);
    value.click(); await settle();
    expect(copy).toHaveBeenLastCalledWith('current-environment-id');
    refresh('next-environment-id'); await settle();
    expect(value.querySelector('.redeven-card-fact-copy-icon--active')).toBeNull();
    value.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();
    expect(copy).toHaveBeenLastCalledWith('next-environment-id');
    refresh(''); await settle(); copy.mockClear();
    value.click(); value.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(copy).not.toHaveBeenCalled();
  });

  it('preserves the open endpoint surface, focus, selection and QR through fresh snapshots', async () => {
    const h = await mount(async () => success);
    const urls = ['https://192.0.2.20:23998/', 'http://localhost:23998/'];
    const refreshed = (addresses = urls) => ({ ...structuredClone(h.snapshot), environments: h.snapshot.environments.map(entry => ({
      ...structuredClone(entry), ...(entry.id === id ? { local_ui_url: addresses[0] ?? '', local_ui_urls: addresses,
        runtime_health: { ...entry.runtime_health, status: 'online' as const, freshness: 'fresh' as const },
      } : {}),
    })) });
    h.publish(refreshed()); await settle();
    const card = button('Settings for Fixture SSH').closest('.redeven-environment-card')!;
    const factBlock = card.querySelector('.redeven-card-facts-block');
    const factRow = factBlock!.firstElementChild;
    const trigger = card.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
    trigger.click(); await settle();
    button('Share connection').click(); await settle();
    const panel = document.querySelector('.redeven-endpoints-popover');
    const host = panel!.querySelector('[data-endpoint-id="host"]')!;
    const value = host.querySelector('.redeven-card-endpoint-value')!;
    const copy = button('Copy SSH host');
    const qr = panel!.querySelector('img');
    copy.focus();
    const range = document.createRange(); range.selectNodeContents(value);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    for (let tick = 0; tick < 4; tick++) {
      const next = refreshed(tick % 2 ? [...urls].reverse() : urls);
      h.publish({ ...next, environments: next.environments.map(entry => entry.id === id
        ? { ...entry, label: `Fixture SSH ${tick}` } : entry) });
      await settle();
      expect(button(`Settings for Fixture SSH ${tick}`).closest('.redeven-environment-card')).toBe(card);
      expect(card.querySelector('.redeven-card-facts-block')).toBe(factBlock);
      expect(factBlock!.firstElementChild).toBe(factRow);
      expect(document.querySelector('.redeven-endpoints-popover')).toBe(panel);
      expect(card.querySelector('[aria-haspopup="dialog"]')).toBe(trigger);
      expect(panel!.querySelector('[data-endpoint-id="host"]')).toBe(host);
      expect(document.activeElement).toBe(copy);
      expect(selection.toString()).toBe('fixture-host:22');
      expect(panel!.querySelector('img')).toBe(qr);
      expect(panel!.textContent).toContain(`Fixture SSH ${tick}`);
    }
    h.publish(refreshed(['http://localhost:23998/'])); await settle();
    expect(document.querySelector('.redeven-endpoints-popover')).toBe(panel);
    expect(panel!.querySelector('img')).toBeNull();
    expect(panel!.textContent).not.toContain('192.0.2.20');
    h.publish({ ...h.snapshot, environments: h.snapshot.environments.filter(entry => entry.id !== id) });
    await settle();
    expect(document.querySelector('.redeven-endpoints-popover')).toBeNull();
  });
});
