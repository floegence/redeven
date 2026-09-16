import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { LocalCertificateSettings } from './LocalCertificateSettings';
import { createDesktopI18n } from '../shared/i18n';
import type { DesktopCertificateReport, DesktopCertificateRequest } from '../shared/desktopCertificate';

const disposers: Array<() => void> = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const ready: DesktopCertificateReport = { status: 'ready', code: 'local_ui_device_ca_untrusted', identity: 'ready', trust: 'untrusted', can_install: true, certificate_path: '/runtime/device-ca.pem' };
const missing: DesktopCertificateReport = { status: 'failed', code: 'local_ui_device_ca_missing', identity: 'missing', can_install: true };
function button(label: string) {
  const found = [...document.querySelectorAll('button')].find((el) => el.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function mount(manage: (request: DesktopCertificateRequest) => Promise<DesktopCertificateReport>, remote = false) {
  const host = document.createElement('div'); document.body.append(host);
  const [environmentID, setEnvironmentID] = createSignal('local');
  const onReadiness = vi.fn();
  const dispose = render(() => <LocalCertificateSettings environmentID={environmentID()} i18n={createDesktopI18n('en-US')}
    manage={manage} remote={remote} onReadiness={onReadiness} />, host);
  disposers.push(dispose);
  return { setEnvironmentID, onReadiness, dispose };
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
    expect(document.body.textContent).toContain('Certificate trusted');
    expect(test.onReadiness).toHaveBeenLastCalledWith(true);
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
    button('Refresh').click(); await settle();
    expect(test.onReadiness).toHaveBeenLastCalledWith(true);
  });
  it.each(['expired', 'invalid', 'not_yet_valid'])('blocks readiness for %s without offering automatic replacement', async (identity) => {
    const test = mount(async () => ({ status: 'failed', code: `local_ui_device_ca_${identity}`, identity, can_install: true }));
    await settle();
    expect(test.onReadiness).toHaveBeenLastCalledWith(false);
    expect([...document.querySelectorAll('button')].map((el) => el.textContent?.trim())).toEqual(['Refresh']);
  });
  it('never presents server trust as local client trust or installs it on unsupported platforms', async () => {
    mount(async () => ({ ...ready, trust: 'trusted', can_install: false }), true); await settle();
    expect(document.body.textContent).not.toContain('System trust on this device');
    expect(document.body.textContent).not.toContain('Certificate trusted');
    expect([...document.querySelectorAll('button')].map((el) => el.textContent?.trim())).toEqual(['Refresh']);
  });
});
