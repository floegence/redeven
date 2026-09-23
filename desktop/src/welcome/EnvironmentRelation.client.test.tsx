import { mixedEnvironmentFixture } from '../testSupport/mixedEnvironmentFixture';
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
      expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'start_control_plane_connect', provider_origin: h.cloud.provider_origin }));
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
      { ...h.runtime, provider_runtime_link_target: { ...h.runtime.provider_runtime_link_target!, provider_link_state: 'unbound' } },
      { ...h.cloud, provider_linked_runtime_summary: undefined },
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
    h.publish({ ...snapshot, control_planes: snapshot.control_planes.slice(1), environments: snapshot.environments.filter(entry => entry.provider_origin !== snapshot.control_planes[0].provider.provider_origin) }); await settle();
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
      provider_origin: snapshot.control_planes[0].provider.provider_origin,
      provider_id: snapshot.control_planes[0].provider.provider_id });
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
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'start_control_plane_connect', provider_origin: snapshot.control_planes[0].provider.provider_origin }));
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
