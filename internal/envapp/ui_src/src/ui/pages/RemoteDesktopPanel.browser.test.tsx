import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { I18nProvider } from '../i18n/I18nProvider';
import { SUPPORTED_LOCALES } from '../i18n/localeMeta';
import { loadEnvAppDictionary } from '../i18n/locales';
import { writeStoredLanguagePreference } from '../i18n/storage';
import { RemoteDesktopLauncher } from './RemoteDesktopPanel';

const state = vi.hoisted(() => ({ status: vi.fn(), deployment: vi.fn(), create: vi.fn(), open: vi.fn() }));
const setupNeeded = {
  capabilities: { backend: 'linux-drm-kms', state: 'setup_required', screen: false, input: false, audio: false, clipboard: false, unattended: true, displays: [] },
  login_service: { state: 'not_installed', backend: 'linux-drm-kms' },
  unattended: false, control_in_use: false, last_display_id: '',
};

vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ name: 'Qualification host', permissions: { can_read: true, can_write: true, can_execute: true } }),
  env_id: () => 'desktop-layout', localRuntime: () => ({}),
}) }));
vi.mock('../services/desktopSessionContext', async original => ({ ...await original<object>(), readDesktopSessionContextSnapshot: () => ({ label: 'Qualification host' }) }));
vi.mock('../services/desktopShellBridge', async original => ({ ...await original<object>(),
  desktopShellWebServiceWindowOpenAvailable: () => true,
  remoteDesktopDeploymentInDesktopShell: state.deployment,
  onRemoteDesktopDeploymentProgress: () => () => {},
}));
vi.mock('../services/remoteDesktopApi', async original => ({ ...await original<object>(), getRemoteDesktopStatus: state.status, createRemoteDesktop: state.create }));
vi.mock('../services/webServiceWindows', async original => ({ ...await original<object>(), resolveWebServiceOpenRoute: () => ({ kind: 'local_proxy', url: '/pf/one/' }), openWebServiceRoute: state.open }));

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks(); state.status.mockResolvedValue(setupNeeded);
  state.deployment.mockResolvedValue({ ok: true, available: true }); state.open.mockResolvedValue(undefined);
});
afterEach(() => { dispose?.(); document.body.replaceChildren(); writeStoredLanguagePreference('system'); });

it.each(SUPPORTED_LOCALES)('centers the primary label and keeps SSH authorization usable in narrow %s windows', async locale => {
  await page.viewport(320, 780);
  await loadEnvAppDictionary(locale);
  writeStoredLanguagePreference(locale);
  let finishDeployment!: (value: object) => void;
  state.deployment.mockImplementation(request => request.action === 'capabilities' ? Promise.resolve({ ok: true, available: true }) : new Promise(resolve => { finishDeployment = resolve; }));
  const host = document.createElement('main'); document.body.append(host);
  dispose = render(() => <I18nProvider><RemoteDesktopLauncher /></I18nProvider>, host);
  await expect.poll(() => document.documentElement.lang).toBe(locale);
  await userEvent.click(host.querySelector('button')!);
  const dialog = document.querySelector<HTMLElement>('.remote-desktop-dialog')!;
  const primary = dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')!;
  await expect.poll(() => primary?.disabled).toBe(false);
  const button = primary.getBoundingClientRect();
  const label = primary.querySelector('span > span')!.getBoundingClientRect();
  const labelFontSize = Number.parseFloat(getComputedStyle(primary).fontSize);
  expect(label.height).toBeLessThan(labelFontSize * 1.7);
  expect(Math.abs(label.x + label.width / 2 - button.x - button.width / 2)).toBeLessThan(1);
  expect(button.right).toBeLessThanOrEqual(320);
  expect(primary.scrollWidth).toBeLessThanOrEqual(primary.clientWidth + 1);
  await userEvent.click(primary);
  await expect.poll(() => document.querySelector('.remote-desktop-deployment-flow')).not.toBeNull();
  const flow = document.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!;
  await Promise.allSettled(flow.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
  expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
  expect(flow.scrollWidth).toBeLessThanOrEqual(flow.clientWidth + 1);
  for (const control of flow.querySelectorAll<HTMLElement>('input, button')) {
    const rect = control.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(320);
    expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth + 1);
    if (control.tagName === 'BUTTON') expect(getComputedStyle(control).whiteSpace).toBe('nowrap');
  }
  await page.elementLocator(flow.querySelector<HTMLInputElement>('input[type=password]')!).fill('ephemeral-fixture');
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => flow.querySelector('[data-phase=applying]')).not.toBeNull();
  await Promise.allSettled(flow.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  expect(flow.scrollWidth).toBeLessThanOrEqual(flow.clientWidth + 1);
  for (const control of flow.querySelectorAll<HTMLElement>('input, button')) expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth + 1);
  if (locale === 'zh-CN') await page.screenshot({ element: dialog, path: '__screenshots__/remote-desktop-step-narrow-zh-CN.png' });
  finishDeployment({ ok: false, code: 'canceled', rollback: 'complete' });
  await expect.poll(() => flow.querySelector('[data-phase=authorizing]')).not.toBeNull();
});

it.each(['no-preference', 'reduce'] as const)('advances one dialog with visible credentials and accessible %s motion', async reducedMotion => {
  const media = commands as unknown as { emulateMediaPreferences: (preferences: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
  await media.emulateMediaPreferences({ reducedMotion });
  try {
    await page.viewport(1000, 850);
    await loadEnvAppDictionary('en-US'); writeStoredLanguagePreference('en-US');
    let finishDeployment!: (value: object) => void, finishConnection!: (value: object) => void;
    state.deployment.mockImplementation(request => request.action === 'capabilities' ? Promise.resolve({ ok: true, available: true }) : new Promise(resolve => { finishDeployment = resolve; }));
    state.create.mockImplementation(() => new Promise(resolve => { finishConnection = resolve; }));
    const host = document.createElement('main'); document.body.append(host);
    dispose = render(() => <I18nProvider><RemoteDesktopLauncher /></I18nProvider>, host);
    await userEvent.click(host.querySelector('button')!);
    const dialog = document.querySelector<HTMLElement>('.remote-desktop-dialog')!;
    await expect.poll(() => dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')?.disabled).toBe(false);
    await userEvent.click(dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')!);
    const flow = dialog.querySelector<HTMLElement>('.remote-desktop-deployment-flow')!;
    const duration = Number.parseFloat(getComputedStyle(flow).animationDuration);
    expect(duration).toBeLessThanOrEqual(.3);
    expect(getComputedStyle(flow).animationName).toBe(reducedMotion === 'reduce' ? 'none' : 'remote-desktop-flow-enter');
    await Promise.allSettled(dialog.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
    const initialHeight = dialog.getBoundingClientRect().height;
    const actionWidth = flow.querySelector('.remote-desktop-flow-footer > button:last-child')!.getBoundingClientRect().width;
    const password = flow.querySelector<HTMLInputElement>('input[type=password]')!;
    await page.elementLocator(password).fill('ephemeral-fixture');
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => flow.querySelector('[data-phase="applying"]')).not.toBeNull();
    const pending = flow.querySelector<HTMLInputElement>('input[type=password]')!;
    expect(pending.value).toBe('ephemeral-fixture'); expect(pending.disabled).toBe(true);
    expect(flow.querySelector('[aria-current=step]')?.textContent).toContain('Prepare host');
    expect(getComputedStyle(flow.querySelector('.remote-desktop-flow-spinner')!).animationName).toBe(reducedMotion === 'reduce' ? 'none' : 'remote-desktop-flow-spin');
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
    const action = flow.querySelector('.remote-desktop-flow-footer > button:last-child')!;
    expect(Math.abs(action.getBoundingClientRect().width - actionWidth)).toBeLessThan(1);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(getComputedStyle(flow.querySelector('.remote-desktop-step-title')!).boxShadow).toBe('none');
    await Promise.allSettled(dialog.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
    expect(Math.abs(dialog.getBoundingClientRect().height - initialHeight)).toBeLessThan(1);
    if (reducedMotion === 'no-preference') await page.screenshot({ element: dialog, path: '__screenshots__/remote-desktop-step-applying.png' });
    state.status.mockResolvedValue({ ...setupNeeded, capabilities: { ...setupNeeded.capabilities, state: 'ready', screen: true, input: true }, login_service: { ...setupNeeded.login_service, state: 'active' } });
    finishDeployment({ ok: true });
    await expect.poll(() => state.create.mock.calls.length).toBe(1);
    expect(dialog.querySelector('.remote-desktop-deployment-flow')).toBe(flow);
    expect(flow.querySelector('input[type=password]')).toBeNull();
    expect(flow.querySelector('[aria-current=step]')?.textContent).toContain('Connect');
    expect(document.querySelectorAll('[role=dialog]')).toHaveLength(1);
    await Promise.allSettled(dialog.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
    expect(Math.abs(dialog.getBoundingClientRect().height - initialHeight)).toBeLessThan(1);
    if (reducedMotion === 'no-preference') await page.screenshot({ element: dialog, path: '__screenshots__/remote-desktop-step-connecting.png' });
    finishConnection({ id: 'one', forward_id: 'pf-one', target_url: 'http://127.0.0.1:40201' });
    await expect.poll(() => document.querySelector('.remote-desktop-dialog')).toBeNull();
    expect(state.open).toHaveBeenCalledOnce();
  } finally { await media.emulateMediaPreferences({ reducedMotion: 'no-preference' }); }
});
