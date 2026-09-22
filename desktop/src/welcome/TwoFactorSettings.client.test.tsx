import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { TwoFactorSettings } from './TwoFactorSettings';
import { createDesktopI18n } from '../shared/i18n';
import type {
  SecurityRequest,
  SecurityResult,
} from '../shared/runtimeSecurity';

let dispose = () => {};
afterEach(() => {
  dispose();
  document.body.innerHTML = '';
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
function click(label: string) {
  const button = [...document.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing button: ${label}`);
  button.click();
}
it('confirms enrollment before showing codes and commits only after they are saved', async () => {
  const base: SecurityResult = {
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
      <TwoFactorSettings
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
    code: '012 345',
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
      <TwoFactorSettings
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
  const base: SecurityResult = { enabled: false, password_configured: true, recovery_pending: false, recovery_codes_remaining: 0, revision: 1 };
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
  dispose = render(() => <TwoFactorSettings environmentID="environment" i18n={createDesktopI18n('en-US')} manage={manage} />, document.body);
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
  const base: SecurityResult = { enabled: false, password_configured: true, recovery_pending: false, recovery_codes_remaining: 0, revision: 1 };
  const manage = vi.fn(async (request: SecurityRequest): Promise<SecurityResult> => request.action === 'setup'
    ? { ...base, operation_id: 'pending-operation', secret: 'TESTKEY', qr_image: 'data:image/png;base64,' }
    : base);
  dispose = render(() => <TwoFactorSettings environmentID={snapshot().environmentID} i18n={createDesktopI18n('en-US')} manage={manage} />, document.body);
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
  const base: SecurityResult = { enabled: false, password_configured: true, recovery_pending: false, recovery_codes_remaining: 0, revision: 1 };
  const manage = vi.fn(async (request: SecurityRequest): Promise<SecurityResult> => request.action === 'setup'
    ? { ...base, operation_id: 'before-restart', secret: 'KEY', qr_image: 'data:image/png;base64,' } : base);
  dispose = render(() => <TwoFactorSettings environmentID="environment" runtimeStartedAt={started()} i18n={createDesktopI18n('en-US')} manage={manage} />, document.body);
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
  const base: SecurityResult = { enabled: true, password_configured: true, recovery_pending: false, recovery_codes_remaining: 8, revision: 2 };
  const manage = vi.fn().mockRejectedValueOnce(new Error('RUNTIME_CONTROL_UNREACHABLE')).mockResolvedValue(base);
  dispose = render(() => <TwoFactorSettings environmentID="environment" i18n={createDesktopI18n('en-US')} manage={manage} />, document.body);
  await settle(); await settle();
  expect(manage).toHaveBeenCalledTimes(1);
  click('Retry'); await settle();
  expect(manage).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).toContain('On');
});
