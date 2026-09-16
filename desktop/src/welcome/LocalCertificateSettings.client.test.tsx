import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { LocalCertificateSettings } from './LocalCertificateSettings';
import { createDesktopI18n } from '../shared/i18n';
import type { DesktopCertificateReport, DesktopCertificateRequest } from '../shared/desktopCertificate';

const disposers: Array<() => void> = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ready: DesktopCertificateReport = { status: 'ready', code: 'local_ui_device_ca_untrusted', identity: 'ready', trust: 'untrusted', can_manage: true, can_install: true, certificate_path: '/runtime/device-ca.pem' };
const missing: DesktopCertificateReport = { status: 'failed', code: 'local_ui_device_ca_missing', identity: 'missing', can_manage: true, can_install: true };
function button(label: string) {
  const found = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === label || el.getAttribute('aria-label') === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function mount(manage: (request: DesktopCertificateRequest) => Promise<DesktopCertificateReport>, remote = false) {
  const host = document.createElement('div'); document.body.append(host);
  const [snapshot, setSnapshot] = createSignal({ environment_id: 'local' });
  const setEnvironmentID = (id: string) => setSnapshot({ environment_id: id });
  const refreshSnapshot = () => setSnapshot((previous) => ({ ...previous }));
  const onReadiness = vi.fn();
  const copyText = vi.fn<(value: string, label: string) => Promise<void>>().mockResolvedValue(undefined);
  const dispose = render(() => <LocalCertificateSettings environmentID={snapshot().environment_id} i18n={createDesktopI18n('en-US')}
    manage={manage} remote={remote} onReadiness={onReadiness} copyText={copyText} />, host);
  disposers.push(dispose);
  return { setEnvironmentID, refreshSnapshot, onReadiness, copyText, dispose };
}
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); });

describe('HTTPS certificate configuration', () => {
  it('treats the existing epoch 18 untrusted failure as a valid certificate with an available trust action', async () => {
    const test = mount(vi.fn(async () => ({ ...ready, status: 'failed' })));
    await settle();
    expect(document.body.textContent).toContain('Ready');
    expect(document.body.textContent).not.toContain('Invalid certificate');
    expect(button('Trust on this device').disabled).toBe(false);
    expect(test.onReadiness).toHaveBeenLastCalledWith(true);
    expect(document.querySelector('details')?.open).toBe(false);
  });
  it('shows neutral untrusted status after creation and allows the next action', async () => {
    const manage = vi.fn(async ({ operation }: DesktopCertificateRequest) => operation === 'status' ? missing : ready);
    mount(manage); await settle();
    button('Create and trust on this device').click(); await settle();
    expect(manage).toHaveBeenCalledWith({ environment_id: 'local', operation: 'setup' });
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(button('Trust on this device').disabled).toBe(false);
  });
  it('retains the certificate and a usable retry when system authorization is canceled', async () => {
    const manage = vi.fn(async ({ operation }: DesktopCertificateRequest) => operation === 'status' ? missing
      : { ...ready, status: 'failed', code: 'local_ui_device_ca_install_canceled', failure_stage: 'install' as const });
    const test = mount(manage); await settle(); button('Create and trust on this device').click(); await settle();
    expect(document.body.textContent).toContain('authorization was canceled');
    expect(document.body.textContent).not.toContain('Invalid certificate');
    expect(button('Trust on this device').disabled).toBe(false);
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')?.textContent).toContain('authorization was canceled');
    expect(test.onReadiness).toHaveBeenLastCalledWith(true);
  });
  it('prevents duplicate actions and cannot enable restart before the action completes', async () => {
    let finish!: (report: DesktopCertificateReport) => void;
    const manage = vi.fn(({ operation }: DesktopCertificateRequest) => operation === 'status' ? Promise.resolve(missing)
      : new Promise<DesktopCertificateReport>((resolve) => { finish = resolve; }));
    const test = mount(manage); await settle();
    const setup = button('Create and trust on this device'); setup.click(); setup.click();
    expect(setup.disabled).toBe(true);
    expect(test.onReadiness).toHaveBeenLastCalledWith(false);
    expect(manage).toHaveBeenCalledTimes(2);
    finish({ ...ready, trust: 'trusted' }); await settle();
    expect(document.body.textContent).toContain('Trusted');
    expect(test.onReadiness).toHaveBeenLastCalledWith(true);
  });
  it('keeps a pending trust operation attached to its target during background snapshots', async () => {
    let finish!: (report: DesktopCertificateReport) => void;
    const manage = vi.fn(({ operation }: DesktopCertificateRequest) => operation === 'status' ? Promise.resolve(ready)
      : new Promise<DesktopCertificateReport>((resolve) => { finish = resolve; }));
    const test = mount(manage); await settle();
    const details = document.querySelector('details')!;
    details.open = true;
    button('Trust on this device').click();
    for (let i = 0; i < 3; i += 1) {
      test.refreshSnapshot();
      await settle();
      expect(manage).toHaveBeenCalledTimes(2);
      expect(button('Trust on this device').disabled).toBe(true);
      expect(test.onReadiness).toHaveBeenLastCalledWith(false);
      expect(document.querySelector('details')).toBe(details);
      expect(details.open).toBe(true);
    }
    finish({ ...ready, trust: 'trusted' }); await settle();
    expect(document.body.textContent).toContain('Trusted');
    expect(test.onReadiness).toHaveBeenLastCalledWith(true);
    expect(document.querySelector('details')).toBe(details);
    expect(details.open).toBe(true);
  });
  it('refreshes certificate status explicitly without replacing its expanded details', async () => {
    const manage = vi.fn().mockResolvedValueOnce(ready).mockResolvedValueOnce({ ...ready, trust: 'trusted' });
    mount(manage); await settle();
    const details = document.querySelector('details')!;
    details.open = true;
    button('Refresh certificate status').click(); await settle();
    expect(manage).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain('Trusted');
    expect(document.querySelector('details')).toBe(details);
    expect(details.open).toBe(true);
  });
  it('keeps diagnostic output in collapsed details and copies only public certificate metadata', async () => {
    const test = mount(async ({ operation }) => operation === 'status' ? ready : ({ ...ready, status: 'failed', code: 'local_ui_device_ca_install_failed',
      message: 'System trust installation failed: permission denied', not_after: '2031-09-16T12:00:00Z', failure_stage: 'install' }));
    await settle();
    button('Trust on this device').click(); await settle();
    expect(document.body.textContent).toContain('Ready');
    expect(test.onReadiness).toHaveBeenLastCalledWith(true);
    expect(button('Trust on this device').disabled).toBe(false);
    const details = document.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not add system trust');
    expect(document.querySelector('[role="alert"]')?.textContent).not.toContain('permission denied');
    expect(details.textContent).toContain('permission denied');
    button('Copy certificate details').click(); await settle();
    expect(test.copyText).toHaveBeenCalledWith(expect.stringContaining('/runtime/device-ca.pem'), 'Certificate details');
    expect(test.copyText.mock.calls[0]?.[0]).toContain('permission denied');
  });
  it('offers selectable diagnostics when copying fails without affecting certificate readiness', async () => {
    const test = mount(async () => ready); await settle();
    test.copyText.mockRejectedValueOnce(new Error('Clipboard unavailable'));
    button('Copy certificate details').click(); await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Select the text');
    expect(button('Copy certificate details').disabled).toBe(false);
    expect(test.onReadiness).toHaveBeenLastCalledWith(true);
    button('Copy certificate details').click(); await settle();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });
  it('ignores old environment results and results after closing', async () => {
    let finish!: (report: DesktopCertificateReport) => void;
    const manage = vi.fn(({ environment_id }: DesktopCertificateRequest) => environment_id === 'local'
      ? new Promise<DesktopCertificateReport>((resolve) => { finish = resolve; }) : Promise.resolve(missing));
    const test = mount(manage); test.setEnvironmentID('remote'); await settle();
    finish(ready); await settle();
    expect(document.body.textContent).not.toContain('Ready');
    expect(test.onReadiness).toHaveBeenLastCalledWith(false);
    test.setEnvironmentID('local'); await settle(); test.dispose();
    const calls = test.onReadiness.mock.calls.length;
    finish(ready); await settle();
    expect(test.onReadiness).toHaveBeenCalledTimes(calls);
  });
  it('shows query failure without inventing certificate damage and recovers on refresh', async () => {
    const manage = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(ready);
    const test = mount(manage); await settle();
    expect(document.body.textContent).toContain('Unable to check');
    expect(document.body.textContent).not.toContain('Invalid certificate');
    expect(test.onReadiness).toHaveBeenLastCalledWith(false);
    button('Refresh certificate status').click(); await settle();
    expect(test.onReadiness).toHaveBeenLastCalledWith(true);
  });
  it.each(['expired', 'invalid', 'not_yet_valid'])('blocks readiness for %s without offering automatic replacement', async (identity) => {
    const test = mount(async () => ({ status: 'failed', code: `local_ui_device_ca_${identity}`, identity, can_install: true }));
    await settle();
    expect(test.onReadiness).toHaveBeenLastCalledWith(false);
    expect([...document.querySelectorAll('button')].map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim())).toEqual(['Refresh certificate status']);
  });
  it('never presents server trust as local client trust or installs it on unsupported platforms', async () => {
    mount(async () => ({ ...ready, trust: 'trusted', can_install: false }), true); await settle();
    expect(document.body.textContent).not.toContain('System trust on this device');
    expect(document.body.textContent).not.toContain('Trusted');
    expect([...document.querySelectorAll('button')].map((el) => el.getAttribute('aria-label') ?? el.textContent?.trim())).toEqual(['Refresh certificate status', 'Manage certificate', 'Copy certificate details']);
  });
});


describe('explicit certificate management', () => {
  it.each(['regenerate', 'remove'] as const)('requires confirmation for %s and preserves the environment target', async (operation) => {
    const manage = vi.fn(async (request: DesktopCertificateRequest) => request.operation === 'status' ? ready : ({ ...(operation === 'remove' ? missing : ready), status: 'updated', code: `local_ui_certificate_${operation}_complete` }));
    const test = mount(manage); await settle();
    button('Manage certificate').click();
    button(operation === 'remove' ? 'Remove certificate' : 'Regenerate certificate').click();
    expect(manage).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain(operation === 'remove' ? 'Existing system trust entries remain' : 'Clients will need to trust');
    button('Cancel').click(); expect(manage).toHaveBeenCalledTimes(1);
    button(operation === 'remove' ? 'Remove certificate' : 'Regenerate certificate').click();
    button(operation === 'remove' ? 'Remove certificate' : 'Regenerate certificate').click(); await settle();
    expect(manage).toHaveBeenLastCalledWith({ environment_id: 'local', operation, confirmed: true });
    expect(test.onReadiness).toHaveBeenLastCalledWith(operation !== 'remove');
    expect(document.querySelector('[role="status"]')?.textContent).toContain(operation === 'remove' ? 'Certificate removed' : 'Certificate saved');
  });
  it('imports through the privileged picker and keeps the current certificate after cancellation', async () => {
    const manage = vi.fn(async ({ operation }: DesktopCertificateRequest) => operation === 'status' ? ready : { ...ready, status: 'canceled', code: 'local_ui_certificate_selection_canceled' });
    const test = mount(manage); await settle(); button('Manage certificate').click(); button('Import certificate…').click();
    expect(document.body.textContent).toContain('matching unencrypted private key');
    button('Choose PEM files…').click(); await settle();
    expect(manage).toHaveBeenLastCalledWith({ environment_id: 'local', operation: 'import', confirmed: true });
    expect(document.querySelector('[role="alert"]')).toBeNull(); expect(test.onReadiness).toHaveBeenLastCalledWith(true);
  });
  it('does not label imported server certificates as installable roots', async () => {
    mount(async () => ({ ...ready, certificate_kind: 'server' })); await settle();
    expect(document.body.textContent).toContain('issuing CA');
    expect([...document.querySelectorAll('button')].some((el) => el.textContent?.includes('Trust on this device'))).toBe(false);
  });
  it('clears a pending replacement confirmation when switching environments', async () => {
    const manage=vi.fn(async () => ready); const test=mount(manage); await settle();
    button('Manage certificate').click(); button('Remove certificate').click();
    test.setEnvironmentID('server'); await settle();
    expect(document.body.textContent).not.toContain('Existing system trust entries remain');
    expect(manage.mock.calls).toHaveLength(2);
  });
  it('offers explicit recovery for a damaged identity and displays failed imports even when missing', async () => {
    const manage=vi.fn(async ({ operation }: DesktopCertificateRequest) => operation==='status' ? { ...missing, identity:'invalid', code:'local_ui_device_ca_invalid' } : { ...missing, status:'failed', code:'local_ui_certificate_import_failed', failure_stage:'import' as const });
    mount(manage); await settle(); button('Manage certificate').click();button('Import certificate…').click();button('Choose PEM files…').click();await settle();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('could not complete');
  });
});
