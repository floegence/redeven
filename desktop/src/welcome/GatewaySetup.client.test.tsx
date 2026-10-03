import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from './App';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { testDesktopPreferences } from '../testSupport/desktopTestHelpers';
import { controlText } from '../testSupport/controlText';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopLauncherActionRequest, DesktopLauncherActionResult, DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';
import { compactEnvironmentPreviewFixture } from '../testSupport/compactEnvironmentPreviewFixture';

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
async function mount(gateway?: DesktopGatewaySource, initialSnapshot?: DesktopWelcomeSnapshot, getSnapshot?: () => Promise<DesktopWelcomeSnapshot>) {
  document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const snapshot = initialSnapshot ?? buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences(), gatewaySources: gateway ? [gateway] : [] });
  const performAction = vi.fn<(request: DesktopLauncherActionRequest) => Promise<DesktopLauncherActionResult>>(async () => ({ ok: true, outcome: 'saved_gateway' }));
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{
    launcher: { getSnapshot: getSnapshot ?? (async () => snapshot), performAction, subscribeSnapshot: () => () => {}, getSSHConfigHosts: async () => [] },
    settings: { requestRuntimeFlower: async () => ({ ok: false, error: { message: 'No Runtime in this Gateway fixture' } }) },
  } as unknown as DesktopWelcomeRuntime} />, host));
  await settle();
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation) });
  return performAction;
}
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, 'animate'); });

describe('Gateway setup and own-service actions', () => {
  it('retains a profile draft and starts the Gateway only after an explicit click, then waits for Save', async () => {
    const snapshot = compactEnvironmentPreviewFixture().coverage;
    const perform = await mount(undefined, snapshot);
    perform.mockResolvedValueOnce({ ok: false, scope: 'dialog', code: 'gateway_start_required', message: 'Start Gateway before saving.',
      gateway_id: 'bastion', continuation_action: { kind: 'start_gateway', gateway_id: 'bastion' } });
    button('Settings for Gateway workspace').click(); await settle();
    input('environment-label', 'Preserved draft');
    button('Save').click(); await settle();
    expect(perform.mock.calls.map(([request]) => request.kind)).toEqual(['upsert_environment_registration']);
    expect((document.getElementById('environment-label') as HTMLInputElement).value).toBe('Preserved draft');
    perform.mockResolvedValueOnce({ ok: true, outcome: 'started_gateway' });
    button('Start Gateway').click(); await settle();
    expect(perform.mock.calls.map(([request]) => request.kind)).toEqual(['upsert_environment_registration', 'start_gateway']);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Review your changes, then retry.');
    expect((document.getElementById('environment-label') as HTMLInputElement).value).toBe('Preserved draft');
    perform.mockResolvedValueOnce({ ok: true, outcome: 'saved_gateway_environment', environment_id: snapshot.environments.find(entry => entry.kind === 'gateway_environment')!.id });
    button('Save').click(); await settle();
    expect(perform.mock.calls[2]?.[0]).toMatchObject({ kind: 'upsert_environment_registration', registration: { display_name: 'Preserved draft' } });
  });

  it('keeps profile deletion explicit after starting the stopped Gateway', async () => {
    const perform = await mount(undefined, compactEnvironmentPreviewFixture().coverage);
    button('Remove Gateway workspace').click(); await settle();
    perform.mockResolvedValueOnce({ ok: false, scope: 'dialog', code: 'gateway_start_required', message: 'Start Gateway before deleting.',
      gateway_id: 'bastion', continuation_action: { kind: 'start_gateway', gateway_id: 'bastion' } });
    button('Delete from Gateway').click(); await settle();
    expect(perform.mock.calls.map(([request]) => request.kind)).toEqual(['delete_environment_registration']);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Start Gateway before deleting.');
    perform.mockResolvedValueOnce({ ok: true, outcome: 'started_gateway' });
    button('Start Gateway').click(); await settle();
    expect(perform.mock.calls.map(([request]) => request.kind)).toEqual(['delete_environment_registration', 'start_gateway']);
    perform.mockResolvedValueOnce({ ok: true, outcome: 'deleted_gateway_environment' });
    button('Delete from Gateway').click(); await settle();
    expect(perform.mock.calls.map(([request]) => request.kind)).toEqual(['delete_environment_registration', 'start_gateway', 'delete_environment_registration']);
  });

  it.each([true, false])('keeps the result of Start while editing a new profile, success=%s', async success => {
    const perform = await mount(undefined, compactEnvironmentPreviewFixture().coverage);
    button('Through Gateway').click(); await settle();
    input('gateway-environment-target-url', 'https://runtime.example/');
    input('environment-label', 'Draft before Start');
    perform.mockResolvedValueOnce({ ok: false, scope: 'dialog', code: 'gateway_start_required', message: 'Start Gateway before saving.',
      gateway_id: 'bastion', continuation_action: { kind: 'start_gateway', gateway_id: 'bastion' } });
    button('Save').click(); await settle();
    let complete!: (result: DesktopLauncherActionResult) => void;
    perform.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    button('Start Gateway').click(); await settle();
    input('environment-label', 'Edited during Start');
    complete(success ? { ok: true, outcome: 'started_gateway' }
      : { ok: false, code: 'gateway_service_start_failed', scope: 'gateway', message: 'Fixture start failed' });
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(success ? 'Review your changes, then retry.' : 'Fixture start failed');
    expect((document.getElementById('environment-label') as HTMLInputElement).value).toBe('Edited during Start');
    expect(perform.mock.calls.map(([request]) => request.kind)).toEqual(['upsert_environment_registration', 'start_gateway']);
  });

  it('reports snapshot refresh failure without losing a successful explicit Start or the profile draft', async () => {
    const snapshot = compactEnvironmentPreviewFixture().coverage;
    const getSnapshot = vi.fn(async () => snapshot);
    const perform = await mount(undefined, snapshot, getSnapshot);
    button('Through Gateway').click(); await settle();
    input('gateway-environment-target-url', 'https://runtime.example/');
    input('environment-label', 'Retained after refresh failure');
    perform.mockResolvedValueOnce({ ok: false, scope: 'dialog', code: 'gateway_start_required', message: 'Start Gateway before saving.',
      gateway_id: 'bastion', continuation_action: { kind: 'start_gateway', gateway_id: 'bastion' } });
    button('Save').click(); await settle();
    getSnapshot.mockRejectedValueOnce(new Error('Fixture snapshot unavailable'));
    perform.mockResolvedValueOnce({ ok: true, outcome: 'started_gateway' });
    button('Start Gateway').click(); await settle();
    expect(document.body.textContent).toContain('Fixture snapshot unavailable');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Review your changes, then retry.');
    expect((document.getElementById('environment-label') as HTMLInputElement).value).toBe('Retained after refresh failure');
    expect(perform.mock.calls.map(([request]) => request.kind)).toEqual(['upsert_environment_registration', 'start_gateway']);
  });

  it('does not deliver a pending Start result to a reopened profile dialog', async () => {
    const perform = await mount(undefined, compactEnvironmentPreviewFixture().coverage);
    button('Through Gateway').click(); await settle();
    input('gateway-environment-target-url', 'https://runtime.example/');
    perform.mockResolvedValueOnce({ ok: false, scope: 'dialog', code: 'gateway_start_required', message: 'Start Gateway before saving.',
      gateway_id: 'bastion', continuation_action: { kind: 'start_gateway', gateway_id: 'bastion' } });
    button('Save').click(); await settle();
    let complete!: (result: DesktopLauncherActionResult) => void;
    perform.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    button('Start Gateway').click(); await settle();
    button('Cancel').click(); await settle();
    button('Through Gateway').click(); await settle();
    complete({ ok: false, code: 'gateway_service_start_failed', scope: 'gateway', message: 'Old start failed' });
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Old start failed');
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Start Gateway before saving.');
  });

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
