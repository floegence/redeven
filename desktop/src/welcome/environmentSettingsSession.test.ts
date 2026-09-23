import { describe, expect, it, vi } from 'vitest';
import type { DesktopEnvironmentEntry } from '../shared/desktopLauncherIPC';
import type { DesktopSettingsResult } from '../shared/settingsIPC';
import { buildDesktopSettingsSurfaceSnapshot } from '../main/settingsPageContent';
import { createEnvironmentSettingsController, environmentHasAccessSettings } from './environmentSettingsSession';

const environment = (id = 'ssh:fixture', kind: 'runtime_target' | 'local_environment' = 'runtime_target') => ({
  id, label: id, registration_ref: { kind, id },
}) as DesktopEnvironmentEntry;
const result = (id = 'ssh:fixture', port = '23998'): DesktopSettingsResult => ({ ok: true,
  snapshot: buildDesktopSettingsSurfaceSnapshot('environment_settings', {
    local_ui_bind: `localhost:${port}`, local_ui_protocol: 'http', local_ui_password: '',
    local_ui_password_mode: 'keep', auto_runtime_probe_enabled: true,
  }, { environment_id: id, environment_label: id, environment_kind: 'runtime_target', runtime_connection: { host_access: { kind: 'ssh_host', ssh: { ssh_destination: 'fixture', ssh_port: 22, auth_mode: 'key_agent', connect_timeout_seconds: 10 } }, placement: { kind: 'host_process', runtime_root: '' } } }),
});
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function harness(load = vi.fn(async () => result()), save = vi.fn(async () => result())) {
  const lateError = vi.fn();
  return { ...createEnvironmentSettingsController({ load, save, lateError }), load, save, lateError };
}

describe('unified environment settings session', () => {
  it.each([true, false])('opens the same session without remote I/O and keeps it after load success=%s', async success => {
    const h = harness(vi.fn(async () => success ? result() : { ok: false as const, error: 'Permission denied' }));
    h.open(environment(), { name: 'saved' });
    const token = h.session()!.token;
    expect(h.load).not.toHaveBeenCalled();
    expect(h.session()?.tab).toBe('connection');
    h.selectTab('access'); await settle();
    expect(h.session()?.token).toBe(token);
    expect(h.session()?.tab).toBe('access');
    expect(h.session()?.access_state).toBe(success ? 'ready' : 'error');
    expect(h.session()?.connection).toEqual({ name: 'saved' });
    if (!success) expect(h.session()?.access_error?.error).toBe('Permission denied');
  });
  it('ignores late reads after close and reopen, including the same target', async () => {
    const first = deferred<DesktopSettingsResult>();
    const h = harness(vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(result('ssh:fixture', '25000')));
    h.open(environment(), {}); h.selectTab('access');
    h.close(); h.open(environment(), {}); h.selectTab('access'); await settle();
    first.resolve(result()); await settle();
    expect(h.session()?.access?.draft.local_ui_bind).toBe('localhost:25000');
  });
  it('preserves drafts across tabs and failed saves; successful saves keep the session open', async () => {
    const save = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Connection refused' }).mockResolvedValue(result('ssh:fixture', '25000'));
    const h = harness(undefined, save); h.open(environment(), { name: 'saved' }); h.selectTab('access'); await settle();
    h.updateDraft(draft => ({ ...draft, local_ui_bind: 'localhost:25000' }));
    h.selectTab('connection'); h.update({ connection: { name: 'edited' } }); h.selectTab('access');
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(await h.saveAccess()).toBe(false);
    expect(h.session()?.access?.draft.local_ui_bind).toBe('localhost:25000');
    expect(await h.saveAccess()).toBe(true);
    expect(h.session()?.access?.dirty).toBe(false);
    expect(h.session()?.connection).toEqual({ name: 'edited' });
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ environment_id: 'ssh:fixture' }));
  });
  it('does not let a late save change a new editor and reports its failure', async () => {
    const pending = deferred<DesktopSettingsResult>();
    const h = harness(undefined, vi.fn(() => pending.promise));
    h.open(environment(), {}); h.selectTab('access'); await settle();
    const save = h.saveAccess();
    h.close(); h.open(environment('ssh:other'), {});
    pending.resolve({ ok: false, error: 'Save failed on original target', status_code: 401 }); await save;
    expect(h.session()?.environment.id).toBe('ssh:other');
    expect(h.session()?.access_state).toBe('idle');
    expect(h.lateError).toHaveBeenCalledWith({ ok: false, error: 'Save failed on original target', status_code: 401 });
  });
  it('invalidates old access only after a target identity change, not a rename', async () => {
    const h = harness(); h.open(environment(), {}); h.selectTab('access'); await settle();
    const access = h.session()?.access;
    h.savedConnection({ ...environment(), label: 'renamed' }, {});
    expect(h.session()?.access).toBe(access);
    h.savedConnection(environment('ssh:new'), {});
    expect(h.session()?.access).toBeNull();
    expect(h.session()?.access_state).toBe('idle');
  });
  it('never loads access settings for Cloud, URL, or Gateway registrations', async () => {
    const h = harness();
    for (const registration_ref of [undefined, { kind: 'saved_environment', id: 'url' }, { kind: 'gateway_environment', gateway_id: 'g', gateway_env_id: 'e' }]) {
      const entry = { id: 'remote', label: 'remote', registration_ref } as DesktopEnvironmentEntry;
      expect(environmentHasAccessSettings(entry)).toBe(false);
      h.open(entry, {}); await h.loadAccess();
    }
    expect(h.load).not.toHaveBeenCalled();
  });
  it('uses the same dirty comparison as access actions after a manual revert', async () => {
    const h = harness(); h.open(environment(), {}); h.selectTab('access'); await settle();
    h.updateDraft(draft => ({ ...draft, local_ui_bind: 'localhost:25000' }));
    expect(h.session()?.access?.dirty).toBe(true);
    h.updateDraft(draft => ({ ...draft, local_ui_bind: 'localhost:23998' }));
    expect(h.session()?.access?.dirty).toBe(false);
  });
  it('invalidates pre-save reads and forbids edits or refresh while a save is submitted', async () => {
    const old = deferred<DesktopSettingsResult>(), saved = deferred<DesktopSettingsResult>();
    const load = vi.fn().mockResolvedValueOnce(result()).mockReturnValueOnce(old.promise);
    const h = harness(load, vi.fn(() => saved.promise));
    h.open(environment(), {}); h.selectTab('access'); await settle();
    h.updateDraft(draft => ({ ...draft, local_ui_bind: 'localhost:25000' }));
    const refresh = h.loadAccess(); const save = h.saveAccess();
    h.updateDraft(draft => ({ ...draft, local_ui_bind: 'localhost:26000' }));
    await h.loadAccess(); expect(load).toHaveBeenCalledTimes(2);
    expect(h.session()?.access?.draft.local_ui_bind).toBe('localhost:25000');
    saved.resolve(result('ssh:fixture', '25000')); await save;
    old.resolve(result()); await refresh;
    expect(h.session()?.access?.baseline_surface.draft.local_ui_bind).toBe('localhost:25000');
    expect(h.session()?.access?.dirty).toBe(false);
  });

});

it('refreshes committed password metadata without replacing a pending access draft', async () => {
  const updated = result();
  if (!updated.ok) throw new Error('Fixture requires a snapshot');
  const h = harness(vi.fn().mockResolvedValueOnce(result()).mockResolvedValue({ ...updated, snapshot: { ...updated.snapshot, local_ui_password_configured: true } }));
  h.open(environment(), {}); h.selectTab('access'); await settle();
  h.updateDraft(draft => ({ ...draft, local_ui_bind: '0.0.0.0:25000' }));
  await h.loadAccess();
  expect(h.session()?.access?.draft.local_ui_bind).toBe('0.0.0.0:25000');
  expect(h.session()?.access?.baseline_surface.local_ui_password_configured).toBe(true);
});
