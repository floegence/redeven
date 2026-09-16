import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { LocalEnvironmentSettingsDialog } from './App';
import { createDesktopI18n } from '../shared/i18n';
import { buildDesktopSettingsSurfaceSnapshot } from '../main/settingsPageContent';
import { applyDesktopAccessModeToDraft, applyDesktopAccessFixedPortToDraft } from '../shared/desktopAccessModel';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';
import { IDLE_LAUNCHER_BUSY_STATE } from './launcherBusyState';

const disposers: Array<() => void> = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
function button(label: string): HTMLButtonElement {
  const result = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === label || item.getAttribute('aria-label') === label);
  if (!result) throw new Error(`Button missing: ${label}`);
  return result;
}

async function mount(options: { url?: string; protocol?: 'http' | 'https' | 'legacy'; remote?: boolean; urls?: string[]; pending?: boolean } = {}) {
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
  const copy = vi.fn(async () => {});
  const save = vi.fn(async () => {});
  const open = vi.fn(async () => {});
  const certificate = vi.fn(async () => ({ status: 'failed', code: 'local_ui_device_ca_missing' }));
  disposers.push(render(() => (
    <LocalEnvironmentSettingsDialog open snapshot={snapshot} baselineSnapshot={snapshot} draft={draft()}
      i18n={createDesktopI18n('en-US')} busyState={IDLE_LAUNCHER_BUSY_STATE} settingsError=""
      settingsErrorRef={() => {}} updateDraftField={(name, value) => setDraft((current) => ({ ...current, [name]: value }))}
      applyAccessMode={(mode) => setDraft((current) => applyDesktopAccessModeToDraft(current, mode))}
      applyAccessFixedPort={(port) => setDraft((current) => applyDesktopAccessFixedPortToDraft(current, port))}
      toggleAutoPort={() => {}} saveSettings={save} runtimeRestartAvailable={Boolean(url)} runtimeRunning={Boolean(url)}
      runtimeStatusLabel={url ? 'Running' : 'Not running'} runtimeStatusTone="neutral" dark={false}
      desktopOpenLabel="Open Env App" openInDesktop={() => {}} openInBrowser={open} copyEnvironmentValue={copy}
      cancelSettings={() => {}} clearStoredLocalUIPassword={() => {}} certificate={certificate} />
  ), host));
  await settle();
  return { draft, setDraft, copy, save, open, certificate };
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Runtime connection settings', () => {
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
    expect(test.certificate).toHaveBeenCalledWith('status');
    expect(test.certificate).not.toHaveBeenCalledWith('install');
    button('Share connection').click();
    await settle();
    expect(document.querySelector('img')?.getAttribute('src')).toMatch(/^data:image/);
    expect(document.body.textContent).toContain('Other devices cannot use it.');
    expect(document.body.textContent).not.toContain('bridge');
    button('Open in browser').click();
    expect(test.open).toHaveBeenCalledWith('https://localhost:23998/');
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
