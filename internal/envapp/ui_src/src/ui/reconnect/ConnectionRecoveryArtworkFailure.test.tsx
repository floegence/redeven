// @vitest-environment jsdom
import { render } from 'solid-js/web';
import { expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import { ConnectionRecoveryView } from './ConnectionRecoveryView';

vi.mock('./ConnectionRecoveryIllustration', () => { throw new Error('Asset unavailable'); });

it('keeps first-load recovery actions available when optional artwork cannot load', async () => {
  const host = document.createElement('div'); document.body.append(host);
  const retry = vi.fn(async () => undefined);
  const stop = vi.fn(async () => undefined);
  const dispose = render(() => <I18nProvider><ConnectionRecoveryView environmentName="Dev" onRetry={retry} onStop={stop}
    snapshot={{ generation: 1, revision: 1, state: 'recovering', phase: 'protocol_connect',
      protocol_attempt_count: 1, protocol_connected: false, secure_session: 'pending', availability_status: 'unknown',
      next_retry_at_unix_ms: Date.now() + 1000 }} /></I18nProvider>, host);
  try {
    await vi.waitFor(() => expect(host.querySelector('h1')?.textContent).toBe('Restoring connection'));
    await new Promise(resolve => setTimeout(resolve, 0));
    const buttons = Array.from(host.querySelectorAll('button'));
    buttons.find(button => button.textContent === 'Retry now')!.click();
    buttons.find(button => button.textContent === 'Stop retrying')!.click();
    expect(retry).toHaveBeenCalledOnce(); expect(stop).toHaveBeenCalledOnce();
    expect(host.querySelector('[data-connection-illustration]')).toBeNull();
    expect(host.querySelector('h1')).not.toBeNull();
  } finally { dispose(); host.remove(); }
});
