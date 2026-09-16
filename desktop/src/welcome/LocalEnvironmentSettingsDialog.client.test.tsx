import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { LocalEnvironmentSettingsDialog } from './App';
import { createDesktopI18n } from '../shared/i18n';
import { buildDesktopSettingsSurfaceSnapshot } from '../main/settingsPageContent';
import { applyDesktopAccessModeToDraft, applyDesktopAccessFixedPortToDraft } from '../shared/desktopAccessModel';
import type { DesktopCertificateReport, DesktopCertificateRequest } from '../shared/desktopCertificate';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';
import { IDLE_LAUNCHER_BUSY_STATE } from './launcherBusyState';

const disposers: Array<() => void> = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
  if (!result) throw new Error(`Button missing: ${label}`);
  return result;
}

async function mount(options: { url?: string; protocol?: 'http' | 'https' | 'legacy'; remote?: boolean; urls?: string[]; pending?: boolean; certificate?: (request: DesktopCertificateRequest) => Promise<DesktopCertificateReport> } = {}) {
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
    current_runtime_url: url, current_runtime_urls: options.urls ?? (url ? [url] : []), current_runtime_running: Boolean(url),
    local_ui_password_configured: true,
  }), runtime_configuration_pending: options.pending };
  const [draft, setDraft] = createSignal(baseline);
  const [liveSnapshot, setSnapshot] = createSignal(snapshot);
  const [isOpen, setOpen] = createSignal(true);
  const [runtimeStatus, setRuntimeStatus] = createSignal(url ? 'Running' : 'Not running');
  const copy = vi.fn(async () => {});
  const save = vi.fn(async () => {});
  const open = vi.fn(async () => {});
  const certificate = vi.fn(options.certificate ?? (async () => ({ status: 'failed', code: 'local_ui_device_ca_missing' })));
  disposers.push(render(() => (
    <LocalEnvironmentSettingsDialog open={isOpen()} snapshot={liveSnapshot()} baselineSnapshot={liveSnapshot()} draft={draft()}
      i18n={createDesktopI18n('en-US')} busyState={IDLE_LAUNCHER_BUSY_STATE} settingsError=""
      settingsErrorRef={() => {}} updateDraftField={(name, value) => setDraft((current) => ({ ...current, [name]: value }))}
      applyAccessMode={(mode) => setDraft((current) => applyDesktopAccessModeToDraft(current, mode))}
      applyAccessFixedPort={(port) => setDraft((current) => applyDesktopAccessFixedPortToDraft(current, port))}
      toggleAutoPort={() => {}} saveSettings={save} runtimeRestartAvailable={Boolean(url)} runtimeRunning={Boolean(url)}
      runtimeStatusLabel={runtimeStatus()} runtimeStatusTone="neutral" dark={false}
      desktopOpenLabel="Open Env App" openInDesktop={() => {}} openInBrowser={open} copyEnvironmentValue={copy}
      cancelSettings={() => {}} clearStoredLocalUIPassword={() => {}} certificate={certificate} />
  ), host));
  await settle();
  return { draft, setDraft, copy, save, open, certificate, setSnapshot, setOpen, setRuntimeStatus };
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Runtime connection settings', () => {
  it.each([false, true])('preserves dialog interaction state across Runtime snapshots (edited: %s)', async (edited) => {
    const test = await mount({ url: 'http://localhost:23998/', protocol: 'https', certificate: async () => ({
      status: 'ready', code: 'local_ui_device_ca_untrusted', identity: 'ready', trust: 'untrusted',
      certificate_path: '/isolated/device-ca.pem', can_install: true,
    }) });
    if (edited) {
      test.setDraft((previous) => ({ ...previous, local_ui_bind: 'localhost:25000' }));
      await settle();
    }
    const dialog = document.querySelector('[role="dialog"]')!;
    const content = dialog.querySelector('.overflow-auto')!;
    const details = [...dialog.querySelectorAll('details')];
    expect(details).toHaveLength(2);
    for (const detail of details) detail.open = true;
    const port = document.getElementById('local-ui-port') as HTMLInputElement;
    port.focus();
    port.setSelectionRange(1, 3);
    content.scrollTop = 240;

    for (let i = 0; i < 3; i += 1) {
      test.setSnapshot((previous) => ({ ...structuredClone(previous), current_runtime_url: 'http://localhost:24120/', current_runtime_urls: ['http://localhost:24120/'] }));
      test.setDraft((previous) => ({ ...previous }));
      test.setRuntimeStatus('Connected');
      await settle();
      expect(test.certificate).toHaveBeenCalledTimes(1);
      expect(document.querySelector('[role="dialog"]')).toBe(dialog);
      expect(dialog.querySelector('.overflow-auto')).toBe(content);
      for (const [index, detail] of details.entries()) expect(dialog.querySelectorAll('details')[index]).toBe(detail);
      expect(details.every((detail) => detail.open)).toBe(true);
      expect(content.scrollTop).toBe(240);
      expect(document.getElementById('local-ui-port')).toBe(port);
      expect(port.value).toBe(edited ? '25000' : '23998');
      expect(test.draft().local_ui_bind).toBe(edited ? 'localhost:25000' : 'localhost:23998');
      expect(document.activeElement).toBe(port);
      expect([port.selectionStart, port.selectionEnd]).toEqual([1, 3]);
      expect(dialog.textContent).toContain('Connected');
      expect(dialog.textContent).toContain('http://localhost:24120/');
    }
  });

  it('checks certificates again after closing and reopening the dialog', async () => {
    const test = await mount({ protocol: 'https', certificate: async () => ({
      status: 'ready', code: 'local_ui_device_ca_untrusted', identity: 'ready', trust: 'untrusted',
      certificate_path: '/isolated/device-ca.pem',
    }) });
    const details = document.querySelector('details')!;
    details.open = true;
    test.setOpen(false);
    await settle();
    test.setOpen(true);
    await settle();
    expect(test.certificate).toHaveBeenCalledTimes(2);
    expect(document.querySelector('details')).not.toBe(details);
    expect(document.querySelector('details')?.open).toBe(false);
  });

  it('keeps saved changes pending when the dialog reopens with an unchanged draft', async () => {
    const test = await mount({ url: 'http://localhost:24120/', pending: true });
    expect(document.body.textContent).toContain('Changes not yet applied');
    expect(document.body.textContent).toContain('http://localhost:24120/');
    expect((document.getElementById('local-ui-port') as HTMLInputElement).value).toBe('23998');
    expect(button('Save and restart').disabled).toBe(false);
    button('Save and restart').click();
    expect(test.save).toHaveBeenCalledWith({ restartRuntime: true });
  });
  it('rejects an oversized password before saving, including multibyte text', async () => {
    const test = await mount();
    test.setDraft((current) => ({ ...current, local_ui_password: '密'.repeat(25), local_ui_password_mode: 'replace' }));
    await settle();
    expect(document.body.textContent).toContain('at most 72 UTF-8 bytes');
    expect(button('Save for next restart').disabled).toBe(true);
  });
  it('identifies server loopback and does not open it in the client browser', async () => {
    await mount({ url: 'http://localhost:23998/', remote: true });
    expect(document.body.textContent).toContain('Only this server');
    expect(document.body.textContent).toContain('This loopback address belongs to the server.');
    expect([...document.querySelectorAll('button')].some((item) => item.textContent?.trim() === 'Open in browser')).toBe(false);
  });

  it('uses an actual network address when a remote server also reports loopback', async () => {
    const test = await mount({ url: 'http://localhost:23998/', remote: true, urls: ['http://localhost:23998/', 'http://192.0.2.20:23998/'] });
    button('Open in browser').click();
    expect(test.open).toHaveBeenCalledWith('http://192.0.2.20:23998/');
  });
  it('keeps the live URL stable while editing and offers both apply timings', async () => {
    const test = await mount({ url: 'http://127.0.0.1:24120/' });
    expect(test.certificate).not.toHaveBeenCalled();
    const port = document.getElementById('local-ui-port') as HTMLInputElement;
    port.value = '25000';
    port.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(document.body.textContent).toContain('http://127.0.0.1:24120/');
    expect(document.body.textContent).not.toContain('http://localhost:25000');
    expect(document.body.textContent).toContain('Changes not yet applied');
    button('Copy Environment URL').click();
    expect(test.copy).toHaveBeenCalledWith('http://127.0.0.1:24120/', expect.any(String));
    button('Save for next restart').click();
    expect(test.save).toHaveBeenLastCalledWith();
    button('Save and restart').click();
    expect(test.save).toHaveBeenLastCalledWith({ restartRuntime: true });
  });

  it('does not present a saved port as a running endpoint', async () => {
    await mount();
    expect(document.body.textContent).toContain('Start the Runtime to see its connection address.');
    expect(document.body.textContent).not.toContain('http://');
    expect(document.querySelector('img')).toBeNull();
    expect([...document.querySelectorAll('button')].some((item) => item.textContent?.includes('Share connection'))).toBe(false);
    expect((document.getElementById('local-ui-port') as HTMLInputElement).value).toBe('23998');
  });

  it('shares only the actual URL and explains the loopback boundary', async () => {
    const test = await mount({ url: 'https://localhost:23998/', protocol: 'https' });
    expect(test.certificate).toHaveBeenCalledWith({ environment_id: 'local', operation: 'status' });
    expect(test.certificate).not.toHaveBeenCalledWith(expect.objectContaining({ operation: 'install' }));
    button('Share connection').click();
    await settle();
    expect(document.querySelector('img')?.getAttribute('src')).toMatch(/^data:image/);
    expect(document.body.textContent).toContain('Other devices cannot use it.');
    expect(document.body.textContent).not.toContain('bridge');
    button('Open in browser').click();
    expect(test.open).toHaveBeenCalledWith('https://localhost:23998/');
  });

  it('keeps the current HTTP URL and blocks restart until HTTPS identity checks complete', async () => {
    let finish!: (report: DesktopCertificateReport) => void;
    const test = await mount({ url: 'http://localhost:23998/', protocol: 'https', pending: true,
      certificate: () => new Promise((resolve) => { finish = resolve; }) });
    test.setDraft((current) => ({ ...current, local_ui_bind: 'localhost:24000' }));
    await settle();
    expect(button('Save and restart').disabled).toBe(true);
    expect(button('Save for next restart').disabled).toBe(false);
    finish({ status: 'ready', code: 'local_ui_device_ca_untrusted', identity: 'ready', trust: 'untrusted', can_install: true });
    await settle();
    expect(button('Save and restart').disabled).toBe(false);
    expect(document.body.textContent).toContain('http://localhost:23998/');
    button('Save and restart').click();
    expect(test.save).toHaveBeenCalledWith({ restartRuntime: true });
  });

  it('uses HTTP without certificate setup for an existing configuration with no protocol', async () => {
    const test = await mount({ protocol: 'legacy' });
    expect(document.body.textContent).not.toContain('Choose HTTP or HTTPS');
    expect(test.certificate).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('HTTP does not protect');
    expect(button('HTTP').getAttribute('aria-checked')).toBe('true');
    test.setDraft((current) => ({ ...current, local_ui_bind: 'localhost:24000' }));
    await settle();
    expect(button('Save for next restart').disabled).toBe(false);
    button('Network-reachable devices').click();
    await settle();
    expect(test.draft().local_ui_password_mode).toBe('keep');
    button('This device only').click();
    await settle();
    expect(test.draft().local_ui_password_mode).toBe('keep');
    expect(button('Save for next restart').disabled).toBe(false);
  });
});
