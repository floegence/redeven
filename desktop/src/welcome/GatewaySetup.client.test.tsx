import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from './App';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { testDesktopPreferences } from '../testSupport/desktopTestHelpers';
import { controlText } from '../testSupport/controlText';
import type { DesktopGatewaySource } from '../shared/desktopGateway';
import type { DesktopLauncherActionRequest, DesktopLauncherActionResult, DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';
import { normalizeDesktopLauncherActionRequest } from '../shared/desktopLauncherIPC';
import { compactEnvironmentPreviewFixture } from '../testSupport/compactEnvironmentPreviewFixture';

const disposers: (() => void)[] = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 50));
async function openSetup(transport = 'Local host') {
  button('Gateways').click(); await settle();
  button('Add').click(); await settle();
  button(transport).click(); await settle();
}
function grantWrite() {
  const checkbox = [...document.querySelectorAll<HTMLElement>('[role="checkbox"], input[type="checkbox"]')]
    .find(element => element.closest('label')?.textContent?.includes('Allow environment profile changes')
      || element.getAttribute('aria-label') === 'Allow environment profile changes');
  expect(checkbox).toBeTruthy(); checkbox!.click();
}
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
    launcher: { getSnapshot: getSnapshot ?? (async () => snapshot), performAction, subscribeSnapshot: () => () => {}, getSSHConfigHosts: async () => [],
      listRuntimeContainers: async () => ({ ok: true, containers: [{ engine: 'docker', container_id: 'test-container-id',
        container_ref: 'qualification', container_label: 'Qualification container', image: 'debian', status_text: 'running' }] }) },
    settings: { cancel: () => {}, requestRuntimeFlower: async () => ({ ok: false, error: { message: 'No Runtime in this Gateway fixture' } }) },
  } as unknown as DesktopWelcomeRuntime} />, host));
  await settle();
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation) });
  return performAction;
}
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, 'animate'); });

describe('Gateway setup and own-service actions', () => {
  it('explains profile permission without granting it or submitting the form', async () => {
    const perform = await mount();
    await openSetup();
    button('About environment profile permission').click(); await settle();
    expect(document.body.textContent).toContain('add, edit and delete');
    expect(document.body.textContent).toContain('password and MFA');
    expect(perform).not.toHaveBeenCalled();
    button('About environment profile permission').click(); await settle();
    expect(button('Save Gateway')).toBeTruthy();
  });

  it('adds an environment from its Gateway card with that Gateway selected', async () => {
    const snapshot = compactEnvironmentPreviewFixture().coverage;
    const perform = await mount(undefined, snapshot);
    button('Gateways').click(); await settle();
    button('Add environment').click(); await settle();
    expect(document.querySelector('[data-gateway-id="bastion"]')).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Environment type');
    expect(document.getElementById('gateway-environment-gateway')).toBeNull();
    input('gateway-environment-target-url', 'https://runtime.example/');
    input('environment-label', 'Registered from Gateway');
    button('Save').click(); await settle();
    expect(perform.mock.calls[0]?.[0]).toMatchObject({ kind: 'upsert_environment_registration', registration: { registration_ref: { kind: 'gateway_environment', gateway_id: 'bastion' }, access_mode: 'gateway_proxy' } });
  });

  it('offers explicit authorization for a read-only Gateway without granting it automatically', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const perform = await mount({ ...source, capabilities: ['env_catalog'] });
    button('Gateways').click(); await settle();
    button('Authorize changes').click(); await settle();
    expect(document.getElementById('gateway-pairing-code')).toBeTruthy();
    expect(perform).not.toHaveBeenCalled();
  });

  it('cancels Gateway environment creation in place without submitting or changing the Gateway', async () => {
    const perform = await mount(undefined, compactEnvironmentPreviewFixture().coverage);
    button('Gateways').click(); await settle();
    button('Add environment').click(); await settle();
    input('gateway-environment-target-url', 'https://draft.example/');
    button('Cancel').click(); await settle();
    expect(document.querySelector('[data-gateway-id="bastion"]')).toBeTruthy();
    expect(perform).not.toHaveBeenCalled();
    button('Add environment').click(); await settle();
    expect((document.getElementById('gateway-environment-target-url') as HTMLInputElement).value).toBe('');
  });

  it('keeps a failed Gateway profile draft in context and updates the local list after explicit retry', async () => {
    let snapshot = compactEnvironmentPreviewFixture().coverage;
    const perform = await mount(undefined, snapshot, async () => snapshot);
    button('Gateways').click(); await settle();
    button('Add environment').click(); await settle();
    input('gateway-environment-target-url', 'https://runtime.example/');
    input('environment-label', 'Added in place');
    perform.mockResolvedValueOnce({ ok: false, scope: 'dialog', code: 'gateway_catalog_failed', message: 'Gateway unavailable.' });
    button('Save').click(); await settle();
    expect(document.querySelector('[data-gateway-id="bastion"]')).toBeTruthy();
    expect((document.getElementById('environment-label') as HTMLInputElement).value).toBe('Added in place');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Gateway unavailable.');
    const original = snapshot.environments.find(entry => entry.kind === 'gateway_environment')!;
    snapshot = { ...snapshot, environments: [...snapshot.environments, { ...original, id: 'gateway-added', label: 'Added in place', gateway_env_id: 'added' }],
      gateway_sources: snapshot.gateway_sources.map(gateway => ({ ...gateway, environments: [...gateway.environments, { ...gateway.environments[0], gateway_env_id: 'added', display_name: 'Added in place' }] })) };
    perform.mockResolvedValueOnce({ ok: true, outcome: 'saved_gateway_environment', environment_id: 'gateway-added' });
    button('Save').click(); await settle();
    expect(document.getElementById('gateway-environment-target-url')).toBeNull();
    expect(document.querySelector('[data-gateway-id="bastion"]')?.textContent).toContain('2 environments');
    expect(document.querySelector('[data-gateway-environment-id="added"]')?.textContent).toContain('Added in place');
    expect(perform.mock.calls).toHaveLength(2);
  });

  it('expands Gateway environments locally and keeps explicit access modes on the shared request path', async () => {
    const perform = await mount(undefined, compactEnvironmentPreviewFixture().coverage);
    button('Gateways').click(); await settle();
    button('View Environments').click(); await settle();
    expect(document.querySelector('[data-gateway-id="bastion"]')).toBeTruthy();
    expect(document.querySelector('[data-gateway-environment-id="internal-workspace"]')?.textContent).toContain('Gateway workspace');
    button('Open direct URL').click(); await settle();
    expect(perform.mock.calls[0]?.[0]).toMatchObject({ kind: 'open_gateway_environment', gateway_id: 'bastion', gateway_env_id: 'internal-workspace', access_mode: 'direct_url' });
    expect(perform.mock.calls).toHaveLength(1);
  });

  it('expands only the selected Gateway environment list without performing a connection action', async () => {
    const perform = await mount(undefined, compactEnvironmentPreviewFixture().coverage);
    button('Gateways').click(); await settle();
    button('View Environments').click(); await settle();
    await vi.waitFor(() => expect(document.querySelectorAll('[data-gateway-environment-id]')).toHaveLength(1));
    expect(document.querySelector('[data-gateway-environment-id]')?.textContent).toContain('Gateway workspace');
    expect(perform).not.toHaveBeenCalled();
  });

  it('shows the structured technical cause alongside localized setup guidance', async () => {
    const perform = await mount();
    await openSetup();
    perform.mockResolvedValueOnce({ ok: false, scope: 'dialog', code: 'action_invalid', message: 'Gateway setup failed',
      failure: { code: 'operation_failed', severity: 'error', title: 'Gateway setup', summary: 'Gateway setup failed',
        summary_key: 'gatewayAccess.setupFailed', detail: 'Gateway URL must use HTTP or HTTPS.',
        diagnostics: [{ channel: 'stderr', label: 'Command stderr', text: 'Fixture diagnostic' }] } });
    button('Save Gateway').click(); await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Gateway setup could not finish.');
    expect(document.querySelector('details')?.textContent).toContain('Gateway URL must use HTTP or HTTPS.');
    expect(document.querySelector('details')?.textContent).toContain('Fixture diagnostic');
  });
  it('requires a pairing code before claiming to grant URL profile authorization', async () => {
    const perform = await mount();
    await openSetup('URL');
    input('gateway-url', 'https://gateway.example/');
    grantWrite();
    button('Save Gateway').click(); await settle();
    expect(perform).not.toHaveBeenCalled();
    expect(document.getElementById('gateway-pairing-code')?.getAttribute('aria-invalid')).toBe('true');
  });
  it.each(['Local Container', 'SSH Container'])('submits valid %s coordinates from the container picker', async transport => {
    const perform = await mount();
    await openSetup(transport);
    if (transport === 'SSH Container') { input('gateway-ssh-destination', 'dev@bastion'); await settle(); }
    document.getElementById('environment-container-picker')!.click(); await settle();
    document.getElementById('environment-container-option-0')!.click(); await settle();
    input('gateway-name', 'Container Gateway');
    button('Save Gateway').click(); await settle();
    expect(perform).toHaveBeenCalledOnce();
    expect(normalizeDesktopLauncherActionRequest(perform.mock.calls[0]?.[0])).toMatchObject({ kind: 'upsert_gateway',
      connection_kind: transport === 'Local Container' ? 'local_container' : 'ssh_container',
      placement: { kind: 'container_process', container_id: 'test-container-id', container_ref: 'qualification', runtime_root: 'remote_default' } });
  });

  it('submits a URL Gateway with explicit pairing and independent profile consent', async () => {
    const perform = await mount();
    await openSetup('URL');
    input('gateway-url', 'https://gateway.example/');
    input('gateway-pairing-code', 'test-pairing-code');
    grantWrite();
    button('Save Gateway').click(); await settle();
    expect(normalizeDesktopLauncherActionRequest(perform.mock.calls[0]?.[0])).toMatchObject({ kind: 'upsert_gateway',
      connection_kind: 'url', gateway_url: 'https://gateway.example/', pairing_code: 'test-pairing-code', profile_write: true });
  });

  it.each(['Local host', 'SSH Host'])('submits valid default download coordinates for %s', async transport => {
    const perform = await mount();
    await openSetup(transport);
    if (transport === 'SSH Host') input('gateway-ssh-destination', 'dev@bastion');
    button('Save Gateway').click(); await settle();
    expect(perform).toHaveBeenCalledOnce();
    const request = normalizeDesktopLauncherActionRequest(perform.mock.calls[0]?.[0]);
    expect(request).toMatchObject({ kind: 'upsert_gateway', placement: { runtime_root: 'remote_default', release_base_url: '' } });
  });

  it('preserves the saved identity and draft when explicit profile authorization needs Start', async () => {
    const perform = await mount();
    await openSetup();
    input('gateway-name', 'Draft Gateway');
    grantWrite();
    perform.mockResolvedValueOnce({ ok: false, scope: 'dialog', code: 'gateway_start_required', message: 'Connection saved. Start before granting permission.',
      gateway_id: 'saved-fixture', continuation_action: { kind: 'start_gateway', gateway_id: 'saved-fixture' } });
    button('Save Gateway').click(); await settle();
    expect(perform.mock.calls[0]?.[0]).toMatchObject({ kind: 'upsert_gateway', profile_write: true });
    expect((document.getElementById('gateway-name') as HTMLInputElement).value).toBe('Draft Gateway');
    perform.mockResolvedValueOnce({ ok: true, outcome: 'started_gateway' });
    button('Start Gateway').click(); await settle();
    expect(perform.mock.calls.map(([request]) => request.kind)).toEqual(['upsert_gateway', 'start_gateway']);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Review your changes, then retry.');
    button('Save Gateway').click(); await settle();
    expect(perform.mock.calls[2]?.[0]).toMatchObject({ kind: 'upsert_gateway', gateway_id: 'saved-fixture', display_name: 'Draft Gateway', profile_write: true });
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });

  it.each([true, false])('ignores an old save after cancel and reopen, success=%s', async success => {
    const perform = await mount();
    await openSetup();
    let complete!: (result: DesktopLauncherActionResult) => void;
    perform.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    button('Save Gateway').click(); await settle();
    button('Save Gateway').click();
    expect(perform).toHaveBeenCalledOnce();
    button('Cancel').click(); await settle();
    button('Add').click(); await settle();
    input('gateway-name', 'New draft');
    complete(success ? { ok: true, outcome: 'saved_gateway' }
      : { ok: false, scope: 'dialog', code: 'action_invalid', message: 'Old save failure' });
    await settle();
    expect((document.getElementById('gateway-name') as HTMLInputElement).value).toBe('New draft');
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Old save failure');
  });

  it('retains the original failure and continuation even if snapshot refresh fails', async () => {
    const perform = await mount(undefined, undefined, async () => { throw new Error('Snapshot unavailable'); });
    await openSetup();
    perform.mockResolvedValueOnce({ ok: false, scope: 'dialog', code: 'gateway_start_required', message: 'Original authorization failure',
      should_refresh_snapshot: true, gateway_id: 'saved-fixture', continuation_action: { kind: 'start_gateway', gateway_id: 'saved-fixture' } });
    button('Save Gateway').click(); await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Original authorization failure');
    expect(button('Start Gateway')).toBeTruthy();
  });

  it('keeps a successful save successful when refreshing the snapshot fails', async () => {
    const perform = await mount(undefined, undefined, async () => { throw new Error('Snapshot unavailable'); });
    await openSetup();
    button('Save Gateway').click(); await settle();
    expect(perform).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });
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
    expect(normalizeDesktopLauncherActionRequest(perform.mock.calls[0]?.[0])).not.toBeNull();
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
    expect(normalizeDesktopLauncherActionRequest(perform.mock.calls[0]?.[0])).not.toBeNull();
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
  it('lets users close and reopen live Gateway progress without canceling or repeating the operation', async () => {
    const perform = await mount(compactEnvironmentPreviewFixture().coverage.gateway_sources[0]);
    let complete!: (result: DesktopLauncherActionResult) => void;
    perform.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    button('Gateways').click(); await settle();
    button('Refresh').click(); await settle();
    const progress = () => document.querySelector('.redeven-gateway-action-popover-surface');
    expect(progress()).toBeTruthy();
    expect(document.querySelector('.redeven-gateway-card [data-floe-progress-shimmer="surface"]')).toBeTruthy();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await vi.waitFor(() => expect(progress()).toBeNull());
    const trigger = document.querySelector<HTMLButtonElement>('.redeven-gateway-card__primary-button')!;
    expect(trigger.getAttribute('data-floe-progress-shimmer')).toBe('surface');
    trigger.click(); await settle();
    expect(progress()).toBeTruthy();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'refresh_gateway', gateway_id: 'bastion' });
    complete({ ok: true, outcome: 'refreshed_gateway' }); await settle();
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
