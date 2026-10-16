import { afterEach, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { GatewayCloudPanel } from './GatewayCloudPanel';
import { createDesktopI18n } from '../shared/i18n';
import { controlText } from '../testSupport/controlText';
const i18n = createDesktopI18n('en-US');
const settle = () => new Promise(resolve => setTimeout(resolve, 25));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
function button(key: Parameters<typeof i18n.t>[0]) {
  const value = [...(document.querySelector('[role=dialog]') ?? document).querySelectorAll<HTMLButtonElement>('button')].find(el => controlText(el) === i18n.t(key));
  if (!value) throw new Error('Missing button ' + key);
  return value;
}
function mount(perform: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const [id, setID] = createSignal('gateway-one'), [available, setAvailable] = createSignal(true);
  const root = document.createElement('div'); document.body.append(root);
  dispose = render(() => <GatewayCloudPanel gatewayID={id()} gatewayName={id()} available={available()} i18n={i18n} />, root);
  return { setID, setAvailable };
}
const summary = { configured: true, state: 'active', management_url: 'https://cloud.example/manage' };
it('retains the open surface through authority loss and requires explicit revalidation', async () => {
  const perform = vi.fn().mockResolvedValue({ ok: true, gateway_cloud: summary });
  const f = mount(perform); [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => controlText(el) === i18n.t('gatewayCloud.title'))!.click(); await settle();
  const dialog = document.querySelector('[role=dialog]');
  f.setAvailable(false); await settle(); f.setAvailable(true); await settle();
  expect(document.querySelector('[role=dialog]')).toBe(dialog);
  expect(button('gatewayCloud.manage').disabled).toBe(true);
  expect(perform).toHaveBeenCalledOnce();
  button('interactionContinuity.revalidate').click(); await settle();
  expect(button('gatewayCloud.manage').disabled).toBe(false);
  expect(perform).toHaveBeenCalledTimes(2);
});
it('does not let late external-open failure overwrite a new opening', async () => {
  let finish!: (value: unknown) => void;
  vi.stubGlobal('redevenDesktopShell', { openExternalURL: () => new Promise(resolve => { finish = resolve; }) });
  const perform = vi.fn().mockResolvedValue({ ok: true, gateway_cloud: summary });
  mount(perform); [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => controlText(el) === i18n.t('gatewayCloud.title'))!.click(); await settle();
  button('gatewayCloud.manage').click(); await settle();
  button('common.close').click(); await settle();
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => controlText(el) === i18n.t('gatewayCloud.title'))!.click(); await settle();
  finish({ ok: false }); await settle();
  expect(document.querySelector('[role=dialog]')?.textContent).not.toContain(i18n.t('gatewayCloud.unavailable'));
});
it('fences an old request when Gateway identity changes without closing the dialog', async () => {
  let finish!: (value: unknown) => void;
  const perform = vi.fn().mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const f = mount(perform); [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => controlText(el) === i18n.t('gatewayCloud.title'))!.click(); await settle();
  const dialog = document.querySelector('[role=dialog]'); f.setID('gateway-two'); await settle();
  finish({ ok: true, gateway_cloud: summary }); await settle();
  expect(document.querySelector('[role=dialog]')).toBe(dialog);
  expect(document.body.textContent).toContain(i18n.t('interactionContinuity.unavailable'));
  expect(button('gatewayCloud.configure').disabled).toBe(true);
  expect(document.body.textContent).toContain(i18n.t('interactionContinuity.unavailable'));
});
