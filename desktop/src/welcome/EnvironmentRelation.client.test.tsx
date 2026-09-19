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
  const found = [...root.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.trim() === text || el.getAttribute('aria-label') === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
async function mount() {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key), clear: () => storage.clear() });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const fixture = linkedEnvironmentFixture();
  let snapshot: DesktopWelcomeSnapshot = fixture.snapshot;
  let receive: ((value: DesktopWelcomeSnapshot) => void) | undefined;
  const performAction = vi.fn(async (_request: DesktopLauncherActionRequest) => ({ ok: true as const, outcome: 'opened_environment_window' as const }));
  const settings = { load: vi.fn(), save: vi.fn(), cancel: vi.fn(), requestRuntimeFlower: vi.fn() } as unknown as DesktopWelcomeRuntime['settings'];
  const host = document.createElement('div'); document.body.append(host);
  disposers.push(render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{ settings, launcher: {
    getSnapshot: async () => snapshot, performAction, subscribeSnapshot: listener => { receive = listener; return () => {}; },
  } }} />, host));
  await settle();
  const owner = (role: string) => document.querySelector<HTMLElement>(`[data-owner-role="${role}"]`)!;
  return { ...fixture, owner, settings, performAction, publish: (value: DesktopWelcomeSnapshot) => { snapshot = value; receive?.(value); } };
}
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('linked environment owner interactions', () => {
  it('renders one card with two owner actions, settings and independently scoped pins', async () => {
    const h = await mount();
    expect(document.querySelectorAll('[data-environment-group]')).toHaveLength(1);
    expect(h.owner('runtime').textContent).toContain('Development runtime');
    expect(h.owner('cloud').textContent).toContain('env_linked');
    expect(document.querySelectorAll('.redeven-card-cloud-affiliation')).toHaveLength(0);
    button(h.owner('runtime'), 'Open Env App').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'open_local_environment', environment_id: h.runtime.id }));
    button(h.owner('cloud'), 'Open remote Env App').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith({ kind: 'open_provider_environment', environment_id: h.cloud.id, route: 'remote_desktop' });
    button(h.owner('cloud'), 'Pin Cloud workspace · Redeven Cloud').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'set_provider_environment_pinned', environment_id: h.cloud.id, pinned: true }));
    button(h.owner('runtime'), 'Pin Development runtime · Runtime').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'set_environment_registration_pinned', pinned: true }));
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
    button(h.owner('cloud'), 'Open remote Env App').click(); await settle();
    if (state === 'auth_required') {
      button(document, 'Request access').click(); await settle();
      expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'start_control_plane_connect', provider_origin: h.cloud.provider_origin }));
    } else {
      expect(document.body.textContent).toContain(state === 'offline' ? 'Redeven Cloud reports offline' : 'Redeven Cloud is unreachable');
    }
  });
  it.each(['runtime', 'cloud'] as const)('sends the selected %s owner context to Flower', async role => {
    const h = await mount();
    const entry = role === 'runtime' ? h.runtime : h.cloud;
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
    button(h.owner('runtime'), 'Remove Development runtime · Runtime').click();
    await settle();
    button(document.querySelector('[role="dialog"]')!, 'Remove').click();
    await settle();
    expect(h.performAction).toHaveBeenLastCalledWith({ kind: 'delete_environment_registration', registration_ref: registration });
    h.publish({ ...h.snapshot, environments: [h.cloud] }); await settle();
    expect(document.querySelectorAll('[data-environment-group]')).toHaveLength(1);
    expect(document.querySelector('[data-owner-role="standalone"]')?.getAttribute('data-owner-id')).toBe(h.cloud.id);
  });
  it('preserves Cloud endpoints, QR, focus and disclosure across fresh snapshots and searches', async () => {
    const h = await mount();
    const card = document.querySelector('[data-environment-group]');
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
    button(h.owner('cloud'), 'Hide connection details').click(); await settle();
    const search = document.querySelector<HTMLInputElement>('input[placeholder="Search environments..."]')!;
    search.value = 'Cloud workspace'; search.dispatchEvent(new Event('input', { bubbles: true })); await settle();
    expect(document.querySelector('[data-environment-group]')).toBe(card);
    expect(button(h.owner('cloud'), 'Connection details').getAttribute('aria-expanded')).toBe('false');
    expect(h.owner('cloud').dataset.highlighted).toBe('true');
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
      { ...h.runtime, provider_runtime_link_target: { ...h.runtime.provider_runtime_link_target!, provider_link_state: 'unbound' } },
      { ...h.cloud, provider_linked_runtime_summary: undefined },
    ] }); await settle();
    expect(document.querySelectorAll('[data-environment-group]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-owner-role="standalone"]')).toHaveLength(2);
  });
});
