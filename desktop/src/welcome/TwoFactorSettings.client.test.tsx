import { controlText } from '../testSupport/controlText';
import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { TwoFactorSettings } from './TwoFactorSettings';
import { createDesktopI18n } from '../shared/i18n';
import type {
  SecurityRequest,
  SecurityResult,
} from '../shared/runtimeSecurity';

HTMLElement.prototype.scrollIntoView = vi.fn();
let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = '';
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (item) => controlText(item) === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  button.click();
}
it('offers HTTPS configuration before collecting a password or starting enrollment', async () => {
  const configureHTTPS = vi.fn();
  const manage = vi.fn(async () => ({ enabled: false, password_configured: false, recovery_pending: false, recovery_codes_remaining: 0, revision: 1, https_ready: false }));
  dispose = render(() => <TwoFactorSettings environmentID="remote" i18n={createDesktopI18n('en-US')} manage={manage} configureHTTPS={configureHTTPS} />, document.body);
  await settle();
  expect(document.body.textContent).toContain('Set up HTTPS first');
  expect(document.querySelector('input[type="password"]')).toBeNull();
  click('Configure HTTPS');
  expect(configureHTTPS).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(manage).toHaveBeenCalledTimes(1);
});
it('confirms enrollment before showing codes and commits only after they are saved', async () => {
  const base: SecurityResult = { https_ready: true,
    enabled: false,
    password_configured: true,
    recovery_pending: false,
    recovery_codes_remaining: 0,
    revision: 1,
  };
  const manage = vi.fn(
    async (request: SecurityRequest): Promise<SecurityResult> => {
      if (request.action === 'setup')
        return {
          ...base,
          operation_id: 'operation',
          secret: 'TESTKEY',
          qr_image: 'data:image/png;base64,',
        };
      if (request.action === 'verify')
        return {
          ...base,
          operation_id: 'operation',
          recovery_codes: ['saved-code'],
        };
      if (request.action === 'commit')
        return {
          ...base,
          enabled: true,
          recovery_codes_remaining: 8,
          revision: 2,
        };
      return base;
    },
  );
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(
    () => (
      <TwoFactorSettings configureHTTPS={() => {}}
        environmentID="environment"
        i18n={createDesktopI18n('en-US')}
        manage={manage}
      />
    ),
    host,
  );
  await settle();
  click('Set up');
  await settle();
  expect(document.querySelectorAll('input')).toHaveLength(1);
  const input = document.querySelector('input')!;
  expect(input.autocomplete).toBe('one-time-code');
  expect(input.inputMode).toBe('numeric');
  input.value = '012 345';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input
    .closest('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(manage).toHaveBeenCalledWith({
    action: 'verify',
    operation_id: 'operation',
    code: '012345',
  });
  const enable = [...document.querySelectorAll('button')].find(
    (item) => item.textContent === 'Enable two-factor',
  )!;
  expect(enable.disabled).toBe(true);
  expect(document.body.textContent).toContain('saved-code');
  (
    document.querySelector('input[type="checkbox"]') as HTMLInputElement
  ).click();
  await settle();
  click('Enable two-factor');
  await settle();
  expect(manage).toHaveBeenCalledWith({
    action: 'commit',
    operation_id: 'operation',
    saved: true,
  });
  expect(document.body.textContent).not.toContain('TESTKEY');
  expect(document.body.textContent).not.toContain('saved-code');
  expect(document.body.textContent).toContain('On');
});
it('keeps unavailable status distinct from Off', async () => {
  dispose = render(
    () => (
      <TwoFactorSettings configureHTTPS={() => {}}
        environmentID="offline"
        i18n={createDesktopI18n('en-US')}
        manage={async () => {
          throw new Error('Offline');
        }}
      />
    ),
    document.body,
  );
  await settle();
  expect(document.body.textContent).toContain('Unavailable');
  expect(document.querySelector('button')?.disabled).toBe(true);
});

it('reconciles a lost commit response without repeating the security write', async () => {
  const base: SecurityResult = { https_ready: true, enabled: false, password_configured: true, recovery_pending: false, recovery_codes_remaining: 0, revision: 1 };
  let committed = false;
  const manage = vi.fn(async (request: SecurityRequest): Promise<SecurityResult> => {
    if (request.action === 'setup') return { ...base, operation_id: 'operation', secret: 'KEY', qr_image: 'data:image/png;base64,' };
    if (request.action === 'verify') return { ...base, operation_id: 'operation', recovery_codes: ['saved-code'] };
    if (request.action === 'commit') {
      committed = true;
      throw new Error('RUNTIME_CONTROL_UNREACHABLE');
    }
    return { ...base, enabled: committed, revision: committed ? 2 : 1 };
  });
  dispose = render(() => <TwoFactorSettings configureHTTPS={() => {}} environmentID="environment" i18n={createDesktopI18n('en-US')} manage={manage} />, document.body);
  await settle(); click('Set up'); await settle();
  const input = document.querySelector('input')!;
  input.value = '012345'; input.dispatchEvent(new Event('input', { bubbles: true }));
  input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle(); (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
  await settle(); click('Enable two-factor'); await settle();
  expect(manage.mock.calls.filter(([request]) => request.action === 'commit')).toHaveLength(1);
  expect(manage.mock.calls.filter(([request]) => request.action === 'status')).toHaveLength(2);
  expect(document.body.textContent).toContain('The response was lost');
  expect(document.body.textContent).not.toContain('saved-code');
  expect(document.body.textContent).toContain('On');
});

it('preserves enrollment while the same environment status refreshes', async () => {
  const [snapshot, setSnapshot] = createSignal({ environmentID: 'environment', revision: 1 });
  const base: SecurityResult = { https_ready: true, enabled: false, password_configured: true, recovery_pending: false, recovery_codes_remaining: 0, revision: 1 };
  const manage = vi.fn(async (request: SecurityRequest): Promise<SecurityResult> => request.action === 'setup'
    ? { ...base, operation_id: 'pending-operation', secret: 'TESTKEY', qr_image: 'data:image/png;base64,' }
    : base);
  dispose = render(() => <TwoFactorSettings configureHTTPS={() => {}} environmentID={snapshot().environmentID} i18n={createDesktopI18n('en-US')} manage={manage} />, document.body);
  await settle();
  click('Set up');
  await settle();
  expect(document.querySelector('.two-factor-qr img')).not.toBeNull();

  setSnapshot({ environmentID: 'environment', revision: 2 });
  await settle();
  expect(document.querySelector('.two-factor-qr img')).not.toBeNull();
  expect(manage.mock.calls.filter(([request]) => request.action === 'status')).toHaveLength(1);
  expect(manage).not.toHaveBeenCalledWith({ action: 'cancel', operation_id: 'pending-operation' });

  setSnapshot({ environmentID: 'other-environment', revision: 1 });
  await settle();
  expect(document.querySelector('.two-factor-qr img')).toBeNull();
  expect(manage).toHaveBeenCalledWith({ action: 'cancel', operation_id: 'pending-operation' });
});

it('invalidates enrollment once after a Runtime restart and offers inline retry', async () => {
  const [started, setStarted] = createSignal<number | undefined>(1);
  const base: SecurityResult = { https_ready: true, enabled: false, password_configured: true, recovery_pending: false, recovery_codes_remaining: 0, revision: 1 };
  const manage = vi.fn(async (request: SecurityRequest): Promise<SecurityResult> => request.action === 'setup'
    ? { ...base, operation_id: 'before-restart', secret: 'KEY', qr_image: 'data:image/png;base64,' } : base);
  dispose = render(() => <TwoFactorSettings configureHTTPS={() => {}} environmentID="environment" runtimeStartedAt={started()} i18n={createDesktopI18n('en-US')} manage={manage} />, document.body);
  await settle(); click('Set up'); await settle();
  setStarted(undefined); await settle();
  expect(document.querySelector('.two-factor-qr')).not.toBeNull();
  expect(manage.mock.calls.filter(([request]) => request.action === 'status')).toHaveLength(1);
  setStarted(2); await settle();
  expect(document.querySelector('.two-factor-qr')).toBeNull();
  expect(document.body.textContent).toContain('Runtime restarted');
  expect(manage.mock.calls.filter(([request]) => request.action === 'status')).toHaveLength(2);
  setStarted(2); await settle();
  expect(manage.mock.calls.filter(([request]) => request.action === 'status')).toHaveLength(2);
  click('Retry'); await settle();
  expect(document.body.textContent).not.toContain('Runtime restarted');
});

it('does not repeat failed status queries until the user retries', async () => {
  const base: SecurityResult = { https_ready: true, enabled: true, password_configured: true, recovery_pending: false, recovery_codes_remaining: 8, revision: 2 };
  const manage = vi.fn().mockRejectedValueOnce(new Error('RUNTIME_CONTROL_UNREACHABLE')).mockResolvedValue(base);
  dispose = render(() => <TwoFactorSettings configureHTTPS={() => {}} environmentID="environment" i18n={createDesktopI18n('en-US')} manage={manage} />, document.body);
  await settle(); await settle();
  expect(manage).toHaveBeenCalledTimes(1);
  click('Retry'); await settle();
  expect(manage).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain('On');
});


it('replaces a stale enrollment form with actionable prerequisites if the server requires HTTPS', async () => {
  const base: SecurityResult = { https_ready: true, enabled: false, password_configured: false, recovery_pending: false, recovery_codes_remaining: 0, revision: 1 };
  const manage = vi.fn(async (request: SecurityRequest) => {
    if (request.action === 'setup') throw new Error('SECURITY_HTTPS_REQUIRED');
    return base;
  });
  dispose = render(() => <TwoFactorSettings environmentID="remote" i18n={createDesktopI18n('en-US')} manage={manage} configureHTTPS={() => {}} />, document.body);
  await settle(); click('Set up'); await settle();
  for (const input of document.querySelectorAll<HTMLInputElement>('input[type="password"]')) {
    input.value = 'test-password'; input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  click('Continue'); await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  expect(document.querySelector('input[type="password"]')).toBeNull();
  expect(document.body.textContent).toContain('Configure HTTPS');
  expect(manage.mock.calls.filter(([request]) => request.action === 'setup')).toHaveLength(1);
});


it('keeps the authenticator step and gives code-specific feedback after an invalid code', async () => {
  const base: SecurityResult = { https_ready: true, enabled: false, password_configured: true, recovery_pending: false, recovery_codes_remaining: 0, revision: 1 };
  const manage = vi.fn(async (request: SecurityRequest) => {
    if (request.action === 'setup') return { ...base, operation_id: 'pending', secret: 'KEY', qr_image: 'data:image/png;base64,' };
    if (request.action === 'verify') throw new Error('ACCESS_FACTOR_INVALID');
    return base;
  });
  dispose = render(() => <TwoFactorSettings environmentID="environment" i18n={createDesktopI18n('en-US')} manage={manage} configureHTTPS={() => {}} />, document.body);
  await settle(); click('Set up'); await settle();
  const input = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
  input.value = '000000'; input.dispatchEvent(new Event('input', { bubbles: true }));
  click('Continue'); await settle();
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('This code is invalid or has already been used. Try a new code.');
  expect(document.querySelector('.two-factor-qr')).not.toBeNull();
  expect(input.value).toBe('000000');
  expect(document.querySelector('[role="alert"] svg')).not.toBeNull();
});

it('requires six authenticator digits for owner verification and keeps recovery codes separate', async () => {
  const base: SecurityResult = { https_ready: true, enabled: true, password_configured: true, recovery_pending: false, recovery_codes_remaining: 8, revision: 1 };
  const manage = vi.fn(async () => base);
  dispose = render(() => <TwoFactorSettings environmentID="environment" i18n={createDesktopI18n('en-US')} manage={manage} configureHTTPS={() => {}} />, document.body);
  await settle(); click('Manage'); click('Turn off two-factor');
  const password = document.querySelector<HTMLInputElement>('input[type="password"]')!;
  password.value = 'test-password'; password.dispatchEvent(new Event('input', { bubbles: true }));
  const code = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!;
  const submit = () => code.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const input = (value: string) => { code.value = value; code.dispatchEvent(new Event('input', { bubbles: true })); };
  input('12345'); submit(); await settle();
  expect(manage).toHaveBeenCalledTimes(1);
  expect([...document.querySelectorAll('button')].find(button => button.textContent === 'Continue')!.disabled).toBe(true);
  input('12a345');
  expect(code.value).toBe('12345');
  input('012 345');
  expect(code.value).toBe('012345');
  input('01234567');
  expect(code.value).toBe('012345');
  expect(code.type).toBe('text');
  expect(code.inputMode).toBe('numeric');
  expect(document.getElementById(code.getAttribute('aria-describedby')!)?.textContent).toContain('6 digits');
  click('Use a recovery code');
  const recovery = document.querySelector<HTMLInputElement>('input[type="text"]')!;
  expect(recovery.value).toBe('');
  expect(recovery.inputMode).toBe('text');
  recovery.value = 'recovery-abcd-1234'; recovery.dispatchEvent(new Event('input', { bubbles: true }));
  click('Use an authenticator code');
  expect(document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')!.value).toBe('');
  click('Use a recovery code');
  const currentRecovery = document.querySelector<HTMLInputElement>('input[type="text"]')!;
  currentRecovery.value = 'recovery-abcd-1234'; currentRecovery.dispatchEvent(new Event('input', { bubbles: true }));
  click('Continue'); await settle();
  expect(manage).toHaveBeenLastCalledWith({ action: 'disable', password: 'test-password', recovery_code: 'recovery-abcd-1234' });
});
