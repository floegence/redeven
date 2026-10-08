import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { GatewayClientsPanel } from './GatewayClientsPanel';
import { createDesktopI18n } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';

const i18n = createDesktopI18n('en-US');
let dispose: (() => void) | undefined;
const settle = () => new Promise(resolve => setTimeout(resolve, 25));
function button(key: Parameters<typeof i18n.t>[0]) {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => controlText(element) === i18n.t(key));
  if (!found) throw new Error('Missing button ' + key);
  return found;
}
function mount(perform: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const root = document.createElement('div'); document.body.append(root);
  const [id, setID] = createSignal('gateway-one');
  dispose = render(() => <GatewayClientsPanel gatewayID={id()} i18n={i18n} />, root);
  return setID;
}
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Gateway client enrollment', () => {
  it('loads clients and requires a second action before revocation', async () => {
    const client = { client_key_id: 'client-one', client_name: 'Studio', paired_at_unix_ms: 1, last_verified_at_unix_ms: 2, revoked_at_unix_ms: 0 };
    const perform = vi.fn().mockResolvedValue({ ok: true, gateway_clients: [client] });
    mount(perform); await settle();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'list_gateway_clients', gateway_id: 'gateway-one' });
    button('gatewayClients.revoke').click(); await settle();
    expect(perform).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(i18n.t('gatewayClients.revokeHelp'));
    perform.mockResolvedValueOnce({ ok: true, gateway_clients: [{ ...client, revoked_at_unix_ms: 3 }] });
    button('gatewayClients.confirmRevoke').click(); await settle();
    expect(perform.mock.calls[1]?.[0]).toEqual({ kind: 'revoke_gateway_client', gateway_id: 'gateway-one', client_key_id: 'client-one' });
    expect(document.body.textContent).toContain(i18n.t('gatewayClients.revoked'));
  });

  it('hides explanation by default and disables expired code copying', async () => {
    vi.useFakeTimers();
    const perform = vi.fn().mockResolvedValue({ ok: true, gateway_clients: [] });
    mount(perform); await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector('details')?.open).toBe(false);
    perform.mockResolvedValueOnce({ ok: true, gateway_access_code: { access_code: 'one-use', expires_at_unix_ms: Date.now() + 600000 } });
    button('gatewayClients.createCode').click(); await vi.advanceTimersByTimeAsync(0);
    expect(document.body.textContent).toContain('10:00');
    expect(button('common.copy').disabled).toBe(false);
    await vi.advanceTimersByTimeAsync(600001);
    expect(document.body.textContent).toContain(i18n.t('gatewayClients.codeExpired'));
    expect(button('common.copy').disabled).toBe(true);
  });

  it('does not restore an old response after switching Gateway', async () => {
    let finish!: (value: unknown) => void;
    const perform = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue({ ok: true, gateway_clients: [] });
    const setID = mount(perform); await settle();
    setID('gateway-two'); await settle();
    finish({ ok: true, gateway_access_code: { access_code: 'old-secret', expires_at_unix_ms: Date.now() + 600000 } }); await settle();
    expect(document.body.textContent).not.toContain('old-secret');
    expect(perform.mock.calls[1]?.[0]).toEqual({ kind: 'list_gateway_clients', gateway_id: 'gateway-two' });
  });
});
