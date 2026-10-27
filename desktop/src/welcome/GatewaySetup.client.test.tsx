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
import { gatewayServiceStepProgress } from '../main/gatewayServiceProgress';

const disposers: (() => void)[] = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 50));
async function openSetup(transport = 'Local host') {
  button('Gateways').click(); await settle();
  button('Add').click(); await settle();
  document.querySelectorAll<HTMLButtonElement>('[data-gateway-onboarding-intent] button')[transport === 'URL' ? 0 : 1]!.click(); await settle();
  button(transport).click(); await settle();
}
async function openGatewayAccess() {
  button('Gateways').click(); await settle();
  const moreActions = document.querySelector<HTMLButtonElement>('.redeven-gateway-card [aria-haspopup="menu"]');
  expect(moreActions).toBeTruthy(); moreActions!.click(); await settle();
  expect([...document.querySelectorAll('[role="menuitem"]')].filter(item => controlText(item) === 'Grant access')).toHaveLength(0);
  button('Gateway settings').click(); await settle();
  button('Settings').click(); await settle();
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
  let snapshot = initialSnapshot ?? buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences(), gatewaySources: gateway ? [gateway] : [] });
  const performAction = vi.fn<(request: DesktopLauncherActionRequest) => Promise<DesktopLauncherActionResult>>(async () => ({ ok: true, outcome: 'saved_gateway' }));
  let receive: ((value: DesktopWelcomeSnapshot) => void) | undefined;
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{
    launcher: { getSnapshot: getSnapshot ?? (async () => snapshot), performAction, subscribeSnapshot: (listener: (value: DesktopWelcomeSnapshot) => void) => { receive = listener; return () => {}; }, getSSHConfigHosts: async () => [],
      listRuntimeContainers: async () => ({ ok: true, containers: [{ engine: 'docker', container_id: 'test-container-id',
        container_ref: 'qualification', container_label: 'Qualification container', image: 'debian', status_text: 'running' }] }) },
    settings: { cancel: () => {}, requestRuntimeFlower: async () => ({ ok: false, error: { message: 'No Runtime in this Gateway fixture' } }) },
  } as unknown as DesktopWelcomeRuntime} />, host));
  await settle();
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation) });
  return Object.assign(performAction, { publish: (value: DesktopWelcomeSnapshot) => { snapshot = value; receive?.(value); }, snapshot });
}
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, 'animate'); });

describe('Gateway product navigation', () => {
  it('keeps Welcome navigation and opens four management groups in one dialog', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    await mount(source); await openGatewayAccess();
    expect([...document.querySelectorAll('.redeven-gateway-settings-tablist [role="tab"]')].map(controlText)).toEqual(['Overview', 'Environments', 'Access', 'Settings']);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    button('Overview').click(); await settle();
    expect(document.querySelector('[data-gateway-add-environment]')).toBeTruthy();
    expect(button('Environments')).toBeTruthy();
    expect(button('Gateways')).toBeTruthy();
  });

  it('replaces management with the shared environment choice and restores its context', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const perform = await mount(source); await openGatewayAccess();
    button('Overview').click(); await settle();
    const trigger = document.querySelector<HTMLButtonElement>('[data-gateway-add-environment]')!;
    trigger.focus(); trigger.click(); await settle();
    await vi.waitFor(() => expect(document.querySelector('[data-gateway-environment-choice]')).toBeTruthy());
    expect(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).toHaveLength(1);
    expect(perform).not.toHaveBeenCalled();
    button('Cancel').click(); await settle();
    await vi.waitFor(() => expect(document.querySelector('.redeven-gateway-settings-tablist')).toBeTruthy());
    expect(document.getElementById('gateway-settings-tab-overview')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[data-gateway-environment-choice]')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('retains network drafts while enrollment replaces the manager', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    await mount({ ...source, connection_kind: 'local_host', permissions: { access: true, manage_members: true, configure_cloud: true } });
    await openGatewayAccess(); input('gateway-listen-addresses', '127.0.0.1:7555');
    const page = document.querySelector('[data-desktop-page="environments"]')!;
    const content = [...page.children];
    button('Overview').click(); await settle();
    document.querySelector<HTMLButtonElement>('[data-gateway-add-environment]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-gateway-environment-choice]')).toBeTruthy());
    button('Close').click();
    await vi.waitFor(() => expect(document.querySelector('.redeven-gateway-wizard-dialog')).toBeNull());
    expect([...page.children]).toEqual(content);
    document.querySelector<HTMLButtonElement>('[data-gateway-add-environment]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-gateway-environment-choice]')).toBeTruthy());
    button('Cancel').click(); await settle();
    await vi.waitFor(() => expect(document.querySelector('.redeven-gateway-settings-tablist')).toBeTruthy());
    button('Settings').click(); await settle();
    expect((document.getElementById('gateway-listen-addresses') as HTMLInputElement).value).toBe('127.0.0.1:7555');
  });

  it('keeps service confirmation in the management layer and returns without a duplicate popover', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const perform = await mount({ ...source, connection_kind: 'local_host', management_capability: 'managed_local_host',
      service_state: { status: 'ready', can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false } });
    await openGatewayAccess(); button('Restart Gateway').click(); await settle();
    expect(document.querySelector('[role="dialog"] .redeven-gateway-action-panel')).toBeTruthy();
    expect(document.querySelector('.redeven-gateway-action-popover-surface')).toBeNull();
    expect(perform).not.toHaveBeenCalled();
    button('Back').click(); await settle();
    expect(document.querySelector('.redeven-gateway-action-popover-surface')).toBeNull();
    expect(document.getElementById('gateway-settings-tab-connection')?.getAttribute('aria-selected')).toBe('true');
  });

  it('opens Cloud directly in Access and initializes its content once', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const perform = await mount({ ...source, connection_kind: 'local_host', permissions: { access: true, manage_members: true, configure_cloud: true } });
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    perform.mockResolvedValue({ ok: true, outcome: 'gateway_cloud_updated', gateway_cloud: { configured: false, state: 'unconfigured' } });
    button('Gateways').click(); await settle(); document.querySelector<HTMLButtonElement>('.redeven-gateway-card__actions button')!.click(); await settle();
    expect(document.getElementById('gateway-settings-tab-clients')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.redeven-gateway-cloud-embedded')?.textContent).toContain('Cloud access is not configured.');
    expect(perform.mock.calls.filter(([request]) => request.kind === 'inspect_gateway_cloud')).toHaveLength(1);
  });

  it('returns a newly saved Gateway to its exact overview and enrollment context', async () => {
    const source = { ...compactEnvironmentPreviewFixture().coverage.gateway_sources[0], gateway_id: 'newly-saved-gateway',
      display_name: 'New local Gateway', connection_kind: 'local_host' as const };
    const perform = await mount(); await openSetup();
    input('gateway-name', source.display_name);
    perform.mockImplementationOnce(async () => {
      perform.publish({ ...perform.snapshot, gateway_sources: [source] });
      return { ok: true, outcome: 'saved_gateway', gateway_id: source.gateway_id };
    });
    button('Save Gateway').click(); await settle();
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(document.getElementById('gateway-settings-tab-overview')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Gateway connection saved.');
    expect(document.querySelector('.redeven-gateway-card')?.getAttribute('data-gateway-id')).toBe(source.gateway_id);
    document.querySelector<HTMLButtonElement>('[data-gateway-add-environment]')!.click(); await settle();
    await vi.waitFor(() => expect(document.querySelector('[data-gateway-environment-choice]')).toBeTruthy());
    expect(perform.mock.calls.map(([request]) => request.kind)).toEqual(['upsert_gateway']);
  });

  it('offers URL access and host deployment as separate creation intents', async () => {
    await mount(); await openSetup('URL');
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('SSH host');
    button('Back').click(); await settle();
    expect(document.querySelector('[data-gateway-onboarding-intent]')).toBeTruthy();
    document.querySelectorAll<HTMLButtonElement>('[data-gateway-onboarding-intent] button')[1]!.click(); await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Local host');
    expect(document.getElementById('gateway-url')).toBeNull();
  });
});

describe('Gateway setup and own-service actions', () => {
  it('opens an already running update directly in progress after the launcher reconnects', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const gateway = { ...source, connection_kind: 'ssh_host' as const, management_capability: 'managed_ssh_host' as const,
      service_state: { status: 'service_needs_update' as const, can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false } };
    const snapshot = buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences(), gatewaySources: [gateway] });
    const startedAt = Date.now() - 60_000;
    const perform = await mount(gateway, { ...snapshot, action_progress: [{
      action: 'update_gateway', subject_kind: 'gateway', subject_id: gateway.gateway_id, gateway_id: gateway.gateway_id,
      operation_key: gateway.gateway_id + ':update_gateway', started_at_unix_ms: startedAt, updated_at_unix_ms: startedAt,
      status: 'running', active_progress_surface: 'gateway', phase: 'installing_gateway', title: 'Update Gateway', detail: '',
      step_progress: gatewayServiceStepProgress(undefined, 'installing_gateway', 'running', startedAt),
    }] });
    button('Gateways').click(); await settle();
    const trigger = document.querySelector<HTMLButtonElement>('.redeven-gateway-card__primary-button')!;
    expect(trigger.textContent).toContain('Updating');
    trigger.click(); await settle();
    expect(document.querySelector('.redeven-gateway-action-panel')).toBeNull();
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe('Installing Gateway package');
    expect(perform).not.toHaveBeenCalled();
  });

  it('keeps update confirmation focused on the action with an accessible corner close control', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const perform = await mount({ ...source, connection_kind: 'ssh_host', management_capability: 'managed_ssh_host',
      service_state: { status: 'service_needs_update', can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false } });
    button('Gateways').click(); await settle(); button('Update Gateway').click(); await settle();
    const popup = document.querySelector('.redeven-gateway-action-popover-surface')!;
    expect(popup.querySelector('.redeven-gateway-action-panel__diagnostics-toggle')).toBeNull();
    const close = popup.querySelector<HTMLButtonElement>('button[aria-label="Close"]');
    expect(close?.querySelector('svg')).toBeTruthy();
    expect(perform).not.toHaveBeenCalled();
    close!.click();
    await vi.waitFor(() => expect(document.querySelector('.redeven-gateway-action-popover-surface')).toBeNull());
  });

  it.each(['succeeded', 'failed'] as const)('keeps update steps and trigger focus through closing, reopening and %s', async status => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const perform = await mount({ ...source, connection_kind: 'ssh_host', management_capability: 'managed_ssh_host',
      service_state: { status: 'service_needs_update', can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false } });
    perform.mockImplementation(() => new Promise(() => {}));
    button('Gateways').click(); await settle();
    const trigger = button('Update Gateway'); trigger.focus(); trigger.click(); await settle();
    document.querySelector<HTMLButtonElement>('.redeven-gateway-action-panel__primary-action')!.click(); await settle();
    const startedAt = Date.now();
    const detail = 'Desktop is opening the Gateway protocol stream through the managed Gateway service. /tmp/private-build/state';
    const progress = { action: 'update_gateway' as const, subject_kind: 'gateway' as const, subject_id: source.gateway_id,
      gateway_id: source.gateway_id, operation_key: source.gateway_id + ':update_gateway', started_at_unix_ms: startedAt,
      updated_at_unix_ms: startedAt, status: 'running' as const, active_progress_surface: 'gateway' as const,
      phase: 'installing_gateway', title: 'Update Gateway', detail,
      step_progress: gatewayServiceStepProgress(gatewayServiceStepProgress(undefined, 'preparing_gateway_package'), 'installing_gateway') };
    perform.publish({ ...perform.snapshot, action_progress: [progress] }); await settle();
    expect(document.querySelector('.redeven-gateway-card__primary-button')).toBe(trigger);
    const popup = document.querySelector('.redeven-gateway-action-popover-surface')!;
    expect(popup.querySelectorAll('.redeven-environment-progress__step')).toHaveLength(2);
    expect(popup.querySelector('[aria-current="step"]')?.textContent).toBe('Installing Gateway package');
    expect(popup.querySelector('.redeven-action-popover__detail')?.textContent ?? '').not.toContain(detail);
    const diagnostics = popup.querySelector('details');
    expect(diagnostics?.open).toBe(false);
    expect(diagnostics?.textContent).toContain(detail);
    popup.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.redeven-gateway-action-popover-surface')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    trigger.click(); await settle();
    const reopened = document.querySelector('.redeven-gateway-action-popover-surface')!;
    expect(document.querySelector('[aria-current="step"]')?.textContent).toBe('Installing Gateway package');
    expect(perform).toHaveBeenCalledOnce();
    perform.publish({ ...perform.snapshot, action_progress: [{ ...progress, status,
      updated_at_unix_ms: startedAt + 10_000,
      step_progress: { ...progress.step_progress, steps: progress.step_progress.steps.map(step => ({ ...step, status: step.status === 'running' ? status : step.status })) },
      ...(status === 'failed' ? { failure: { code: 'operation_failed' as const, severity: 'error' as const, title: 'Update Gateway',
        summary: 'Gateway is unavailable.', summary_key: 'gatewayAccess.unavailable' as const, diagnostics: [{ channel: 'stderr', label: 'Command output', text: detail }] } } : {}),
    }] }); await settle();
    expect(document.querySelector('.redeven-gateway-action-popover-surface')).toBe(reopened);
    expect(document.querySelector('.redeven-gateway-card__primary-button')).toBe(trigger);
    expect(reopened.querySelectorAll('.redeven-environment-progress__step')).toHaveLength(2);
    expect(reopened.querySelector('[aria-current="step"]')).toBeNull();
    expect(reopened.querySelector('.redeven-environment-progress__elapsed')?.textContent).toContain('10');
    expect(reopened.querySelector('details')?.open).toBe(false);
    if (status === 'failed') expect(reopened.querySelector('.redeven-action-popover__notice-detail')?.textContent).toBe('Gateway unavailable');
  });

  it('retains Gateway drafts through identity replacement and requires explicit verification after return', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const perform = await mount(source); await openGatewayAccess();
    input('gateway-name', 'Retained Gateway draft');
    const dialog = document.querySelector('[role=dialog]');
    const field = document.getElementById('gateway-name'); field?.focus();
    perform.publish({ ...perform.snapshot, gateway_sources: [{ ...source, identity_fingerprint: 'changed-identity' }] }); await settle();
    perform.publish(perform.snapshot); await settle();
    expect(document.querySelector('[role=dialog]')).toBe(dialog);
    expect(document.getElementById('gateway-name')).toBe(field);
    expect((field as HTMLInputElement).value).toBe('Retained Gateway draft');
    expect(button('Save Gateway').disabled).toBe(true);
    button('Verify current target').click(); await settle();
    expect(button('Save Gateway').disabled).toBe(false);
    expect((field as HTMLInputElement).value).toBe('Retained Gateway draft');
    expect(perform).not.toHaveBeenCalled();
  });

  it.each([true, false])('uses matching icon containers for every Gateway menu action, member management=%s', async manageMembers => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const perform = await mount({ ...source, connection_kind: 'local_host', management_capability: 'managed_local_host',
      permissions: { access: true, manage_members: manageMembers, configure_cloud: true },
      service_state: { status: 'service_needs_update', can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false } });
    button('Gateways').click(); await settle();
    document.querySelector<HTMLButtonElement>('.redeven-gateway-card [aria-haspopup="menu"]')!.click(); await settle();
    const items = [...document.querySelectorAll<HTMLElement>('.redeven-gateway-menu [role="menuitem"]')];
    expect(items.map(controlText)).toEqual(['Stop Gateway', 'Restart Gateway', 'Refresh', 'Disable Gateway',
      'Gateway settings', 'Remove connection']);
    for (const item of items) {
      expect(item.firstElementChild?.className, controlText(item)).toBe('redeven-split-menu-item-icon');
      expect(item.querySelectorAll('.redeven-split-menu-item-icon > svg'), controlText(item)).toHaveLength(1);
      expect(item.querySelector(':scope > svg'), controlText(item)).toBeNull();
    }
    expect(button('Remove connection').dataset.tone).toBe('danger');
    expect(button('Disable Gateway').dataset.tone).toBe('accent');
    expect(perform).not.toHaveBeenCalled();
  });

  it('distinguishes restart from refresh and retains explicit restart confirmation', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const perform = await mount({ ...source, connection_kind: 'local_host', management_capability: 'managed_local_host',
      service_state: { status: 'service_needs_update', can_start: false, can_stop: true, can_restart: true, can_update: true, can_pair_after_start: false } });
    button('Gateways').click(); await settle();
    const initialGlyph = document.querySelector('.redeven-gateway-card__primary-button svg')!.innerHTML;
    document.querySelector<HTMLButtonElement>('.redeven-gateway-card [aria-haspopup="menu"]')!.click(); await settle();
    const restart = button('Restart Gateway');
    const restartGlyph = restart.querySelector('svg')!.innerHTML;
    expect(restartGlyph).not.toBe(button('Refresh').querySelector('svg')!.innerHTML);
    restart.click(); await settle();
    await vi.waitFor(() => expect(document.querySelector('.redeven-gateway-menu')).toBeNull());
    expect(document.querySelector('.redeven-gateway-action-popover-surface')?.textContent).toContain('Restart Gateway');
    expect(document.querySelector('.redeven-gateway-card__primary-button svg')?.innerHTML).toBe(restartGlyph);
    expect(perform).not.toHaveBeenCalled();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('.redeven-gateway-action-popover-surface')).toBeNull());
    expect(document.querySelector('.redeven-gateway-card__primary-button svg')?.innerHTML).toBe(initialGlyph);
  });

  it('offers explicit authorization for a read-only Gateway without granting it automatically', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const perform = await mount({ ...source, capabilities: ['member_access'], permissions: { access: true, manage_members: false, configure_cloud: false } });
    await openGatewayAccess();
    expect(document.getElementById('gateway-access-code')).toBeTruthy();
    expect(perform).not.toHaveBeenCalled();
  });

  it('preserves existing the client credential when saving only a Gateway name', async () => {
    const source = compactEnvironmentPreviewFixture().coverage.gateway_sources[0];
    const permissions = { access: true, manage_members: false, configure_cloud: true };
    const perform = await mount({ ...source, permissions, gateway_url: 'https://gateway.example/' });
    await openGatewayAccess();
    const cloud = [...document.querySelectorAll<HTMLElement>('[role="checkbox"], input[type="checkbox"]')]
      .find(element => element.closest('label')?.textContent?.includes("Set up this Gateway's Cloud access")
        || element.getAttribute('aria-label') === "Set up this Gateway's Cloud access");
    expect(cloud).toBeUndefined();
    input('gateway-name', 'Renamed Gateway');
    button('Save Gateway').click(); await settle();
    expect(perform).toHaveBeenCalledOnce();
    expect(perform.mock.calls[0]?.[0]).toMatchObject({ kind: 'upsert_gateway', display_name: 'Renamed Gateway' });
  });

  it('opens Gateway environment rows explicitly through their owning Gateway', async () => {
    const perform = await mount(undefined, compactEnvironmentPreviewFixture().coverage);
    button('Gateways').click(); await settle();
    button('View Environments').click(); await settle();
    expect(document.querySelector('[data-gateway-id="bastion"]')).toBeTruthy();
    expect(document.querySelector('[data-gateway-environment-id="internal-workspace"]')?.textContent).toContain('Gateway workspace');
    button('Open window').click(); await settle();
    expect(perform.mock.calls[0]?.[0]).toMatchObject({ kind: 'open_gateway_environment', gateway_id: 'bastion', gateway_env_id: 'internal-workspace' });
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
    const technicalDetails = Array.from(document.querySelectorAll('details')).find(element =>
      element.querySelector('summary')?.textContent?.includes('Technical error details'));
    expect(technicalDetails?.textContent).toContain('Gateway URL must use HTTP or HTTPS.');
    expect(technicalDetails?.textContent).toContain('Fixture diagnostic');
  });
  it('requires a pairing code before claiming to grant member management authorization', async () => {
    const perform = await mount();
    await openSetup('URL');
    input('gateway-url', 'https://gateway.example/');
    button('Save Gateway').click(); await settle();
    expect(perform).not.toHaveBeenCalled();
    expect(document.getElementById('gateway-access-code')?.getAttribute('aria-invalid')).toBe('true');
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

  it('submits a URL Gateway with an access code without requested authority', async () => {
    const perform = await mount();
    await openSetup('URL');
    input('gateway-url', 'https://gateway.example/');
    input('gateway-access-code', 'test-pairing-code');
    button('Save Gateway').click(); await settle();
    expect(normalizeDesktopLauncherActionRequest(perform.mock.calls[0]?.[0])).toMatchObject({ kind: 'upsert_gateway',
      connection_kind: 'url', gateway_url: 'https://gateway.example/', access_code: 'test-pairing-code' });
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

  it('preserves the saved identity and draft when host verification needs Start', async () => {
    const perform = await mount();
    await openSetup();
    input('gateway-name', 'Draft Gateway');
    perform.mockResolvedValueOnce({ ok: false, scope: 'dialog', code: 'gateway_start_required', message: 'Connection saved. Start before granting permission.',
      gateway_id: 'saved-fixture', continuation_action: { kind: 'start_gateway', gateway_id: 'saved-fixture' } });
    button('Save Gateway').click(); await settle();
    expect(perform.mock.calls[0]?.[0]).toMatchObject({ kind: 'upsert_gateway' });
    expect((document.getElementById('gateway-name') as HTMLInputElement).value).toBe('Draft Gateway');
    perform.mockResolvedValueOnce({ ok: true, outcome: 'started_gateway' });
    button('Start Gateway').click(); await settle();
    expect(perform.mock.calls.map(([request]) => request.kind)).toEqual(['upsert_gateway', 'start_gateway']);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Review your changes, then retry.');
    button('Save Gateway').click(); await settle();
    expect(perform.mock.calls[2]?.[0]).toMatchObject({ kind: 'upsert_gateway', gateway_id: 'saved-fixture', display_name: 'Draft Gateway' });
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
    document.querySelectorAll<HTMLButtonElement>('[data-gateway-onboarding-intent] button')[1]!.click(); await settle();
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
  it('saves an explicit local Gateway without creating a Runtime registration', async () => {
    const perform = await mount();
    button('Gateways').click(); await settle();
    button('Add').click(); await settle();
    document.querySelectorAll<HTMLButtonElement>('[data-gateway-onboarding-intent] button')[1]!.click(); await settle();
    button('Local host').click(); await settle();
    input('gateway-data-root', '/tmp/gateway-fixture');
    input('gateway-name', 'Local access directory');
    button('Save Gateway').click(); await settle();
    expect(perform).toHaveBeenCalledWith(expect.objectContaining({ kind: 'upsert_gateway', connection_kind: 'local_host',
      host_access: { kind: 'local_host' }, placement: expect.objectContaining({ kind: 'host_process', runtime_root: '/tmp/gateway-fixture' }),
       }));
    expect(perform.mock.calls.every(([request]) => request.kind === 'upsert_gateway')).toBe(true);
    expect(normalizeDesktopLauncherActionRequest(perform.mock.calls[0]?.[0])).not.toBeNull();
  });

  it('preserves SSH password whitespace and uses explicit Gateway coordinates', async () => {
    const perform = await mount();
    button('Gateways').click(); await settle();
    button('Add').click(); await settle();
    document.querySelectorAll<HTMLButtonElement>('[data-gateway-onboarding-intent] button')[1]!.click(); await settle();
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
    expect(document.getElementById('gateway-access-code')).toBeTruthy();
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

  it.each(['rejected', 'exception', 'malformed'] as const)('keeps %s Gateway admission in the current popup with retry and close',async failure=>{
    const perform=await mount(compactEnvironmentPreviewFixture().coverage.gateway_sources[0]);
    let complete!:(value:DesktopLauncherActionResult)=>void;
    perform.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
    button('Gateways').click();await settle();button('Refresh').click();await settle();
    const popup=document.querySelector('.redeven-gateway-action-popover-surface');
    expect(popup?.textContent).toContain('Waiting for operation acceptance');
    complete({ok:false,scope:'dialog',code:'action_invalid',message:'Admission refused'});await settle();
    expect(document.querySelector('.redeven-gateway-action-popover-surface')).toBe(popup);
    expect(popup?.textContent).toContain('Admission refused');
    if (failure === 'exception') perform.mockRejectedValueOnce(new Error('Transport interrupted'));
    if (failure === 'malformed') perform.mockResolvedValueOnce(undefined as unknown as DesktopLauncherActionResult);
    button('Retry').click();await settle();expect(perform).toHaveBeenCalledTimes(2);
    if (failure !== 'rejected') {
      expect(document.querySelector('.redeven-gateway-action-popover-surface')).toBe(popup);
      expect(button('Retry').disabled).toBe(false);
    }
    button('Close').click();await vi.waitFor(()=>expect(document.querySelector('.redeven-gateway-action-popover-surface')).toBeNull());
  });

});
