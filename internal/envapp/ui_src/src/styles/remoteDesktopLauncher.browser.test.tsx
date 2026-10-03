import '../index.css';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { RemoteDesktopLauncher, RemoteDesktopPanel } from '../ui/pages/RemoteDesktopPanel';
import { SUPPORTED_LOCALES, type RedevenLocale } from '../ui/i18n/localeMeta';
import { createTestI18nHelpers } from '../ui/i18n/locales/testDictionaries';
import { LocalApiError } from '../ui/services/localApi';
import { expectSingleLineButtonLabels } from '../test/buttonLayoutAssertions';
import type { RemoteDesktopStatus } from '../ui/services/remoteDesktopApi';

const state = vi.hoisted(() => ({ locale: 'zh-CN' as RedevenLocale, status: vi.fn(), create: vi.fn(), open: vi.fn(), save: vi.fn(), permission: vi.fn(), full: true }));
vi.mock('../ui/i18n', () => ({ useI18n: () => ({ ...createTestI18nHelpers(state.locale), locale: () => state.locale }) }));
vi.mock('../ui/pages/EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ name: 'Local Environment', agent: { hostname: 'server.local' }, permissions: { can_read: true, can_write: state.full, can_execute: state.full } }),
  env_id: () => 'fixture', localRuntime: () => ({}),
}) }));
vi.mock('../ui/services/desktopSessionContext', async importOriginal => ({ ...await importOriginal<object>(), readDesktopSessionContextSnapshot: () => ({ label: 'server' }) }));
vi.mock('../ui/services/desktopShellBridge', async original => ({ ...await original<object>(), desktopShellWebServiceWindowOpenAvailable: () => true }));
vi.mock('../ui/services/webServiceWindows', async original => ({ ...await original<object>(), resolveWebServiceOpenRoute: () => ({ kind: 'local_proxy', url: '/pf/one/' }), openWebServiceRoute: state.open }));
vi.mock('../ui/services/remoteDesktopApi', () => ({ getRemoteDesktopStatus: state.status, createRemoteDesktop: state.create, setRemoteDesktopUnattended: state.save, disconnectRemoteDesktop: vi.fn(), prepareRemoteDesktop: vi.fn(), cancelRemoteDesktopPreparation: vi.fn() }));
vi.mock('../ui/services/hostApplicationsApi', () => ({ requestHostApplicationPermission: state.permission }));

const ready: RemoteDesktopStatus = { capabilities: { backend: 'macos', state: 'ready', screen: true, input: true, audio: true, clipboard: true, unattended: true, displays: [{ id: 'one', name: 'Studio Display', width: 2560, height: 1440, scale: 1, primary: true }] }, unattended: false, control_in_use: false, last_display_id: '' };
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks(); state.locale = 'zh-CN'; state.full = true;
  state.status.mockResolvedValue(structuredClone(ready)); state.create.mockResolvedValue({ id: 'one', forward_id: 'pf-one', target_url: 'http://127.0.0.1:40201' }); state.open.mockResolvedValue(undefined);
  document.documentElement.dataset.floeShellTheme = 'porcelain-dark'; document.documentElement.classList.add('dark');
});
afterEach(() => { dispose?.(); document.body.replaceChildren(); document.documentElement.classList.remove('dark', 'light'); delete document.documentElement.dataset.floeShellTheme; });

async function launch(width = 1000) {
  await page.viewport(width, 850);
  const host = document.createElement('main'); host.style.cssText = 'min-height:800px;background:var(--background);color:var(--foreground);padding:20px'; document.body.append(host);
  dispose = render(() => <RemoteDesktopLauncher />, host);
  const copy = createTestI18nHelpers(state.locale);
  const trigger = host.querySelector('button')!;
  trigger.focus(); await userEvent.keyboard('{Enter}');
  await expect.poll(() => document.querySelector('.remote-desktop-dialog')).toBeTruthy();
  const dialog = document.querySelector<HTMLElement>('.remote-desktop-dialog')!;
  await expect.poll(() => dialog.querySelector('.remote-desktop-state')?.textContent).not.toContain(copy.t('remoteDesktop.checking'));
  // WebKit cancels replaced entrance animations as their CSS settles. Wait for
  // both finished and cancelled animations before measuring the final layout.
  await Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
  await expect.poll(() => getComputedStyle(dialog).opacity).toBe('1');
  await expect.poll(() => dialog.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length).toBe(0);
  return { host, dialog, copy, trigger };
}

it.each(SUPPORTED_LOCALES.flatMap(locale => [320, 1000].map(width => ({ locale, width }))))('keeps the connection flow clear and compact in $locale at $width px', async ({ locale, width }) => {
  state.locale = locale;
  const { dialog, copy, trigger } = await launch(width);
  expect(dialog.textContent).not.toContain('Local Environment');
  expect(dialog.querySelector('h3')?.textContent).toBe('server');
  expect(dialog.querySelector('select')).toBeNull();
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  expect(dialog.getBoundingClientRect().height).toBeLessThan(390);
  const connect = dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')!;
  expect(connect.disabled).toBe(false);
  expect(connect.scrollWidth).toBeLessThanOrEqual(connect.clientWidth);
  expectSingleLineButtonLabels(dialog);
  const options = dialog.querySelector<HTMLDetailsElement>('.remote-desktop-options')!;
  expect(options.open).toBe(false);
  expect(state.save).not.toHaveBeenCalled();
  if (locale === 'zh-CN') await page.screenshot({ element: dialog, path: `__screenshots__/remote-desktop-ready-${width}.png` });
  options.querySelector('summary')!.focus(); await userEvent.keyboard('{Enter}'); expect(options.open).toBe(true);
  expect(options.textContent).toContain(copy.t('remoteDesktop.unattendedHint'));
  const view = options.querySelector<HTMLInputElement>('[role=switch]')!;
  view.focus(); await userEvent.keyboard(' '); expect(view.checked).toBe(true);
  expect(options.querySelector('summary')?.textContent).toContain(copy.t('remoteDesktop.view'));
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  expectSingleLineButtonLabels(dialog);
  expect((await axe.run(dialog, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations).toEqual([]);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.remote-desktop-dialog')).toBeNull();
  await expect.poll(() => document.activeElement).toBe(trigger);
});

it.each(builtInShellThemePresets)('renders the dialog and its focused controls in $name', async preset => {
  document.documentElement.dataset.floeShellTheme = preset.name;
  document.documentElement.classList.toggle('dark', preset.mode === 'dark');
  const { dialog } = await launch(390);
  expect((await axe.run(dialog, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations).toEqual([]);
  if (preset.name.startsWith('porcelain-')) await page.screenshot({ element: dialog, path: `__screenshots__/remote-desktop-${preset.name}.png` });
});

it('keeps errors visible with diagnostic details and closes the launcher after a successful retry', async () => {
  state.create.mockRejectedValueOnce(new LocalApiError({ status: 503, code: 'DESKTOP_UNAVAILABLE', message: 'Remote desktop request failed' }));
  const { dialog, copy } = await launch(390);
  const connect = page.elementLocator(dialog).getByRole('button', { name: copy.t('remoteDesktop.connect'), exact: true });
  await userEvent.click(connect);
  await expect.element(page.elementLocator(dialog).getByRole('alert')).toBeVisible();
  expect(dialog.querySelector('[role=alert]')?.textContent).toContain(copy.t('remoteDesktop.connectionFailed'));
  await userEvent.click(page.elementLocator(dialog).getByRole('button', { name: copy.t('remoteDesktop.refresh'), exact: true }));
  await expect.poll(() => state.status.mock.calls.length).toBe(3);
  expect(dialog.querySelector('[role=alert]')).not.toBeNull();
  await page.screenshot({ element: dialog, path: '__screenshots__/remote-desktop-error.png' });
  await userEvent.click(connect);
  await expect.poll(() => document.querySelector('.remote-desktop-dialog')).toBeNull();
  expect(state.create).toHaveBeenLastCalledWith(expect.objectContaining({ host_name: 'server', mode: 'control' }));
});

it.each(['locked', 'session_unavailable', 'unsupported', 'screen_permission_required', 'setup_required', 'authorization_required'])('explains the next step for %s', async value => {
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, state: value, backend: value === 'authorization_required' ? 'wayland' : 'macos', screen: value !== 'screen_permission_required' } });
  const { dialog } = await launch(390);
  expect(dialog.querySelector('.remote-desktop-guidance, .remote-desktop-setup')).not.toBeNull();
  expect(dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')!.disabled).toBe(value !== 'authorization_required');
  expectSingleLineButtonLabels(dialog);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  if (value === 'locked' || value === 'authorization_required') await page.screenshot({ element: dialog, path: `__screenshots__/remote-desktop-${value}.png` });
});

it('does not report permission reuse as enabled when saving fails', async () => {
  state.save.mockRejectedValue(new LocalApiError({ status: 403, code: 'DESKTOP_FORBIDDEN', message: 'Permission required' }));
  const { dialog, copy } = await launch(390);
  await userEvent.click(dialog.querySelector('summary')!);
  const input = dialog.querySelectorAll<HTMLInputElement>('[role=switch]')[1];
  input.focus(); await userEvent.keyboard(' ');
  await expect.poll(() => dialog.querySelector('[role=alert]')?.textContent).toContain(copy.t('remoteDesktop.settingsFailed'));
  expect(input.checked).toBe(false); expect(input.getAttribute('aria-checked')).toBe('false');
});

it('keeps controls within a scaled narrow Workbench panel', async () => {
  await page.viewport(900, 700);
  const host = document.createElement('main'); host.style.cssText = 'width:320px;height:500px;overflow:auto;transform:translate(80px,30px) scale(.8);transform-origin:top left;background:var(--background)'; document.body.append(host);
  dispose = render(() => <RemoteDesktopPanel />, host);
  await expect.poll(() => host.querySelector<HTMLButtonElement>('.remote-desktop-connect')?.disabled).toBe(false);
  await userEvent.click(host.querySelector('summary')!);
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  expectSingleLineButtonLabels(host);
  await page.screenshot({ element: host, path: '__screenshots__/remote-desktop-workbench.png' });
});
