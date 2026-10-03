import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from './App';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { testDesktopPreferences } from '../testSupport/desktopTestHelpers';
import { controlText } from '../testSupport/controlText';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';

const disposers: (() => void)[] = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 50));
function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>('button')].find(element =>
    !element.closest('[hidden], [aria-hidden="true"]') && (controlText(element) === label || element.getAttribute('aria-label') === label));
  if (!found) throw new Error(`Missing button ${label}: ${[...document.querySelectorAll('button')].map(controlText).join(', ')}`);
  return found;
}
function input(id: string, value: string) {
  const element = document.getElementById(id) as HTMLInputElement;
  expect(element).toBeTruthy(); element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
}
async function mount(gateway?: DesktopGatewaySource) {
  document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const snapshot = buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences(), gatewaySources: gateway ? [gateway] : [] });
  const performAction = vi.fn(async (_request: DesktopLauncherActionRequest) => ({ ok: true as const, outcome: 'saved_gateway' as const }));
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{
    launcher: { getSnapshot: async () => snapshot, performAction, subscribeSnapshot: () => () => {}, getSSHConfigHosts: async () => [] },
    settings: { requestRuntimeFlower: async () => ({ ok: false, error: { message: 'No Runtime in this Gateway fixture' } }) },
  } as unknown as DesktopWelcomeRuntime} />, host));
  await settle();
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation) });
  return performAction;
}
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, 'animate'); });

describe('Gateway setup and own-service actions', () => {
  it('saves an explicit local Gateway without creating a Runtime registration', async () => {
    const perform = await mount();
    button('Gateways').click(); await settle();
    button('Add').click(); await settle();
    button('Local host').click(); await settle();
    input('gateway-data-root', '/tmp/gateway-fixture');
    input('gateway-name', 'Local access directory');
    button('Save Gateway').click(); await settle();
    expect(perform).toHaveBeenCalledWith(expect.objectContaining({ kind: 'upsert_gateway', connection_kind: 'local_host',
      host_access: { kind: 'local_host' }, placement: expect.objectContaining({ kind: 'host_process', runtime_root: '/tmp/gateway-fixture' }),
      profile_write: false }));
    expect(perform.mock.calls.every(([request]) => request.kind === 'upsert_gateway')).toBe(true);
  });

  it('preserves SSH password whitespace and uses explicit Gateway coordinates', async () => {
    const perform = await mount();
    button('Gateways').click(); await settle();
    button('Add').click(); await settle();
    button('SSH Host').click(); await settle();
    input('gateway-ssh-destination', 'dev@bastion');
    button('Password prompt').click(); await settle();
    input('gateway-ssh-password', '  protected password  ');
    input('gateway-name', 'Office Gateway');
    button('Save Gateway').click(); await settle();
    expect(perform).toHaveBeenCalledWith(expect.objectContaining({ kind: 'upsert_gateway', connection_kind: 'ssh_host',
      host_access: expect.objectContaining({ kind: 'ssh_host', ssh: expect.objectContaining({ ssh_destination: 'dev@bastion', auth_mode: 'password' }) }),
      ssh_password: '  protected password  ', ssh_password_mode: 'replace' }));
  });

  it('opens URL pairing settings instead of sending a pairing request without a code', async () => {
    const perform = await mount({ gateway_id: 'gateway-fixture', display_name: 'Fixture Gateway', local_enabled: true,
      connection_kind: 'url', management_capability: 'access_only', capabilities: [], status: 'pairing_required',
      trust_state: 'unpaired', gateway_url: 'https://gateway.example', created_at_ms: 1, updated_at_ms: 1, environments: [] });
    button('Gateways').click(); await settle();
    button('Pair this Gateway').click(); await settle();
    expect(document.getElementById('gateway-pairing-code')).toBeTruthy();
    expect(perform).not.toHaveBeenCalled();
  });
  it('starts only the explicitly registered Gateway service', async () => {
    const perform = await mount({ gateway_id: 'managed-fixture', display_name: 'Managed Fixture', local_enabled: true,
      connection_kind: 'ssh_host', management_capability: 'managed_ssh_host', capabilities: [], status: 'offline',
      trust_state: 'unpaired', created_at_ms: 1, updated_at_ms: 1, environments: [], service_state: {
        status: 'not_started', can_start: true, can_stop: false, can_restart: false, can_update: false, can_pair_after_start: true,
      } });
    button('Gateways').click(); await settle();
    button('Start Gateway').click(); await settle();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'start_gateway', gateway_id: 'managed-fixture' });
  });

});
