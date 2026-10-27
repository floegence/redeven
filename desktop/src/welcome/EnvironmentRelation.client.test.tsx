import { runtimeConnectionFixture } from '../testSupport/runtimeConnectionFixture';
import { runtimeGatewayAccessFixture } from '../testSupport/runtimeGatewayAccessFixture';
import { runtimeGatewayBackgroundProbeFixture } from '../testSupport/runtimeGatewayBackgroundProbeFixture';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { mixedEnvironmentFixture } from '../testSupport/mixedEnvironmentFixture';
import { controlText } from '../testSupport/controlText';
import { createDesktopI18n } from '../shared/i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from './App';
import { linkedEnvironmentFixture } from '../testSupport/linkedEnvironmentFixture';
import type { DesktopWelcomeSnapshot, DesktopLauncherActionRequest, DesktopLauncherActionResult, DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import { openConnectionProgress } from '../shared/desktopOpenConnectionProgress';
import { runtimeLifecycleProgress } from '../shared/desktopRuntimeLifecycleProgress';
import { launchLocalEnvironmentFlowerTurn } from './flower/localEnvironmentFlowerSurfaceAdapter';
import type { FlowerTurnLaunchInput } from '../../../internal/flower_ui/src/contracts/flowerSurfaceContracts';
import type { EnvironmentFlowerContextActionEnvelope } from './environmentFlowerContext';

vi.mock('./flower/localEnvironmentFlowerSurfaceAdapter', async importOriginal => ({
  ...await importOriginal<typeof import('./flower/localEnvironmentFlowerSurfaceAdapter')>(),
  prepareLocalEnvironmentFlowerTurnInput: vi.fn(async (_bridge: unknown, input: FlowerTurnLaunchInput) => structuredClone(input)),
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
  const performAction = vi.fn(async (_request: DesktopLauncherActionRequest): Promise<DesktopLauncherActionResult> => ({ ok: true, outcome: 'opened_environment_window' }));
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
afterEach(() => { for (const dispose of disposers.splice(0)) dispose(); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); Reflect.deleteProperty(HTMLElement.prototype, 'animate'); });

it.each(['local', 'ssh', 'wsl', 'local_container', 'ssh_container'] as const)('keeps all %s enrollment steps and controls stable through the production background observer', async kind => {
  const f = await runtimeGatewayBackgroundProbeFixture(kind);
  const h = await mount(f.snapshot());
  const perform = vi.fn(async (request: DesktopLauncherActionRequest) => request.kind === 'manage_runtime_gateway' && request.operation === 'preview'
    ? { ok: true, gateway_preview: { preview_id: 'a'.repeat(43), purpose: 'join', gateway_id: 'office', gateway_name: 'Office', target_runtime_id: 'runtime', expires_at_unix_ms: Date.now() + 300000 } }
    : { ok: true, gateway_membership: { joined: false, phase: 'not_joined' } });
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const card = document.querySelector(`[data-environment-group="${f.environment.id}"]`)!;
  button(card, 'Actions').click(); await settle();
  button(document.querySelector('[role="menu"]')!, 'Add Gateway access').click(); await settle();
  const dialog = document.querySelector('[role="dialog"]')!;
  for (const stage of [0, 1, 2]) {
    if (stage === 1) {
      button(dialog, 'Connect and continue').click(); await settle();
      const inputs = dialog.querySelectorAll<HTMLInputElement>('input');
      for (const [index, value] of ['https://office.example:7443', 'retained-code'].entries()) {
        inputs[index].value = value; inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    if (stage === 2) { button(dialog, 'Verify').click(); await settle(); }
    const action = button(dialog, ['Connect and continue', 'Verify', 'Confirm and enable'][stage]);
    const focus = stage === 1 ? dialog.querySelector<HTMLInputElement>('input')! : action;
    focus.focus(); if (focus instanceof HTMLInputElement) focus.setSelectionRange(1, 3);
    const scroll = dialog.querySelector<HTMLElement>('.redeven-gateway-join-scroll')!;
    scroll.scrollTop = 36;
    const calls = perform.mock.calls.length;
    for (let cycle = 0; cycle < 3; cycle++) {
      const check = f.beginProbe(); h.publish(check.checking); await settle();
      expect(dialog.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe(String(stage));
      expect(button(dialog, ['Connect and continue', 'Verify', 'Confirm and enable'][stage])).toBe(action);
      expect(document.activeElement).toBe(focus); expect(scroll.scrollTop).toBe(36);
      expect(dialog.querySelector('[data-gateway-preparation]')).toBeNull();
      h.publish(await check.finish()); await settle();
      expect(document.activeElement).toBe(focus);
      if (focus instanceof HTMLInputElement) expect([focus.selectionStart, focus.selectionEnd]).toEqual([1, 3]);
    }
    expect(perform).toHaveBeenCalledTimes(calls);
  }
  expect(h.performAction).not.toHaveBeenCalled();
});

it('retains invitation focus across scheduled five-second production probes for thirty seconds', async () => {
  const f = await runtimeGatewayBackgroundProbeFixture('ssh');
  const h = await mount(f.snapshot());
  const perform = vi.fn(async () => ({ ok: true, gateway_membership: { joined: false, phase: 'not_joined' } }));
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const card = document.querySelector(`[data-environment-group="${f.environment.id}"]`)!;
  button(card, 'Actions').click(); await settle(); button(document.querySelector('[role="menu"]')!, 'Add Gateway access').click(); await settle();
  const dialog = document.querySelector('[role="dialog"]')!;
  button(dialog, 'Connect and continue').click(); await settle();
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  input.value = 'https://office.example'; input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus(); input.setSelectionRange(2, 5);
  const verify = button(dialog, 'Verify');
  vi.useFakeTimers();
  const timer = setInterval(() => {
    const pending = f.poller.poll(); h.publish(f.snapshot());
    void pending.then(() => h.publish(f.snapshot()));
  }, 5000);
  try {
    for (let cycle = 0; cycle < 6; cycle++) {
      const finish = f.holdNextProbe();
      await vi.advanceTimersByTimeAsync(5000);
      expect(f.snapshot().environments[0].runtime_health.freshness).toBe('checking');
      expect(f.snapshot().environments[0].provider_runtime_link_target?.runtime_control_status.state).not.toBe('available');
      expect(button(dialog, 'Verify')).toBe(verify); expect(document.activeElement).toBe(input);
      expect([input.selectionStart, input.selectionEnd]).toEqual([2, 5]);
      expect(dialog.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('1');
      finish(); await vi.advanceTimersByTimeAsync(0);
      expect(f.snapshot().environments[0].runtime_health.freshness).toBe('fresh');
      expect(document.activeElement).toBe(input);
    }
    expect(perform).toHaveBeenCalledOnce(); expect(h.performAction).not.toHaveBeenCalled();
  } finally { clearInterval(timer); vi.useRealTimers(); }
});

it.each([['status', false, false], ['preview', false, false], ['join', false, false], ['status', true, false], ['preview', true, false], ['join', true, false], ['join', true, true]] as const)('settles pending %s exactly once across the production observer (completed fault: %s, request failure: %s)', async (operation, completedFailure, requestFailure) => {
  const f = await runtimeGatewayBackgroundProbeFixture('ssh');
  const h = await mount(f.snapshot());
  let complete!: (value: object) => void;
  const preview = { preview_id: 'a'.repeat(43), purpose: 'join', gateway_id: 'office', gateway_name: 'Office', target_runtime_id: 'runtime', expires_at_unix_ms: Date.now() + 300000 };
  const resultFor = (operation: string) => operation === 'preview' ? { ok: true, gateway_preview: preview } : { ok: true, gateway_membership: { joined: operation === 'join', phase: operation === 'join' ? 'joined' : 'not_joined' } };
  const perform = vi.fn(async (request: DesktopLauncherActionRequest) => request.kind === 'manage_runtime_gateway'
    ? request.operation === operation ? new Promise<object>(done => { complete = done; }) : resultFor(request.operation) : { ok: false });
  vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
  const card = document.querySelector(`[data-environment-group="${f.environment.id}"]`)!;
  button(card, 'Actions').click(); await settle(); button(document.querySelector('[role="menu"]')!, 'Add Gateway access').click(); await settle();
  const dialog = document.querySelector('[role="dialog"]')!;
  button(dialog, 'Connect and continue').click(); await settle();
  if (operation !== 'status') {
    const inputs = dialog.querySelectorAll<HTMLInputElement>('input');
    for (const [index, value] of ['https://office.example:7443', 'retained-code'].entries()) {
      inputs[index].value = value; inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
    }
    button(dialog, 'Verify').click(); await settle();
    if (operation === 'join') { button(dialog, 'Confirm and enable').click(); await settle(); }
  }
  const check = f.beginProbe(); h.publish(check.checking); await settle();
  if (completedFailure) { h.publish(await check.fail()); await settle(); }
  complete(requestFailure ? { ok: false, gateway_error_code: 'RUNTIME_CONTROL_UNREACHABLE' } : resultFor(operation)); await settle();
  if (requestFailure) {
    expect(dialog.textContent).toContain('Could not connect to this environment. Retry or check its connection settings.');
    expect(dialog.querySelector('[data-gateway-enrollment-result]')?.textContent).toContain('Confirming enrollment');
    expect([...dialog.querySelectorAll('button')].some(control => controlText(control) === 'Confirm and enable')).toBe(false);
    expect(button(dialog, 'Done').disabled).toBe(true);
    h.performAction.mockImplementationOnce(async request => {
      expect(request.kind).toBe('refresh_environment_runtime');
      const recovery = f.beginProbe(); h.publish(await recovery.finish());
      return { ok: true, outcome: 'refreshed_environment_runtime' };
    });
    button(dialog, 'Retry').click(); await settle();
    await vi.waitFor(() => expect(dialog.querySelector('[data-gateway-enrollment-result]')).toBeNull());
    expect(dialog.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('1');
    expect([...dialog.querySelectorAll<HTMLInputElement>('input')].at(-1)?.value).toBe('');
  } else if (operation === 'join') expect(dialog.querySelector('[data-gateway-step]')).toBeNull();
  else expect(dialog.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe(operation === 'status' ? '1' : '2');
  if (!completedFailure) { h.publish(await check.finish()); await settle(); }
  expect(perform.mock.calls.filter(([request]) => request.kind === 'manage_runtime_gateway' && request.operation === operation)).toHaveLength(1);
});

it.each(['stopped', 'management_unavailable', 'update_required', 'failed'] as const)('keeps the confirmed step and drafts when a background probe completes as %s', async state => {
  const f = await runtimeGatewayBackgroundProbeFixture('ssh');
  const h = await mount(f.snapshot());
  vi.stubGlobal('redevenDesktopLauncher', { performAction: vi.fn(async (request: { operation: string }) => request.operation === 'preview'
    ? { ok: true, gateway_preview: { preview_id: 'a'.repeat(43), purpose: 'join', gateway_id: 'office', gateway_name: 'Office', target_runtime_id: 'runtime', expires_at_unix_ms: Date.now() + 300000 } }
    : { ok: true, gateway_membership: { joined: false, phase: 'not_joined' } }) });
  const card = document.querySelector(`[data-environment-group="${f.environment.id}"]`)!;
  button(card, 'Actions').click(); await settle(); button(document.querySelector('[role="menu"]')!, 'Add Gateway access').click(); await settle();
  const dialog = document.querySelector('[role="dialog"]')!;
  button(dialog, 'Connect and continue').click(); await settle();
  const inputs = [...dialog.querySelectorAll<HTMLInputElement>('input')];
  for (const [index, value] of ['https://office.example:7443', 'retained-code'].entries()) {
    inputs[index].value = value; inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
  }
  button(dialog, 'Verify').click(); await settle();
  const confirm = button(dialog, 'Confirm and enable');
  const check = f.beginProbe(); h.publish(check.checking); await settle();
  h.publish(state === 'failed' ? await check.fail() : await check.finish(state)); await settle();
  expect(dialog.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('2');
  expect(button(dialog, 'Confirm and enable')).toBe(confirm); expect(confirm.disabled).toBe(true);
  expect(dialog.querySelector('[data-gateway-connection-blocked]')).not.toBeNull();
  expect(inputs.map(input => input.value)).toEqual(['https://office.example:7443', 'retained-code']);
  expect(dialog.textContent).toContain('Office');
  expect(h.performAction).not.toHaveBeenCalled();
  button(dialog, 'Restore connection').click(); await settle();
  expect(dialog.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('0');
  expect(inputs.map(input => input.value)).toEqual(['https://office.example:7443', 'retained-code']);
});

describe('linked environment owner interactions', () => {
  it('retains reinstall confirmation through target loss and return but requires a fresh review', async () => {
    const fixture = runtimeGatewayAccessFixture('local', 'ready');
    const runtime = fixture.environment;
    const progress: DesktopLauncherActionProgress = { action: 'reinstall_target', environment_id: runtime.id,
      operation_key: 'reinstall-consent', started_at_unix_ms: 300, status: 'needs_confirmation', phase: 'confirmation',
      title: 'Review reinstall target', detail: 'Review the exact target',
      next_actions: [{ kind: 'reinstall_target', environment_id: runtime.id, operation_key: 'reinstall-consent', preflight_id: 'old-preview', mode: 'preserve_data', label: 'Reinstall', label_key: 'common.reinstall' }],
    };
    const snapshot = { ...fixture.snapshot, action_progress: [progress] };
    const h = await mount(snapshot);
    const owner = document.querySelector<HTMLElement>(`[data-owner-id="${runtime.id}"]`)!;
    button(owner, 'Needs attention Show details.').click(); await settle();
    const panel = document.querySelector('.redeven-environment-progress')!;
    const confirm = button(panel, 'Reinstall'); confirm.focus();
    h.publish({ ...snapshot, environments: [] }); await settle();
    expect(document.querySelector('.redeven-environment-progress')).toBe(panel);
    expect(confirm.disabled).toBe(true);
    confirm.click(); expect(h.performAction).not.toHaveBeenCalled();
    h.publish(snapshot); await settle();
    expect(confirm.disabled).toBe(true);
    expect(button(document, 'Verify current target').disabled).toBe(false);
    button(document, 'Verify current target').click(); await settle();
    expect(h.performAction).toHaveBeenCalledExactlyOnceWith({ kind: 'preview_reinstall_target', environment_id: runtime.id, mode: 'preserve_data' });
    expect(document.querySelector('.redeven-action-popover-surface')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(document.querySelector('.redeven-action-popover-surface')).toBeNull());
  });
  it('updates the OS graphic in place while retaining title selection, card and access focus', async () => {
    const fixture = runtimeConnectionFixture({ kind: 'ssh_environment' });
    const runtime = fixture.snapshot.environments.find(entry => entry.kind === 'ssh_environment')!;
    const h = await mount(fixture.snapshot);
    const card = document.querySelector(`[data-environment-group="${runtime.id}"]`)!;
    const title = card.querySelector<HTMLElement>('.redeven-environment-title')!;
    const slot = title.previousElementSibling!;
    expect(slot.hasAttribute('data-runtime-platform-slot')).toBe(true);
    const initialGraphic = slot.querySelector('img')!;
    expect(initialGraphic?.getAttribute('data-runtime-platform')).toBe('unknown');
    expect(initialGraphic?.alt).toBe('Runtime operating system unknown');
    expect(title.classList.contains('truncate')).toBe(true);
    expect(title.classList.contains('select-text')).toBe(true);
    await selectTab(card, 1);
    const tab = card.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')!;
    tab.focus();
    for (const [runtime_platform, runtime_linux_distribution, brand] of [
      ['linux', 'ubuntu', 'Ubuntu'], ['linux', 'debian', 'Debian'], ['linux', 'fedora', 'Fedora'],
      ['linux', 'unrecognized-derivative', 'Linux'], ['macos', 'ubuntu', 'macOS'],
      ['linux', undefined, 'Linux'], ['windows', undefined, 'Windows'], [undefined, undefined, undefined],
    ] as const) {
      h.publish({ ...structuredClone(fixture.snapshot), environments: fixture.snapshot.environments.map(entry =>
        entry.id === runtime.id ? { ...entry, runtime_platform, runtime_linux_distribution } : entry) });
      await settle();
      expect(document.querySelector(`[data-environment-group="${runtime.id}"]`)).toBe(card);
      expect(card.querySelector('.redeven-environment-title')).toBe(title);
      expect(title.previousElementSibling).toBe(slot);
      expect(tab.getAttribute('aria-selected')).toBe('true');
      expect(document.activeElement).toBe(tab);
      const graphic = slot.querySelector('img');
      expect(graphic).toBe(initialGraphic);
      expect(graphic?.getAttribute('src')).toMatch(/^(data:image\/svg\+xml[;,]|.*\.svg$)/);
      expect(graphic?.draggable).toBe(false);
      if (runtime_platform) {
        expect(graphic?.dataset.runtimePlatform).toBe(runtime_platform);
        expect(graphic?.alt).toContain('Runtime operating system:');
        expect(graphic?.alt).toContain(brand);
      } else {
        expect(graphic?.dataset.runtimePlatform).toBe('unknown');
        expect(graphic?.alt).toBe('Runtime operating system unknown');
      }
    }
  });
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
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'manage_runtime_gateway', connection_token: expect.any(Number), runtime_target_id: runtime.provider_runtime_link_target!.id, operation: 'status' });
    expect(h.performAction).not.toHaveBeenCalled();
    button(document.querySelector('[role="dialog"]')!, 'Cancel').click(); await settle();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(toggle));
  });
  it.each(['start', 'restart', 'update'] as const)('uses the shared enrollment authentication for card %s recovery', async operation => {
    const f = runtimeGatewayAccessFixture('ssh', operation === 'start' ? 'stopped' : operation === 'restart' ? 'control_missing' : 'update_required', 100);
    const ready = runtimeGatewayAccessFixture('ssh', 'ready', 200);
    const h = await mount(f.snapshot);
    const perform = vi.fn(async () => ({ ok: true, gateway_membership: { joined: false, phase: 'not_joined' } }));
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    h.performAction.mockImplementation(async request => {
      if (request.kind === 'refresh_environment_runtime') return { ok: true, outcome: 'refreshed_environment_runtime' };
      if (request.kind !== `${operation}_environment_runtime`) throw new Error('Unexpected lifecycle request');
      if (!('ssh_password' in request) || request.ssh_password !== ' temporary ') return {
        ok: false, code: 'runtime_start_failed', scope: 'environment', message: 'Authentication rejected',
        failure: { code: 'ssh_authentication_failed', severity: 'error', title: 'SSH authentication failed', summary: 'Authentication rejected' },
      };
      h.publish(ready.snapshot);
      return { ok: true, outcome: operation === 'start' ? 'started_environment_runtime' : operation === 'restart' ? 'restarted_environment_runtime' : 'updated_environment_runtime' };
    });
    const card = document.querySelector(`[data-environment-group="${f.environment.id}"]`)!;
    button(card, 'Actions').click(); await settle();
    button(document.querySelector('[role="menu"]')!, 'Add Gateway access').click(); await settle();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('input[type="password"]')).toBeNull();
    button(dialog, createDesktopI18n('en-US').t(operation === 'start' ? 'gatewayJoin.startAndContinue' : operation === 'restart' ? 'environmentAction.restartRuntime' : 'environmentAction.updateRuntime')).click(); await settle();
    const requests = () => h.performAction.mock.calls.map(([request]) => request).filter(request => request.kind === `${operation}_environment_runtime`);
    expect(requests()).toHaveLength(1);
    expect(requests()[0]).not.toHaveProperty('ssh_password');
    expect(dialog.querySelectorAll('input[type="password"]')).toHaveLength(1);
    const password = dialog.querySelector<HTMLInputElement>('input[type="password"]')!;
    expect(document.activeElement).toBe(password);
    password.value = ' temporary '; password.dispatchEvent(new Event('input', { bubbles: true }));
    password.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle();
    expect(requests()).toHaveLength(2);
    expect(requests()[1]).toMatchObject({ environment_id: f.environment.id, ssh_password: ' temporary ' });
    expect(dialog.querySelector('input[type="password"]')).toBeNull();
    expect(dialog.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('1');
    expect(perform).toHaveBeenCalledExactlyOnceWith({ kind: 'manage_runtime_gateway', connection_token: expect.any(Number), runtime_target_id: f.environment.provider_runtime_link_target!.id, operation: 'status' });
  });
  it('resumes a dismissed enrollment through its existing card action without adding Welcome content', async () => {
    const f = runtimeGatewayAccessFixture('ssh');
    await mount(f.snapshot);
    const perform = vi.fn(async (_request: DesktopLauncherActionRequest) => ({ ok: true, gateway_membership: { joined: false, phase: 'not_joined' } }));
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    const page = document.querySelector('[data-desktop-page="environments"]')!;
    const content = [...page.children];
    const card = document.querySelector(`[data-environment-group="${f.environment.id}"]`)!;
    const openEnrollment = async () => {
      button(card, 'Actions').click(); await settle();
      button(document.querySelector('[role="menu"]')!, 'Add Gateway access').click(); await settle();
    };
    await openEnrollment();
    const dialog = document.querySelector('.redeven-gateway-wizard-dialog')!;
    button(dialog, 'Connect and continue').click(); await settle();
    for (const [index, value] of ['https://office.example:7443', 'retained-code'].entries()) {
      const input = dialog.querySelectorAll<HTMLInputElement>('input')[index];
      input.value = value; input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    button(dialog, 'Close').click();
    await vi.waitFor(() => expect(document.querySelector('.redeven-gateway-wizard-dialog')).toBeNull());
    expect([...page.children]).toEqual(content);
    expect(perform).toHaveBeenCalledWith(expect.objectContaining({ kind: 'close_runtime_gateway' }));
    await openEnrollment();
    const resumed = document.querySelector('.redeven-gateway-wizard-dialog')!;
    expect([...resumed.querySelectorAll<HTMLInputElement>('input')].map(input => input.value)).toEqual(['https://office.example:7443', 'retained-code']);
    expect(perform.mock.calls.filter(([request]) => request.kind === 'manage_runtime_gateway')).toHaveLength(1);
    button(resumed, 'Restore connection').click(); await settle();
    expect(perform.mock.calls.filter(([request]) => request.kind === 'manage_runtime_gateway')).toHaveLength(2);
    button(resumed, 'Cancel').click();
    await vi.waitFor(() => expect(document.querySelector('.redeven-gateway-wizard-dialog')).toBeNull());
    expect([...page.children]).toEqual(content);
  });
  it('preserves the card enrollment draft and revokes verification while settings covers its shared owner', async () => {
    const f = runtimeGatewayAccessFixture('ssh');
    await mount(f.snapshot);
    const perform = vi.fn(async (request: DesktopLauncherActionRequest) => request.kind === 'manage_runtime_gateway' && request.operation === 'preview'
      ? { ok: true, gateway_preview: { preview_id: 'a'.repeat(43), purpose: 'join', gateway_id: 'office', gateway_name: 'Office', target_runtime_id: 'runtime', expires_at_unix_ms: Date.now() + 300000 } }
      : { ok: true, gateway_membership: { joined: false, phase: 'not_joined' } });
    vi.stubGlobal('redevenDesktopLauncher', { performAction: perform });
    button(document.querySelector(`[data-environment-group="${f.environment.id}"]`)!, 'Actions').click(); await settle();
    button(document.querySelector('[role="menu"]')!, 'Add Gateway access').click(); await settle();
    const dialog = document.querySelector('[role="dialog"]')!;
    button(dialog, 'Connect and continue').click(); await settle();
    const inputs = [...dialog.querySelectorAll<HTMLInputElement>('input')];
    for (const [index, value] of ['https://office.example:7443', 'retained-code'].entries()) {
      inputs[index].value = value; inputs[index].dispatchEvent(new Event('input', { bubbles: true }));
    }
    button(dialog, 'Verify').click(); await settle();
    expect(dialog.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('2');
    button(dialog, 'Back').click(); await settle();
    button(dialog, 'Back').click(); await settle();
    button(dialog, 'Settings').click(); await settle();
    expect(perform).toHaveBeenCalledWith(expect.objectContaining({ kind: 'close_runtime_gateway' }));
    const settings = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(element => element !== dialog)!;
    expect(settings).toBeDefined();
    button(settings, 'Close').click(); await settle();
    const resumed = document.querySelector('.redeven-gateway-wizard-dialog')!;
    expect(resumed.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('0');
    expect([...resumed.querySelectorAll<HTMLInputElement>('input')].map(input => input.value)).toEqual(['https://office.example:7443', 'retained-code']);
    expect(perform.mock.calls.filter(([request]) => request.kind === 'manage_runtime_gateway' && request.operation === 'status')).toHaveLength(1);
    button(resumed, 'Connect and continue').click(); await settle();
    expect(resumed.querySelector('[data-gateway-step]')?.getAttribute('data-gateway-step')).toBe('2');
    expect(button(resumed, 'Verify').disabled).toBe(false);
    expect(button(resumed, 'Confirm and enable').disabled).toBe(true);
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

  it.each(['typed', 'saved selection', 'saved URL'] as const)('retains Gateway %s drafts across launcher snapshots', async method => {
    const fixture = mixedEnvironmentFixture();
    const original = fixture.snapshot.environments.find(entry => entry.kind === 'local_environment')!;
    const runtime = { ...original, runtime_service: { ...original.runtime_service!,
      compatibility: 'compatible' as const,
      capabilities: { ...original.runtime_service!.capabilities!, runtime_gateway: { supported: true } },
    } };
    const gateway = { gateway_id: 'local-gateway', display_name: 'Gateway-local', local_enabled: true as const,
      connection_kind: method === 'saved URL' ? 'url' as const : 'ssh_host' as const, management_capability: 'access_only' as const,
      capabilities: [], status: 'unknown' as const, trust_state: 'paired' as const,
      gateway_url: 'https://office.local:7443/',
      created_at_ms: 1, updated_at_ms: 1, environments: [],
      member_endpoints: [{ endpoint_id: 'local', address: 'https://office.local:7443', scope: 'lan' as const, priority: 0 }],
    };
    const snapshot = { ...fixture.snapshot, gateway_sources: [{ ...gateway, member_endpoints: method === 'saved URL' ? undefined : gateway.member_endpoints }],
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
    if (method !== 'typed') {
      const picker = dialog.querySelector<HTMLElement>('[data-gateway-picker]')!;
      [...dialog.querySelectorAll<HTMLElement>('[role="tab"]')].find(tab => tab.textContent?.trim() === 'Saved Gateway')!.click();
      await settle();
      const trigger = picker.querySelector<HTMLElement>('[data-floe-dropdown-trigger]')!;
      trigger.click(); await settle();
      const menu = document.getElementById(trigger.getAttribute('aria-controls')!)!;
      const option = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent?.includes(gateway.display_name));
      expect(option).toBeDefined();
      option!.click();
      await settle();
      expect(picker.dataset.value).toBe('local-gateway');
    } else {
      [...dialog.querySelectorAll<HTMLElement>('[role="tab"]')].find(tab => tab.textContent?.trim() === 'Enter an address')!.click();
      await settle();
      inputs[0].value = expected; inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
    }
    inputs[1].value = 'draft-code'; inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
    inputs[1].focus();
    for (let index = 1; index <= 3; index++) {
      harness.publish({ ...structuredClone(snapshot), snapshot_revision: index }); await settle();
    }
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(dialog.querySelector('input')).toBe(inputs[0]);
    expect(inputs.map(input => input.value)).toEqual([method === 'typed' ? expected : '', 'draft-code']);
    expect(dialog.querySelector<HTMLElement>('[data-gateway-picker]')?.dataset.value).toBe(method !== 'typed' ? 'local-gateway' : '');
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
      expect(tab.id).not.toBe('');
      const controlled = document.getElementById(tab.getAttribute('aria-controls')!);
      expect(controlled?.getAttribute('aria-labelledby')).toBe(tab.id);
      tab.click(); await settle();
      const visible = [...card.querySelectorAll<HTMLElement>('[role="tabpanel"]')].find(panel => panel.getAttribute('aria-hidden') !== 'true')!;
      expect(visible.querySelector('.redeven-environment-owner-heading')?.textContent).toContain(runtime.label);
    }
    const panel = card.querySelector('[aria-label="Gateway"][role="tabpanel"]')!;
    const select = panel.querySelector<HTMLSelectElement>('select')!;
    expect(select.value).toBe('service-0');
    button(panel, 'Show window').click(); await settle();
    expect(h.performAction).toHaveBeenCalledWith(expect.objectContaining({ kind: 'focus_environment_window', session_key: fixture.inputs.openSessions[0]!.session_key }));
    select.value = 'service-1'; select.dispatchEvent(new Event('change', { bubbles: true })); await settle();
    expect(panel.textContent).toContain('https://lab.internal:7443');
    h.publish(buildDesktopWelcomeSnapshot({ ...fixture.inputs, openSessions: [] })); await settle();
    expect(document.querySelector(`[data-environment-group="${runtime.id}"]`)).toBe(card);
    expect(panel.querySelector('select')).toBe(select);
    expect(select.value).toBe('service-1');
    h.publish(buildDesktopWelcomeSnapshot({ ...fixture.inputs, openSessions: [], gatewaySources: [] })); await settle();
    expect(button(panel, 'Open window').disabled).toBe(true);
    expect(panel.querySelector<HTMLButtonElement>('.redeven-environment-card__flower-button')?.disabled).toBe(true);
    expect(select.value).toBe('service-1');
    button(panel, 'Actions').click(); await settle();
    const menu = document.querySelector('[role="menu"]')!;
    button(menu, 'Cancel Gateway pairing…').click(); await settle();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector('select')).toBeNull();
    expect(dialog.textContent).toContain('Lab');
    expect(dialog.textContent).toContain('Other connections stay available.');
    expect(perform).toHaveBeenCalledOnce();
    button(dialog, 'Cancel pairing').click(); await settle();
    expect(perform.mock.calls.at(-1)?.[0]).toMatchObject({ operation: 'leave', gateway_id: 'service-1', route_impact_acknowledged: false });
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
      expect(controlText(items[gatewayIndex - 1])).toBe('Reinstall (keep data)');
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

      cloud_link_binding: { state: 'linked' as const, connection_state: 'authorization_required' as const,
        remote_enabled: true, last_error_code: 'CONTROL_CREDENTIALS_EXPIRED' },
    } };
    const cloud = { ...f.cloud, remote_route_state: 'offline' as const };
    const h = await mount({ ...f.snapshot, environments: [runtime, cloud] });
    await h.select('cloud');
    const status = h.owner('cloud').querySelector('[data-cloud-connection-status]')!;
    expect(status).not.toBeNull();
    expect(status.textContent).toContain('Credentials expired');
    expect(status.closest('[aria-hidden="true"]')).toBeNull();
    button(status, 'Connection details: Credentials expired').click(); await settle();
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
  it.each(['inline', 'details'] as const)('offers %s recovery after a Cloud certificate failure through the exact Runtime owner', async entry => {
    const f = mixedEnvironmentFixture();
    const originalRuntime = f.snapshot.environments.find(environment => environment.kind === 'local_environment')!;
    const originalCloud = f.snapshot.environments.find(environment => environment.env_public_id === 'env_0_0')!;
    const target = originalRuntime.provider_runtime_link_target!;
    const binding = { ...target.cloud_link_binding!, connection_state: 'authorization_required' as const,
      last_error_code: 'provider_tls_untrusted',
    };
    const service = { ...target.runtime_service!, bindings: { ...target.runtime_service!.bindings!, cloud_link: binding } };
    const runtime = { ...originalRuntime, runtime_service: service, provider_runtime_link_target: { ...target,
      provider_connection_state: 'authorization_required' as const, can_connect_cloud: true,


      cloud_link_binding: binding, runtime_service: service,
    } };
    const cloud = { ...originalCloud, remote_route_state: 'provider_unreachable' as const };
    const h = await mount({ ...f.snapshot, environments: [runtime, cloud] });
    document.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click(); await settle();
    const status = h.owner('cloud').querySelector('[data-cloud-connection-status]')!;
    expect(status.textContent).toContain('Certificate not trusted');
    if (entry === 'details') {
      button(status, 'Connection details: Certificate not trusted').click(); await settle();
      const details = document.querySelector('[data-cloud-connection-details]')!;
      expect(details.textContent).toContain('Desktop could not verify the cloud certificate');
      button(details, 'Restore connection').click();
    } else {
      button(status, 'Restore').click();
    }
    await settle();
    expect(document.querySelectorAll('[role="tab"]')[0].getAttribute('aria-selected')).toBe('true');
    const review = document.querySelector('[role="dialog"]:has(input[name="provider-runtime-link-target"])')!;
    expect(review.textContent).toContain(runtime.label);
    expect(h.performAction.mock.calls.some(([request]) => request.kind === 'connect_cloud_runtime')).toBe(false);
    const confirm = button(review, 'Connect to Redeven Cloud');
    expect(confirm.disabled).toBe(false);
    h.performAction.mockResolvedValueOnce({ ok: true, outcome: 'connected_provider_runtime' });
    confirm.click(); await settle();
    expect(h.performAction).toHaveBeenCalledExactlyOnceWith({ kind: 'connect_cloud_runtime',
      provider_environment_id: cloud.id, runtime_target_id: target.id,
    });
    const blockedRuntime = { ...runtime, provider_runtime_link_target: { ...runtime.provider_runtime_link_target,
      can_connect_cloud: false,
    } };
    h.publish({ ...f.snapshot, environments: [blockedRuntime, cloud] }); await settle();
    expect(h.owner('cloud').querySelector('.redeven-cloud-connection-action')).toBeNull();
    h.publish({ ...f.snapshot, environments: [originalRuntime, originalCloud] }); await settle();
    const restored = h.owner('cloud').querySelector('[data-cloud-connection-status]')!;
    expect(restored.textContent).toContain('Connected');
    expect(restored.querySelector('.redeven-cloud-connection-action')).toBeNull();
  });

  it('uses one visible owner and owner tabs instead of stacked action surfaces', async () => {
    const h = await mount();
    const card = document.querySelector('[data-environment-group]')!;
    expect(card.querySelectorAll('[role="tab"]')).toHaveLength(2);
    expect([...card.querySelectorAll('[data-owner-id]')].filter(el => !el.closest('[hidden], [aria-hidden="true"]'))).toHaveLength(1);
    const tabs = [...card.querySelectorAll<HTMLElement>('[role="tab"]')];
    const ids = tabs.map(tab => tab.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute('aria-controls')!);
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    }
    h.publish({ ...h.snapshot, environments: h.snapshot.environments.map(entry => ({ ...entry })) }); await settle();
    expect([...card.querySelectorAll('[role="tab"]')]).toEqual(tabs);
    expect(tabs.map(tab => tab.id)).toEqual(ids);
  });
  it('switches one card between owner actions, settings and independently scoped pins', async () => {
    const h = await mount();
    expect(document.querySelectorAll('[data-environment-group]')).toHaveLength(1);
    expect(h.owner('runtime').textContent).toContain('Development runtime');
    expect(h.owner('cloud').textContent).toContain('env_linked');
    expect(document.querySelectorAll('.redeven-card-cloud-affiliation')).toHaveLength(0);
    await h.select('runtime');
    button(h.owner('runtime'), 'Open window').click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'open_local_environment', environment_id: h.runtime.id }));
    await h.select('cloud');
    button(h.owner('cloud'), 'Open window').click(); await settle();
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
    const open = button(h.owner('runtime'), 'Open window');
    expect(open.disabled).toBe(false); open.click(); await settle();
    expect(h.performAction).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'open_local_environment', environment_id: h.runtime.id }));
    await h.select('cloud');
    button(h.owner('cloud'), 'Open window').click(); await settle();
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
  it('sends captured inspection and failure logs, retains retryable input, and refreshes context only on reopening', async () => {
    const h = await mount();
    const failedRuntime = { ...h.runtime, runtime_health: { ...h.runtime.runtime_health,
      freshness: 'failed' as const, offline_reason_code: 'probe_failed' as const, offline_reason: 'Probe connection refused',
    } };
    const failed: DesktopLauncherActionProgress = {
      action: 'start_environment_runtime', environment_id: h.runtime.id, operation_key: 'start-context-fixture',
      started_at_unix_ms: 1000, status: 'failed', active_progress_surface: 'runtime_lifecycle',
      phase: 'starting_runtime_process', title: 'Start runtime', detail: 'Process exited',
      failure: { code: 'local_runtime_launch_failed', severity: 'error', title: 'Start failed',
        summary: 'Runtime exited before readiness', recovery_hint: 'Check the port and retry',
        diagnostics: [{ channel: 'stderr', label: 'Output', text: 'port already in use' }] },
    };
    h.publish({ ...h.snapshot, environments: [failedRuntime, h.cloud], action_progress: [failed] });
    await settle();
    const open = async (role: 'runtime' | 'cloud') => {
      await h.select(role);
      h.owner(role).querySelector<HTMLButtonElement>('.redeven-environment-card__flower-button')!.click();
      await settle();
      return document.querySelector<HTMLElement>('.flower-turn-launcher-window')!;
    };
    const launcher = await open('runtime');
    const input = launcher.querySelector('textarea')!;
    input.value = 'Diagnose this failure'; input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    // A background recovery must not silently replace the context already selected by the user.
    h.publish({ ...h.snapshot, environments: [h.runtime, h.cloud], action_progress: [] });
    await settle();
    const send = launcher.querySelector<HTMLButtonElement>('[data-testid="flower-turn-launcher-inline-send"]')!;
    const before = vi.mocked(launchLocalEnvironmentFlowerTurn).mock.calls.length;
    send.click(); await settle();
    const sent = vi.mocked(launchLocalEnvironmentFlowerTurn).mock.calls.at(-1)![1];
    const content = (sent.context_action as EnvironmentFlowerContextActionEnvelope).context[0].content;
    for (const fact of ['probe_failed', 'Probe connection refused', 'start-context-fixture', 'local_runtime_launch_failed', 'port already in use']) {
      expect(content).toContain(fact);
    }
    expect(input.value).toBe('Diagnose this failure');
    expect(input.disabled).toBe(false);
    expect(send.disabled).toBe(false);
    send.click(); await settle();
    expect(vi.mocked(launchLocalEnvironmentFlowerTurn).mock.calls.length).toBe(before + 2);
    expect(vi.mocked(launchLocalEnvironmentFlowerTurn).mock.calls.at(-1)![1].context_action).toEqual(sent.context_action);
    button(launcher, 'Close').click(); await settle();
    expect(document.querySelector('.flower-turn-launcher-window')).toBeNull();

    const cloudLauncher = await open('cloud');
    const cloudInput = cloudLauncher.querySelector('textarea')!;
    cloudInput.value = 'Inspect Cloud'; cloudInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    cloudLauncher.querySelector<HTMLButtonElement>('[data-testid="flower-turn-launcher-inline-send"]')!.click(); await settle();
    const cloudAction = vi.mocked(launchLocalEnvironmentFlowerTurn).mock.calls.at(-1)![1].context_action as EnvironmentFlowerContextActionEnvelope;
    const cloudContent = cloudAction.context[0].content;
    expect(cloudContent).not.toContain('port already in use');
    expect(cloudContent).toContain('"card_operation": null');
    button(cloudLauncher, 'Close').click(); await settle();

    const reopened = await open('runtime');
    const reopenedInput = reopened.querySelector('textarea')!;
    reopenedInput.value = 'Inspect current state'; reopenedInput.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    reopened.querySelector<HTMLButtonElement>('[data-testid="flower-turn-launcher-inline-send"]')!.click(); await settle();
    const refreshedAction = vi.mocked(launchLocalEnvironmentFlowerTurn).mock.calls.at(-1)![1].context_action as EnvironmentFlowerContextActionEnvelope;
    const refreshed = refreshedAction.context[0].content;
    expect(refreshed).toContain('"freshness": "fresh"');
    expect(refreshed).not.toContain('port already in use');
    button(reopened, 'Close').click(); await settle();
  });
  it('retains removal confirmation but requires explicit verification after delete capability returns', async () => {
    const h = await mount();
    const runtime = { ...h.runtime, kind: 'ssh_environment' as const, registration_ref: { kind: 'runtime_target' as const, id: 'ssh:fixture' as const }, can_delete: true };
    h.publish({ ...h.snapshot, environments: [runtime, h.cloud] }); await settle();
    await h.select('runtime');
    button(h.owner('runtime'), 'Remove Development runtime · Runtime').click(); await settle();
    const dialog = document.querySelector('[role="dialog"]')!;
    h.publish({ ...h.snapshot, environments: [{ ...runtime, can_delete: false }, h.cloud] }); await settle();
    expect(document.querySelector('[role="dialog"]')).toBe(dialog);
    expect(button(dialog, 'Remove').disabled).toBe(true);
    button(dialog, 'Remove').click(); expect(h.performAction).not.toHaveBeenCalled();
    h.publish({ ...h.snapshot, environments: [runtime, h.cloud] }); await settle();
    expect(button(dialog, 'Remove').disabled).toBe(true);
    button(dialog, 'Verify current target').click(); await settle();
    expect(button(dialog, 'Remove').disabled).toBe(false);
    expect(button(dialog, 'Cancel').disabled).toBe(false);
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
    expect(button(h.owner('runtime'), 'Open window').disabled).toBe(false);
    expect(h.owner('cloud').querySelector('[data-floe-progress-shimmer]')).not.toBeNull();
    h.publish({ ...h.snapshot, environments: [
      { ...h.runtime, provider_runtime_link_target: { ...h.runtime.provider_runtime_link_target!, cloud_link_state: 'unbound' } },
      { ...h.cloud, cloud_linked_runtime_summary: undefined, access_group_id: h.cloud.id },
    ] }); await settle();
    expect(document.querySelectorAll('[data-environment-group]')).toHaveLength(2);
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(document.querySelectorAll('[role="tabpanel"][aria-labelledby]')).toHaveLength(0);
  });
});

const visibleCards = () => [...document.querySelectorAll<HTMLElement>('[data-environment-group]')].filter(el => !el.closest('[hidden]'));
const activeOwner = (card: Element) => [...card.querySelectorAll<HTMLElement>('[data-owner-id]')].find(el => !el.closest('[aria-hidden="true"]'))!;
const selectTab = async (card: Element, index: number) => {
  const tab = card.querySelectorAll<HTMLElement>('[role="tab"]')[index]; tab.click();
  await vi.waitFor(() => expect(document.getElementById(tab.getAttribute('aria-controls')!)?.getAttribute('aria-hidden')).not.toBe('true'));
  // Finish both paint stages of the published controlled-selection transaction.
  await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(() => requestAnimationFrame(() => setTimeout(resolve)), 0)));
  expect(tab.getAttribute('aria-selected')).toBe('true');
};
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
    button(card, 'Open window').click(); await settle();
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
  it('retains sign-out confirmation with submission disabled when its account disappears', async () => {
    const { snapshot } = mixedEnvironmentFixture();
    const h = await mount(snapshot);
    button(document, 'Redeven Cloud').click(); await settle();
    const account = document.querySelector('.redeven-cloud-source-header')!;
    button(account, 'Sign out of Team account on this Desktop').click(); await settle();
    button(document.querySelector('[role="dialog"]')!, 'Cancel').click(); await settle();
    expect(h.performAction).not.toHaveBeenCalled();
    button(account, 'Sign out of Team account on this Desktop').click(); await settle();
    const confirmation = document.querySelector('[role=dialog]')!;
    h.publish({ ...snapshot, control_planes: snapshot.control_planes.slice(1) }); await settle();
    expect(document.querySelector('[role=dialog]')).toBe(confirmation);
    expect(button(confirmation, 'Sign out').disabled).toBe(true);
    expect(confirmation.querySelector('[role=alert]')).not.toBeNull();
    h.publish(structuredClone(snapshot)); await settle();
    expect(button(confirmation, 'Sign out').disabled).toBe(true);
    button(confirmation, 'Verify current target').click(); await settle();
    expect(button(confirmation, 'Sign out').disabled).toBe(false);
    button(confirmation, 'Cancel').click(); await new Promise(resolve => setTimeout(resolve, 250));
    expect(document.querySelector('[role=dialog]')).toBeNull();
    expect(h.performAction).not.toHaveBeenCalled();
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
  it('keeps opened settings on their original owner with an exit when that owner disappears', async () => {
    const h = await mount();
    await h.select('cloud');
    button(h.owner('cloud'), 'Settings for Cloud workspace · Redeven Cloud').click(); await settle();
    await h.select('runtime');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Cloud workspace');
    expect(h.settings.load).not.toHaveBeenCalled();
    const dialog = document.querySelector('[role=dialog]')!;
    h.publish({ ...h.snapshot, environments: [h.runtime] }); await settle();
    expect(document.querySelector('[role=dialog]')).toBe(dialog);
    expect(dialog.textContent).toContain('Cloud workspace');
    expect(dialog.querySelector('[role=alert]')).not.toBeNull();
    button(dialog, 'Close').click(); await new Promise(resolve => setTimeout(resolve, 250));
    expect(document.querySelector('[role=dialog]')).toBeNull();
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

describe('background interaction continuity', () => {
  it('opens the ready environment instead of reopening completed startup progress', async () => {
    const f = await runtimeGatewayBackgroundProbeFixture('local');
    const snapshot = f.snapshot();
    const progress: DesktopLauncherActionProgress = {
      action: 'start_environment_runtime', environment_id: f.environment.id,
      operation_key: 'local:auto_start', subject_kind: 'local_environment',
      status: 'succeeded', phase: 'runtime_started', title: 'Runtime ready', detail: '',
      started_at_unix_ms: Date.now(), active_progress_surface: 'runtime_lifecycle',
      lifecycle_progress: runtimeLifecycleProgress({ location: 'local_host', operation: 'start',
        phase: 'runtime_ready', targetID: f.environment.managed_runtime_placement_target_id!,
        targetLabel: f.environment.label }),
    };
    const h = await mount({ ...snapshot, action_progress: [progress] });
    button(document.querySelector('[data-environment-group]')!, 'Open window').click();
    await settle();
    expect(h.performAction).toHaveBeenCalledOnce();
    expect(h.performAction.mock.calls[0][0]).toMatchObject({
      kind: 'open_local_environment', environment_id: f.environment.id,
    });
  });
  it('keeps completed startup from authorizing a replaced target and preserves an exit', async () => {
    const f = await runtimeGatewayBackgroundProbeFixture('local');
    const snapshot = f.snapshot();
    const progress: DesktopLauncherActionProgress = {
      action: 'start_environment_runtime', environment_id: f.environment.id,
      operation_key: 'local:auto_start', subject_kind: 'local_environment',
      status: 'running', phase: 'starting_runtime_process', title: 'Starting Runtime', detail: '',
      started_at_unix_ms: Date.now(), active_progress_surface: 'runtime_lifecycle',
      lifecycle_progress: runtimeLifecycleProgress({ location: 'local_host', operation: 'start',
        phase: 'starting_runtime_process', targetID: f.environment.managed_runtime_placement_target_id!,
        targetLabel: f.environment.label }),
    };
    const h = await mount({ ...snapshot, action_progress: [progress] });
    const card = document.querySelector('[data-environment-group]')!;
    card.querySelector<HTMLButtonElement>('[aria-label$="Show progress."]')!.click(); await settle();
    const ready = { ...snapshot, action_progress: [{ ...progress, status: 'succeeded' as const,
      phase: 'runtime_started', lifecycle_progress: runtimeLifecycleProgress({ location: 'local_host',
        operation: 'start', phase: 'runtime_ready', targetID: f.environment.managed_runtime_placement_target_id!,
        targetLabel: f.environment.label }) }] };
    h.publish(ready); await settle();
    h.publish({ ...ready, environments: ready.environments.map(entry => ({ ...entry,
      managed_runtime_placement: { kind: 'host_process' as const, runtime_root: '/replacement' },
    })) }); await settle();
    h.publish(ready); await settle();
    const panel = document.querySelector('.redeven-environment-progress')!;
    expect(button(panel, 'Open window').disabled).toBe(true);
    expect(button(document, 'Verify current target').disabled).toBe(false);
    button(card, 'Open window').click(); await settle();
    expect(h.performAction).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.querySelector('.redeven-action-popover-surface')).toBeNull());
  });
  it('retains exactly one interaction host when an open Cloud owner changes groups', async () => {
    const h = await mount(); await h.select('cloud');
    button(h.owner('cloud'), 'Actions').click(); await settle();
    const menu = document.querySelector('[role=menu]')!;
    const control = menu.querySelector<HTMLButtonElement>('button:not(:disabled)')!; control.focus();
    h.publish({ ...h.snapshot, environments: h.snapshot.environments.map(entry => entry.id === h.cloud.id
      ? { ...entry, access_group_id: undefined } : entry) }); await settle();
    expect(document.querySelectorAll(`[data-owner-id="${h.cloud.id}"]`)).toHaveLength(1);
    expect(document.querySelector('[role=menu]')).toBe(menu);
    expect(document.activeElement).toBe(control);
  });
  it('retains every open action control and keyboard focus across equivalent snapshots', async () => {
    const f = await runtimeGatewayBackgroundProbeFixture('ssh');
    const h = await mount(f.snapshot());
    button(document.querySelector('[data-environment-group]')!, 'Actions').click(); await settle();
    const menu = document.querySelector('[role="menu"]')!;
    const controls = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    expect(controls.length).toBeGreaterThan(1);
    const focus = controls.find(control => !control.disabled)!;
    focus.focus(); h.publish(structuredClone(f.snapshot())); await settle();
    expect(document.querySelector('[role="menu"]')).toBe(menu);
    controls.forEach((control, index) => expect(menu.querySelectorAll('button')[index]).toBe(control));
    expect(document.activeElement).toBe(focus);
  });
  it.each(['erase', 'keep'])('opens lifecycle progress before admission and preserves %s data selection on retry', async mode => {
    const f = await runtimeGatewayBackgroundProbeFixture('ssh');
    const h = await mount(f.snapshot());
    let reject!: () => void;
    h.performAction.mockImplementation(() => new Promise(resolve => { reject = () => resolve({ ok: false, message: 'Admission rejected', code: 'action_invalid', scope: 'environment' } as DesktopLauncherActionResult); }));
    button(document.querySelector('[data-environment-group]')!, 'Actions').click(); await settle();
    const menu = document.querySelector('[role="menu"]')!;
    const action = [...menu.querySelectorAll<HTMLButtonElement>('button')].find(control => !control.disabled && controlText(control).includes(`Reinstall (${mode} data)`))!;
    expect(action).toBeTruthy(); action.click(); await settle();
    expect(h.performAction.mock.calls[0][0]).toMatchObject({ kind: 'preview_reinstall_target', mode: mode === 'keep' ? 'preserve_data' : 'wipe_data' });
    const panel = document.querySelector('.redeven-environment-progress');
    expect(panel).not.toBeNull();
    h.publish(structuredClone(f.snapshot())); await settle();
    expect(document.querySelector('.redeven-environment-progress')).toBe(panel);
    reject(); await settle();
    expect(document.querySelector('.redeven-environment-progress')?.querySelector('[role="alert"]')).not.toBeNull();
    expect(h.performAction).toHaveBeenCalledTimes(1);
    button(panel!, 'Retry').click(); await settle();
    expect(h.performAction).toHaveBeenCalledTimes(2);
    expect(h.performAction.mock.calls[1][0]).toMatchObject({ kind: 'preview_reinstall_target', mode: mode === 'keep' ? 'preserve_data' : 'wipe_data' });
    reject(); await settle();
  });
});
