import { runtimeConnectionFixture } from '../testSupport/runtimeConnectionFixture';
import { runtimeGatewayAccessFixture } from '../testSupport/runtimeGatewayAccessFixture';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { mixedEnvironmentFixture } from '../testSupport/mixedEnvironmentFixture';
import { controlText } from '../testSupport/controlText';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from './App';
import { linkedEnvironmentFixture } from '../testSupport/linkedEnvironmentFixture';
import type { DesktopWelcomeSnapshot, DesktopLauncherActionRequest, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import { openConnectionProgress } from '../shared/desktopOpenConnectionProgress';
import { launchLocalEnvironmentFlowerTurn } from './flower/localEnvironmentFlowerSurfaceAdapter';

vi.mock('./flower/localEnvironmentFlowerSurfaceAdapter', async importOriginal => ({
  ...await importOriginal<typeof import('./flower/localEnvironmentFlowerSurfaceAdapter')>(),
  launchLocalEnvironmentFlowerTurn: vi.fn(async () => { throw new Error('Fixture stops at Flower admission'); }),
}));

const disposers: (() => void)[] = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 40));
function button(root: ParentNode, text: string) {
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(el => controlText(el) === text || el.getAttribute('aria-label') === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
async function mount(initialSnapshot?: DesktopWelcomeSnapshot) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const fixture = linkedEnvironmentFixture();
  let snapshot: DesktopWelcomeSnapshot = initialSnapshot ?? fixture.snapshot;
  let receive: ((value: DesktopWelcomeSnapshot) => void) | undefined;
  const performAction = vi.fn(async (_request: DesktopLauncherActionRequest) => ({ ok: true as const, outcome: 'opened_environment_window' as const }));
  const settings = { load: vi.fn(), save: vi.fn(), cancel: vi.fn(), requestRuntimeFlower: vi.fn() } as unknown as DesktopWelcomeRuntime['settings'];
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{ settings, launcher: {
    getSnapshot: async () => snapshot, performAction, subscribeSnapshot: listener => { receive = listener; return () => {}; },
  } }} />, host));
  await settle();
  // jsdom has no Web Animations; the browser acceptance checks real tab motion.
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, writable: true, value: vi.fn(() => ({ cancel: vi.fn() }) as unknown as Animation) });
  const owner = (role: string) => document.querySelector<HTMLElement>(`[data-owner-role="${role}"]`)!;
  const select = async (role: 'runtime' | 'cloud') => {
    const entry = role === 'cloud' ? fixture.cloud : fixture.runtime;
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    tabs[role === 'cloud' ? 1 : 0]?.click();
    await settle();
    expect(owner(role).closest('[aria-hidden="true"]')).toBeNull();
    expect(owner(role).dataset.ownerId).toBe(entry.id);
  };
  return { ...fixture, owner, select, settings, performAction, publish: (value: DesktopWelcomeSnapshot) => { snapshot = value; receive?.(value); } };
}
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, 'animate'); });

describe('linked environment owner interactions', () => {
  it.each(['local', 'ssh', 'wsl', 'local_container', 'ssh_container'] as const)('offers Gateway access for an unchecked %s Runtime without starting it', async kind => {
    const { environment: runtime, snapshot } = runtimeGatewayAccessFixture(kind, 'unknown');
    const h = await mount(snapshot);
    const owner = document.querySelector<HTMLElement>(`[data-owner-id="${runtime.id}"]`)!;
    button(owner, 'Actions').click(); await settle();
    button(document.querySelector('[role="menu"]')!, 'Add Gateway access').click(); await settle();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(h.performAction.mock.calls.every(([request]) => request.kind === 'refresh_environment_runtime')).toBe(true);
    expect(h.performAction).toHaveBeenCalledOnce();
    expect(h.performAction.mock.calls[0][0]).toMatchObject({ environment_id: runtime.id });
  });
  it.each([0, 1, 2])('enrolls only the original Runtime from access perspective %s', async perspective => {
    const fixture = runtimeConnectionFixture({ kind: 'ssh_environment' });
    const runtime = fixture.snapshot.environments.find(entry => entry.kind === 'ssh_environment')!;
    const perform = vi.fn(async () => ({ ok: true, gateway_membership: { joined: false, phase: 'not_joined' } }));
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    const h = await mount(fixture.snapshot);
    const card = document.querySelector(`[data-environment-group="${runtime.id}"]`)!;
    await selectTab(card, perspective);
    const owner = [...card.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find(panel => panel.getAttribute('aria-hidden') !== 'true')!;
    const toggle = button(owner, 'Actions'); toggle.click(); await settle();
    button(document.querySelector('[role="menu"]')!, 'Add Gateway access').click(); await settle();
    expect(perform).not.toHaveBeenCalled();
    button(document.querySelector('[role="dialog"]')!, 'Connect and continue').click(); await settle();
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'manage_runtime_gateway', runtime_target_id: runtime.provider_runtime_link_target!.id, operation: 'status' });
    expect(h.performAction).not.toHaveBeenCalled();
    button(document.querySelector('[role="dialog"]')!, 'Cancel').click(); await settle();
    expect(document.activeElement).toBe(toggle);
  });
  it.each([0, 1])('disables Gateway submission for busy Runtime owner from perspective %s while keeping settings available', async perspective => {
    const fixture = runtimeConnectionFixture({ kind: 'ssh_environment' });
    const runtime = fixture.snapshot.environments.find(entry => entry.kind === 'ssh_environment')!;
    const h = await mount(fixture.snapshot);
    h.publish({ ...fixture.snapshot, action_progress: [{ action: 'restart_environment_runtime', environment_id: runtime.id,
      status: 'running', phase: 'checking_runtime_service', title: 'Restart Runtime', detail: '', operation_key: 'runtime-restart', started_at_unix_ms: 1 }] });
    await settle();
    const card = document.querySelector(`[data-environment-group="${runtime.id}"]`)!;
    await selectTab(card, perspective);
    const owner = [...card.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find(panel => panel.getAttribute('aria-hidden') !== 'true')!;
    const settings = [...owner.querySelectorAll<HTMLButtonElement>('button')].find(button => button.getAttribute('aria-label')?.startsWith('Settings for'))!;
    expect(settings.disabled).toBe(false);
    button(owner, 'Actions').click(); await settle();
    expect(button(document.querySelector('[role="menu"]')!, 'Add Gateway access').disabled).toBe(true);
    expect(h.performAction).not.toHaveBeenCalled();
  });
  it.each(['local_environment', 'ssh_environment'] as const)(
    'shows Cloud connection status only in the Cloud perspective of a linked %s card',
    async kind => {
      const fixture = runtimeConnectionFixture({ kind });
      const runtime = fixture.snapshot.environments.find(entry => entry.kind === kind)!;
      const h = await mount(fixture.snapshot);
      const card = document.querySelector(`[data-environment-group="${runtime.id}"]`)!;
      const panels = [...card.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
      expect(panels).toHaveLength(3);
      expect(panels.map(panel => panel.querySelectorAll('[data-cloud-connection-status]').length)).toEqual([0, 1, 0]);
      const cloudStatus = panels[1].querySelector('[data-cloud-connection-status]')!;
      for (const index of [0, 1, 2, 1, 0]) {
        await selectTab(card, index);
        const visiblePanel = panels.find(panel => panel.getAttribute('aria-hidden') !== 'true')!;
        expect(visiblePanel.querySelector('[data-cloud-connection-status]')).toBe(index === 1 ? cloudStatus : null);
        if (index === 1) {
          cloudStatus.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!.click(); await settle();
          expect(document.querySelector('[data-cloud-connection-details]')).not.toBeNull();
        } else {
          await vi.waitFor(() => expect(document.querySelector('[data-cloud-connection-details]')).toBeNull());
        }
        h.publish(structuredClone(fixture.snapshot)); await settle();
        expect(panels[1].querySelector('[data-cloud-connection-status]')).toBe(cloudStatus);
        expect(visiblePanel.getAttribute('aria-hidden')).not.toBe('true');
      }
      expect(h.performAction).not.toHaveBeenCalled();
    },
  );

  it.each(['typed', 'local suggestion'] as const)('retains Gateway %s drafts across launcher snapshots', async method => {
    const fixture = mixedEnvironmentFixture();
    const original = fixture.snapshot.environments.find(entry => entry.kind === 'local_environment')!;
    const runtime = { ...original, runtime_service: { ...original.runtime_service!,
      compatibility: 'compatible' as const,
      capabilities: { ...original.runtime_service!.capabilities!, runtime_gateway: { supported: true } },
    } };
    const gateway = { gateway_id: 'local-gateway', display_name: 'Gateway-local', local_enabled: true as const,
      connection_kind: 'local_host' as const, management_capability: 'managed_local_host' as const,
      capabilities: [], status: 'online' as const, trust_state: 'paired' as const, listener_running: true,
      created_at_ms: 1, updated_at_ms: 1, environments: [],
      member_endpoints: [{ endpoint_id: 'local', address: 'https://127.0.0.1:7443', scope: 'lan' as const, priority: 0 }],
    };
    const snapshot = { ...fixture.snapshot, gateway_sources: [gateway],
      environments: fixture.snapshot.environments.map(entry => entry.id === runtime.id ? runtime : entry),
    };
    const perform = vi.fn(async () => ({ ok: true, gateway_membership: { joined: false, phase: 'not_joined' } }));
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    const harness = await mount(snapshot);
    const owner = document.querySelector<HTMLElement>(`[data-owner-id="${runtime.id}"]`)!;
    button(owner, 'Actions').click(); await settle();
    button(document.querySelector('[role="menu"]')!, 'Add Gateway access').click(); await settle();
    const dialog = document.querySelector('[role="dialog"]')!;
    button(dialog, 'Connect and continue').click(); await settle();
    const inputs = [...dialog.querySelectorAll<HTMLInputElement>('input')];
    const expected = method === 'typed' ? 'https://typed.example:7443' : gateway.member_endpoints[0].address;
    if (method === 'local suggestion') dialog.querySelector<HTMLButtonElement>('[data-gateway-suggestion]')!.click();
    else { inputs[0].value = expected; inputs[0].dispatchEvent(new Event('input', { bubbles: true })); }
    inputs[1].value = 'draft-code'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].focus();
    for (let index = 1; index <= 3; index++) {
      harness.publish({ ...structuredClone(snapshot), snapshot_revision: index }); await settle();
    }
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog.querySelector('input')).toBe(inputs[0]);
    expect(inputs.map(input => input.value)).toEqual([expected, 'draft-code']);
    expect(document.activeElement).toBe(inputs[1]);
    expect(perform).toHaveBeenCalledOnce();expect(harness.performAction).not.toHaveBeenCalled();
  });

  it('renders trusted snapshot connections in one stable card and confirms the selected Gateway from its upward menu', async () => {
    const fixture = runtimeConnectionFixture({ cloudManagement: false, gatewayWindow: true,
      cloudDirectoryAccessPointOrigin: 'https://rotated-region.example.invalid' });
    const snapshot = fixture.snapshot;
    const runtime = snapshot.environments.find(entry => entry.kind === 'local_environment')!;
    const perform = vi.fn(async (_request: DesktopLauncherActionRequest) => ({ ok: true, gateway_membership: {
      joined: true, phase: 'joined', memberships: fixture.memberships.map(member => ({ ...member, joined: true })),
    } }));
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    const h = await mount(snapshot);
    const card = document.querySelector(`[data-environment-group="${runtime.id}"]`)!;
    expect(document.querySelectorAll('[data-environment-group]')).toHaveLength(8);
    const tabs = [...card.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(3);
    expect(tabs.map(tab => tab.textContent?.trim())).toEqual(['Local', 'Cloud', 'Gateway']);
    expect(tabs[1].querySelector('[role="img"]')?.getAttribute('aria-label')).toContain('Redeven Cloud');
    expect(tabs.every(tab => tab.querySelector('.redeven-owner-tab-icon > svg'))).toBe(true);
    for (const tab of tabs) {
      tab.click(); await settle();
      const visible = [...card.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find(panel => panel.getAttribute('aria-hidden') !== 'true')!;
      expect(visible.querySelector('.redeven-environment-owner-heading')?.textContent).toContain(runtime.label);
    }
    const panel = card.querySelector('[aria-label="Gateway"][role="tabpanel"]')!;
    const select = panel.querySelector<HTMLSelectElement>('select')!;
    expect(select.value).toBe('service-0');
    button(panel, 'Show Env App').click(); await settle();
    expect(h.performAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'focus_environment_window', session_key: fixture.inputs.openSessions[0]!.session_key }));
    select.value = 'service-1'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(panel.textContent).toContain('https://lab.internal:7443');
    h.publish(buildDesktopWelcomeSnapshot({ ...fixture.inputs, openSessions: [] })); await settle();
    expect(document.querySelector(`[data-environment-group="${runtime.id}"]`)).toBe(card);
    expect(panel.querySelector('select')).toBe(select);
    expect(select.value).toBe('service-1');
    h.publish(buildDesktopWelcomeSnapshot({ ...fixture.inputs, openSessions: [], gatewaySources: [] })); await settle();
    expect(button(panel, 'Open Env App').disabled).toBe(true);
    expect(panel.querySelector<HTMLButtonElement>('.redeven-environment-card__flower-button')?.disabled).toBe(true);
    expect(select.value).toBe('service-1');
    button(panel, 'Actions').click(); await settle();
    const menu = document.querySelector('[role="menu"]')!;
    button(menu, 'Cancel Gateway pairing…').click(); await settle();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('select')).toBeNull();
    expect(dialog.textContent).toContain('Lab');
    expect(dialog.textContent).toContain('Redeven Cloud');
    expect(perform).toHaveBeenCalledOnce();
    button(dialog, 'Cancel pairing').click(); await settle();
    expect(perform.mock.calls.at(-1)?.[0]).toMatchObject({ operation: 'leave', gateway_id: 'service-1', cloud_impact_acknowledged: true });
    const remainingMemberships = [fixture.memberships[0]!];
    const remainingInputs = {
      ...fixture.inputs,
      managedRuntimePresenceByTargetID: Object.fromEntries(Object.entries(fixture.inputs.managedRuntimePresenceByTargetID).map(([targetID, presence]) => {
        if (presence.runtime_service?.bindings?.cloud_link?.state !== 'linked') return [targetID, presence];
        return [targetID, { ...presence, runtime_service: { ...presence.runtime_service, gateway_memberships: remainingMemberships } }];
      })),
      gatewaySources: fixture.gatewaySources.slice(0, 1),
    };
    h.publish(buildDesktopWelcomeSnapshot(remainingInputs)); await settle();
    expect(panel.querySelector('select')).toBeNull();
    expect(panel.textContent).toContain('Office');
    expect(panel.textContent).not.toContain('Lab');
    h.publish(buildDesktopWelcomeSnapshot(fixture.inputs)); await settle();
    expect(panel.querySelector<HTMLSelectElement>('select')?.value).toBe('service-0');
  });

  it.each(['connected', 'authorization_required', 'unlinked'] as const)(
    'groups Gateway access with the %s Cloud actions after Runtime operations',
    async connectionState => {
      const fixture = mixedEnvironmentFixture({ linkState: connectionState === 'unlinked' ? 'unbound' : 'linked' });
      const original = fixture.snapshot.environments.find(entry => entry.kind === 'local_environment')!;
      const runtime = { ...original,
        runtime_service: { ...original.runtime_service!, capabilities: { ...original.runtime_service!.capabilities!,
          runtime_gateway: { supported: true },
        } },
        provider_runtime_link_target: { ...original.provider_runtime_link_target!,
          provider_connection_state: connectionState, can_connect_cloud: true, can_disconnect_cloud: true,
        },
      };
      const harness = await mount({ ...fixture.snapshot,
        environments: fixture.snapshot.environments.map(entry => entry.id === runtime.id ? runtime : entry),
      });
      const owner = document.querySelector<HTMLElement>(`[data-owner-id="${runtime.id}"]`)!;
      button(owner, 'Actions').click(); await settle();
      const menu = document.querySelector('[role="menu"]')!;
      const items = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      const gatewayIndex = items.findIndex(item => item.textContent?.trim() === 'Add Gateway access');
      const cloudLabel = connectionState === 'connected' ? 'Disconnect'
        : connectionState === 'unlinked' ? 'Connect...' : 'Restore Redeven Cloud connection';
      const cloudIndex = items.findIndex(item => item.textContent?.trim() === cloudLabel);
      expect(gatewayIndex).toBeGreaterThan(0);
      expect(cloudIndex).toBe(gatewayIndex + 1);
      expect(items[gatewayIndex - 1].textContent).toContain('Uninstall');
      expect(items[gatewayIndex].previousElementSibling?.getAttribute('role')).toBe('separator');
      expect(items[cloudIndex].previousElementSibling).toBe(items[gatewayIndex]);
      expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);
      expect(harness.performAction).not.toHaveBeenCalled();
      const withoutGateway = { ...runtime, runtime_service: { ...runtime.runtime_service,
        capabilities: { ...runtime.runtime_service.capabilities, runtime_gateway: { supported: false } },
      } };
      harness.publish({ ...fixture.snapshot,
        environments: fixture.snapshot.environments.map(entry => entry.id === runtime.id ? withoutGateway : entry),
      });
      await settle();
      expect([...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent?.trim()))
        .toEqual(items.map(item => item.textContent?.trim()));
      expect(document.querySelectorAll('[role="menu"] [role="separator"]')).toHaveLength(1);
    },
  );

  it('explains an expired Cloud connection on either tab and routes recovery to the exact Runtime owner', async () => {
    const f = linkedEnvironmentFixture();
    const runtime = { ...f.runtime, provider_runtime_link_target: { ...f.runtime.provider_runtime_link_target!,
      provider_connection_state: 'authorization_required' as const, can_connect_cloud: true,
      credential_recovery: 'waiting_for_service' as const,
      cloud_link_binding: { state: 'linked' as const, connection_state: 'authorization_required' as const,
        remote_enabled: true, last_error_code: 'CONTROL_CREDENTIALS_EXPIRED' },
    } };
    const cloud = { ...f.cloud, remote_route_state: 'offline' as const };
    const h = await mount({ ...f.snapshot, environments: [runtime, cloud] });
    await h.select('cloud');
    const status = h.owner('cloud').querySelector('[data-cloud-connection-status]')!;
    expect(status).not.toBeNull();
    expect(status.textContent).toContain('Waiting');
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
    button(status, 'Connection details: Waiting for Redeven Cloud').click(); await settle();
    const details = document.querySelector('[data-cloud-connection-details]')!;
    expect(details.textContent).toContain('Available on this device');
    button(details, 'Open locally').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'open_local_environment', environment_id: runtime.id }));
    await h.select('runtime');
    expect(h.owner('runtime').querySelector('[data-cloud-connection-status]')).toBeNull();
    await h.select('cloud');
    button(h.owner('cloud').querySelector('[data-cloud-connection-status]')!, 'Restore').click(); await settle();
    // No Cloud card acquires management authority: the existing Runtime review owns the action.
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(runtime.label);
    expect(h.performAction.mock.calls.some(([request]) => request.kind === 'connect_cloud_runtime')).toBe(false);
  });
  it('uses one visible owner and owner tabs instead of stacked action surfaces', async () => {
    await mount();
    const card = document.querySelector('[data-environment-group]')!;
    expect(card.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect([...card.querySelectorAll('[data-owner-id]')].filter(el => !el.closest('[hidden], [aria-hidden="true"]'))).toHaveLength(1);
  });
  it('switches one card between owner actions, settings and independently scoped pins', async () => {
    const h = await mount();
    expect(document.querySelectorAll('[data-environment-group]')).toHaveLength(1);
    expect(h.owner('runtime').textContent).toContain('Development runtime');
    expect(h.owner('cloud').textContent).toContain('env_linked');
    expect(document.querySelectorAll('.redeven-card-cloud-affiliation')).toHaveLength(0);
    await h.select('runtime');
    button(h.owner('runtime'), 'Open Env App').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'open_local_environment', environment_id: h.runtime.id }));
    await h.select('cloud');
    button(h.owner('cloud'), 'Open via Redeven Cloud').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith({ kind: 'open_provider_environment', environment_id: h.cloud.id, route: 'remote_desktop' });
    await h.select('cloud');
    button(h.owner('cloud'), 'Pin Cloud workspace · Redeven Cloud').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'set_provider_environment_pinned', environment_id: h.cloud.id, pinned: true }));
    await h.select('runtime');
    button(h.owner('runtime'), 'Pin Development runtime · Runtime').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'set_environment_registration_pinned', pinned: true }));
    await h.select('cloud');
    button(h.owner('cloud'), 'Settings for Cloud workspace · Redeven Cloud').click(); await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('managed by Redeven Cloud');
    expect(h.settings.load).not.toHaveBeenCalled();
    expect(button(h.owner('cloud'), 'Ask Flower about Cloud workspace · Redeven Cloud')).toBeTruthy();
    expect(button(h.owner('runtime'), 'Ask Flower about Development runtime · Runtime')).toBeTruthy();
  });
  it.each(['offline', 'auth_required', 'provider_unreachable'] as const)('keeps Runtime open independent of Cloud %s', async state => {
    const h = await mount();
    h.publish({ ...h.snapshot, environments: [h.runtime, { ...h.cloud, remote_route_state: state, control_plane_sync_state: state === 'auth_required' ? state : 'ready' }] }); await settle();
    const open = button(h.owner('runtime'), 'Open Env App');
    expect(open.disabled).toBe(false); open.click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'open_local_environment', environment_id: h.runtime.id }));
    await h.select('cloud');
    button(h.owner('cloud'), 'Open via Redeven Cloud').click(); await settle();
    if (state === 'auth_required') {
      button(document, 'Request access').click(); await settle();
      expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'start_control_plane_connect', cloud_origin: h.cloud.cloud_origin }));
    } else {
      expect(document.body.textContent).toContain(state === 'offline' ? 'Redeven Cloud reports offline' : 'Redeven Cloud is unreachable');
    }
  });
  it.each(['runtime', 'cloud'] as const)('sends the selected %s owner context to Flower', async role => {
    const h = await mount();
    const entry = role === 'runtime' ? h.runtime : h.cloud;
    await h.select(role);
    h.owner(role).querySelector<HTMLButtonElement>('.redeven-environment-card__flower-button')!.click();
    await settle();
    const launcher = document.querySelector('.flower-turn-launcher-window')!;
    expect(launcher.textContent).toContain(entry.label);
    const input = launcher.querySelector('textarea')!;
    input.value = 'Inspect this environment';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    launcher.querySelector<HTMLButtonElement>('[data-testid="flower-turn-launcher-inline-send"]')!.click();
    await settle();
    expect(launchLocalEnvironmentFlowerTurn).toHaveBeenLastCalledWith(h.settings, expect.objectContaining({
      prompt: 'Inspect this environment',
      context_action: expect.objectContaining({
        source: expect.objectContaining({ surface_id: entry.id }),
        execution_context: expect.objectContaining({ session_source: role === 'runtime' ? 'local_runtime' : 'provider_environment' }),
      }),
    }));
  });
  it('removes only the selected Runtime registration and retains the Cloud entry', async () => {
    const h = await mount();
    const registration = { kind: 'runtime_target' as const, id: 'ssh:fixture' as const };
    h.publish({ ...h.snapshot, environments: [
      { ...h.runtime, kind: 'ssh_environment', registration_ref: registration, can_delete: true }, h.cloud,
    ] });
    await settle();
    await h.select('runtime');
    button(h.owner('runtime'), 'Remove Development runtime · Runtime').click();
    await settle();
    button(document.querySelector('[role="dialog"]')!, 'Remove').click();
    await settle();
    expect(h.performAction).toHaveBeenLastCalledWith({ kind: 'delete_environment_registration', registration_ref: registration });
    h.publish({ ...h.snapshot, environments: [h.cloud] }); await settle();
    expect(document.querySelectorAll('[data-environment-group]')).toHaveLength(1);
    expect(document.querySelector('[data-owner-role="cloud"]')?.getAttribute('data-owner-id')).toBe(h.cloud.id);
  });
  it('preserves Cloud endpoints, QR, focus and disclosure across fresh snapshots and searches', async () => {
    const h = await mount();
    const card = document.querySelector('[data-environment-group]');
    await h.select('cloud');
    button(h.owner('cloud'), 'View connection details').click(); await settle();
    button(document, 'Share connection').click(); await settle();
    const panel = document.querySelector('.redeven-endpoints-popover');
    const qr = panel?.querySelector('img');
    const copy = button(panel!, 'Copy Environment URL'); copy.focus();
    h.publish(structuredClone(h.snapshot)); await settle();
    expect(document.querySelector('[data-environment-group]')).toBe(card);
    expect(document.querySelector('.redeven-endpoints-popover')).toBe(panel);
    expect(panel?.querySelector('img')).toBe(qr); expect(document.activeElement).toBe(copy);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await new Promise(resolve => setTimeout(resolve, 200));
    const search = document.querySelector<HTMLInputElement>('input[placeholder="Search environments..."]')!;
    search.value = 'Cloud workspace'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(document.querySelector('[data-environment-group]')).toBe(card);
    expect(h.owner('cloud').closest('[aria-hidden="true"]')).toBeNull();
  });
  it('keeps Cloud open progress off the Runtime action and separates the card after unlink', async () => {
    const h = await mount();
    const progress: DesktopLauncherActionProgress = {
      action: 'open_provider_environment', environment_id: h.cloud.id, status: 'running', phase: 'opening_window', detail: 'Opening',
      operation_key: 'cloud-open', started_at_unix_ms: 1, title: 'Opening Cloud workspace',
      open_progress: openConnectionProgress({ location: 'provider_remote', phase: 'opening_window', environmentID: h.cloud.id, environmentLabel: h.cloud.label }),
    };
    h.publish({ ...h.snapshot, action_progress: [progress] }); await settle();
    expect(button(h.owner('runtime'), 'Open Env App').disabled).toBe(false);
    expect(h.owner('cloud').querySelector('[data-floe-progress-shimmer]')).not.toBeNull();
    h.publish({ ...h.snapshot, environments: [
      { ...h.runtime, provider_runtime_link_target: { ...h.runtime.provider_runtime_link_target!, cloud_link_state: 'unbound' } },
      { ...h.cloud, cloud_linked_runtime_summary: undefined, access_group_id: h.cloud.id },
    ] }); await settle();
    expect(document.querySelectorAll('[data-environment-group]')).toHaveLength(2);
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });
});

const visibleCards = () => [...document.querySelectorAll<HTMLElement>('[data-environment-group]')].filter(el => !el.closest('[hidden]'));
const activeOwner = (card: Element) => [...card.querySelectorAll<HTMLElement>('[data-owner-id]')].find(el => !el.closest('[aria-hidden="true"]'))!;
const selectTab = async (card: Element, index: number) => { card.querySelectorAll<HTMLElement>('[role="tab"]')[index].click(); await settle(); };
const searchFor = async (value: string) => {
  const search = document.querySelector<HTMLInputElement>('.redeven-header-separator input')!;
  search.value = value; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
};

describe('shared overview and Cloud source grids', () => {
  it('keeps source search and snapshot updates from resetting a manually chosen perspective', async () => {
    const { snapshot } = mixedEnvironmentFixture();
    const h = await mount(snapshot);
    expect(visibleCards()).toHaveLength(8);
    button(document, 'Redeven Cloud').click(); await settle();
    expect(visibleCards()).toHaveLength(6);
    const pair = visibleCards().find(card => card.querySelector('[role="tablist"]'))!;
    expect(activeOwner(pair).dataset.ownerRole).toBe('cloud');
    await selectTab(pair, 0);
    await searchFor('Team Cloud'); expect(visibleCards()).toHaveLength(3);
    expect(activeOwner(pair).dataset.ownerRole).toBe('runtime');
    await searchFor('env_0_0'); expect(visibleCards()).toHaveLength(1);
    expect(visibleCards()[0]).toBe(pair);
    h.publish(structuredClone(snapshot)); await settle();
    expect(visibleCards()[0]).toBe(pair);
    await searchFor('no match'); expect(visibleCards()).toHaveLength(0);
    await searchFor(''); expect(visibleCards()).toHaveLength(6);
    expect(activeOwner(visibleCards().find(card => card.querySelector('[role="tablist"]'))!).dataset.ownerRole).toBe('runtime');
  });
  it('opens a source directly from a Cloud fact and keeps pure remote owners isolated', async () => {
    const { snapshot } = mixedEnvironmentFixture();
    const h = await mount(snapshot);
    const cloud = snapshot.environments.find(entry => entry.env_public_id === 'env_1_1')!;
    const card = visibleCards().find(card => card.dataset.environmentGroup === cloud.id)!;
    expect(card.querySelector('[role="tablist"]')).toBeNull();
    expect(card.textContent).not.toContain('No managed runtime linked');
    expect(card.querySelector('.redeven-card-runtime-age')).toBeNull();
    button(card, 'Open via Redeven Cloud').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith({ kind: 'open_provider_environment', environment_id: cloud.id, route: 'remote_desktop' });
    button(card, 'Show Personal Cloud').click(); await settle();
    expect(document.querySelectorAll('[data-cloud-source]')).toHaveLength(2);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
    expect(document.querySelector('[data-cloud-stat="linked"] dd')?.textContent).toBe('1');
  });
  it('explains an inactive owner pin and keeps owner pin requests independent', async () => {
    const h = await mount();
    h.publish({ ...h.snapshot, environments: [h.runtime, { ...h.cloud, pinned: true }] }); await settle();
    expect(visibleCards()).toHaveLength(1);
    expect(h.owner('runtime').textContent).toContain('Pinned through Redeven Cloud');
    await h.select('cloud');
    button(h.owner('cloud'), 'Unpin Cloud workspace · Redeven Cloud').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'set_provider_environment_pinned', environment_id: h.cloud.id, pinned: false }));
  });
  it('retains known cards on failed sync and cleans a removed source', async () => {
    const { snapshot } = mixedEnvironmentFixture();
    const h = await mount(snapshot);
    button(document, 'Redeven Cloud').click(); await settle();
    h.publish(mixedEnvironmentFixture({ syncState: 'provider_unreachable' }).snapshot); await settle();
    expect(visibleCards()).toHaveLength(6);
    expect(document.body.textContent).toContain('Showing last synced results');
    h.publish({ ...snapshot, control_planes: snapshot.control_planes.slice(1), environments: snapshot.environments.filter(entry => entry.cloud_origin !== snapshot.control_planes[0].cloud.cloud_origin) }); await settle();
    expect(document.querySelectorAll('[data-cloud-source]')).toHaveLength(1);
    expect(visibleCards()).toHaveLength(3);
  });
  it('distinguishes an empty source, an unsynced source and no connected sources', async () => {
    const { snapshot } = mixedEnvironmentFixture();
    const source = { ...snapshot.control_planes[0], environments: [] };
    const h = await mount({ ...snapshot, control_planes: [source], environments: [] });
    button(document, 'Redeven Cloud').click(); await settle();
    expect(document.body.textContent).toContain('This account has no environments yet.');
    h.publish({ ...snapshot, environments: [], control_planes: [{ ...source, sync_state: 'provider_unreachable' }] }); await settle();
    expect(document.body.textContent).toContain('Environments will appear after a successful sync.');
    h.publish({ ...snapshot, environments: [], control_planes: [] }); await settle();
    expect(document.body.textContent).toContain('Authorize this Desktop with Redeven Cloud.');
  });
});

describe('Redeven Cloud account overview', () => {
  it('offers account sign-out rather than provider deletion and sends the exact account identity', async () => {
    const { snapshot } = mixedEnvironmentFixture();
    const h = await mount(snapshot);
    button(document, 'Redeven Cloud').click(); await settle();
    const account = document.querySelector('.redeven-cloud-source-header')!;
    expect(account.textContent).not.toContain('Reconnect');
    expect(account.querySelectorAll('dl > div')).toHaveLength(3);
    button(account, 'Sign out of Team account on this Desktop').click(); await settle();
    const confirmation = document.querySelector('[role="dialog"]')!;
    expect(confirmation.textContent).toContain('Cloud environments, runtimes and their links are kept.');
    button(confirmation, 'Sign out').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith({ kind: 'sign_out_control_plane',
      cloud_origin: snapshot.control_planes[0].cloud.cloud_origin,
      cloud_id: snapshot.control_planes[0].cloud.cloud_id });
  });
  it('cancels sign-out without a request and closes a confirmation when its account disappears', async () => {
    const { snapshot } = mixedEnvironmentFixture();
    const h = await mount(snapshot);
    button(document, 'Redeven Cloud').click(); await settle();
    const account = document.querySelector('.redeven-cloud-source-header')!;
    button(account, 'Sign out of Team account on this Desktop').click(); await settle();
    button(document.querySelector('[role="dialog"]')!, 'Cancel').click(); await settle();
    expect(h.performAction).not.toHaveBeenCalled();
    button(account, 'Sign out of Team account on this Desktop').click(); await settle();
    h.publish({ ...snapshot, control_planes: snapshot.control_planes.slice(1) }); await settle();
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull();
  });
  it('does not claim authorization or prior sync results before its first catalog', async () => {
    const { snapshot } = mixedEnvironmentFixture();
    await mount({ ...snapshot, control_planes: snapshot.control_planes.map(source => ({ ...source, sync_state: 'idle', catalog_freshness: 'unknown', last_synced_at_ms: 0 })) });
    button(document, 'Redeven Cloud').click(); await settle();
    const account = document.querySelector('.redeven-cloud-source-header')!;
    expect(account.textContent).toContain('Not synced yet');
    expect(account.textContent).not.toContain('Authorized');
    expect(account.textContent).not.toContain('Showing last synced results');
    expect(account.querySelector('.redeven-cloud-account-sync-time')).toBeNull();
  });
  it('keeps network diagnostics out of the overview and selects the appropriate recovery action', async () => {
    const { snapshot } = mixedEnvironmentFixture({ syncState: 'provider_unreachable' });
    const h = await mount({ ...snapshot, control_planes: snapshot.control_planes.map(source => ({ ...source, last_sync_error_message: 'Desktop failed to talk to the provider.' })) });
    button(document, 'Redeven Cloud').click(); await settle();
    const account = document.querySelector('.redeven-cloud-source-header')!;
    expect(account.textContent).not.toContain('Desktop failed to talk to the provider.');
    expect(button(account, 'Refresh')).toBeTruthy();
    button(account, 'Sync details').click(); await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Desktop failed to talk to the provider.');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
    h.publish(mixedEnvironmentFixture({ syncState: 'auth_required' }).snapshot); await settle();
    button(account, 'Sign in again').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'start_control_plane_connect', cloud_origin: snapshot.control_planes[0].cloud.cloud_origin }));
  });
});

describe('perspective ownership across navigation and removal', () => {
  it('applies filter defaults once and then permits either owner', async () => {
    const h = await mount();
    const filter = [...document.querySelectorAll<HTMLButtonElement>('.redeven-provider-pill')].find(el => el.textContent?.includes('Redeven Cloud'))!;
    filter.click(); await settle();
    expect(activeOwner(visibleCards()[0]).dataset.ownerRole).toBe('cloud');
    await h.select('runtime');
    h.publish(structuredClone(h.snapshot)); await settle();
    expect(activeOwner(visibleCards()[0]).dataset.ownerRole).toBe('runtime');
    const local = [...document.querySelectorAll<HTMLButtonElement>('.redeven-provider-pill')].find(el => el.textContent?.includes('Local'))!;
    local.click(); await settle();
    expect(activeOwner(visibleCards()[0]).dataset.ownerRole).toBe('runtime');
    await h.select('cloud');
    expect(activeOwner(visibleCards()[0]).dataset.ownerRole).toBe('cloud');
  });
  it('keeps opened settings on their original owner and closes them when that owner disappears', async () => {
    const h = await mount();
    await h.select('cloud');
    button(h.owner('cloud'), 'Settings for Cloud workspace · Redeven Cloud').click(); await settle();
    await h.select('runtime');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Cloud workspace');
    expect(h.settings.load).not.toHaveBeenCalled();
    h.publish({ ...h.snapshot, environments: [h.runtime] }); await settle();
    expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull();
  });
  it('keeps Flower context on its original owner and closes it when that owner disappears', async () => {
    const h = await mount();
    await h.select('cloud');
    h.owner('cloud').querySelector<HTMLButtonElement>('.redeven-environment-card__flower-button')!.click(); await settle();
    await h.select('runtime');
    expect(document.querySelector('.flower-turn-launcher-window')?.textContent).toContain('Cloud workspace');
    h.publish({ ...h.snapshot, environments: [h.runtime] }); await new Promise(resolve => setTimeout(resolve, 300));
    expect(document.querySelector('.flower-turn-launcher-window')).toBeNull();
  });
});
