import '../index.css';
import { render } from 'solid-js/web';
import { ErrorBoundary } from 'solid-js';
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

const state = vi.hoisted(() => ({ locale: 'zh-CN' as RedevenLocale, status: vi.fn(), create: vi.fn(), open: vi.fn(), save: vi.fn(), forget: vi.fn(), prepare: vi.fn(), cancel: vi.fn(), permission: vi.fn(), full: true }));
vi.mock('../ui/i18n', () => ({ useI18n: () => ({ ...createTestI18nHelpers(state.locale), locale: () => state.locale }) }));
vi.mock('../ui/pages/EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ name: 'Local Environment', agent: { hostname: 'server.local' }, permissions: { can_read: true, can_write: state.full, can_execute: state.full } }),
  env_id: () => 'fixture', localRuntime: () => ({}),
}) }));
vi.mock('../ui/services/desktopSessionContext', async importOriginal => ({ ...await importOriginal<object>(), readDesktopSessionContextSnapshot: () => ({ label: 'server' }) }));
vi.mock('../ui/services/desktopShellBridge', async original => ({ ...await original<object>(), desktopShellWebServiceWindowOpenAvailable: () => true }));
vi.mock('../ui/services/webServiceWindows', async original => ({ ...await original<object>(), resolveWebServiceOpenRoute: () => ({ kind: 'local_proxy', url: '/pf/one/' }), openWebServiceRoute: state.open }));
vi.mock('../ui/services/remoteDesktopApi', () => ({ getRemoteDesktopStatus: state.status, createRemoteDesktop: state.create, setRemoteDesktopUnattended: state.save, forgetRemoteDesktopAuthorization: state.forget, disconnectRemoteDesktop: vi.fn(), prepareRemoteDesktop: state.prepare, cancelRemoteDesktopPreparation: state.cancel }));
vi.mock('../ui/services/hostApplicationsApi', () => ({ requestHostApplicationPermission: state.permission }));

const ready: RemoteDesktopStatus = { capabilities: { backend: 'macos', state: 'ready', screen: true, input: true, audio: true, clipboard: true, unattended: true, displays: [{ id: 'one', name: 'Studio Display', width: 2560, height: 1440, scale: 1, primary: true }] }, unattended: false, control_in_use: false, last_display_id: '' };
let dispose: (() => void) | undefined;
let renderErrors: string[] = [];
beforeEach(() => {
  renderErrors = [];
  vi.resetAllMocks(); state.locale = 'zh-CN'; state.full = true;
  state.status.mockResolvedValue(structuredClone(ready)); state.create.mockResolvedValue({ id: 'one', forward_id: 'pf-one', target_url: 'http://127.0.0.1:40201' }); state.open.mockResolvedValue(undefined);
  document.documentElement.dataset.floeShellTheme = 'porcelain-dark'; document.documentElement.classList.add('dark');
});
afterEach(() => { dispose?.(); document.body.replaceChildren(); document.documentElement.classList.remove('dark', 'light'); delete document.documentElement.dataset.floeShellTheme; expect(renderErrors).toEqual([]); });

async function launch(width = 1000) {
  await page.viewport(width, 850);
  const host = document.createElement('main'); host.style.cssText = 'min-height:800px;background:var(--background);color:var(--foreground);padding:20px'; document.body.append(host);
  dispose = render(() => <ErrorBoundary fallback={error => { renderErrors.push(String(error)); return <p role="alert">{String(error)}</p>; }}><RemoteDesktopLauncher /></ErrorBoundary>, host);
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
  expect(options.textContent).toContain(copy.t('remoteDesktop.viewHint'));
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

it.each([0, 167058723])('prepares desktop components without losing the page when expected bytes are %s', async expected => {
  const setupRequired: RemoteDesktopStatus = { ...ready, capabilities: { ...ready.capabilities, backend: '', state: 'setup_required', screen: false, input: false, displays: [] }, setup: { state: 'available', expected_bytes: 0, received_bytes: 0, can_cancel: false } };
  state.status.mockResolvedValue(setupRequired);
  state.prepare.mockImplementation(async () => {
    const setup = { state: expected ? 'downloading' : 'checking', operation_id: 'task-preparation', expected_bytes: expected, received_bytes: 0, can_cancel: true };
    state.status.mockResolvedValue({ ...setupRequired, setup });
    return setup;
  });
  const { dialog, copy } = await launch(320);
  await userEvent.click(page.elementLocator(dialog).getByRole('button', { name: copy.t('remoteDesktop.prepare'), exact: true }));
  await expect.poll(() => dialog.querySelector('progress')).not.toBeNull();
  expect(renderErrors).toEqual([]);
  expect(state.prepare).toHaveBeenCalledTimes(1);
  const progress = dialog.querySelector('progress')!;
  expect(progress.position).toBe(expected ? 0 : -1);
  expect(progress.getAttribute('aria-label')).toBe(copy.t('remoteDesktop.preparing'));
  expect(dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')?.disabled).toBe(true);
  expectSingleLineButtonLabels(dialog);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  // Real preparation switches from an unknown total to byte progress and may
  // return to an unknown total while cached components are checked or installed.
  state.status.mockResolvedValue({ ...setupRequired, setup: { state: 'downloading', operation_id: 'task-preparation', expected_bytes: 100, received_bytes: 25, can_cancel: true } });
  await expect.poll(() => dialog.querySelector('progress')?.position, { timeout: 5000 }).toBe(.25);
  state.status.mockResolvedValue({ ...setupRequired, setup: { state: 'installing', operation_id: 'task-preparation', expected_bytes: 0, received_bytes: 0, can_cancel: true } });
  await expect.poll(() => dialog.querySelector('progress')?.position, { timeout: 5000 }).toBe(-1);
  expect(dialog.querySelector('progress')?.hasAttribute('value')).toBe(false);
  expect(renderErrors).toEqual([]);
  state.status.mockResolvedValue(ready);
  await expect.poll(() => dialog.querySelector<HTMLButtonElement>('.remote-desktop-connect')?.disabled, { timeout: 5000 }).toBe(false);
  expect(dialog.querySelector('progress')).toBeNull();
});

it.each(['failed', 'cancelled'])('allows another preparation after components are %s without reloading the page', async outcome => {
  const setupRequired: RemoteDesktopStatus = { ...ready, capabilities: { ...ready.capabilities, backend: '', state: 'setup_required', screen: false, input: false, displays: [] } };
  const setup = { state: 'checking', operation_id: 'task-preparation', expected_bytes: 0, received_bytes: 0, can_cancel: true };
  state.status.mockResolvedValue(setupRequired);
  state.prepare.mockImplementation(async () => {
    state.status.mockResolvedValue({ ...setupRequired, setup });
    return setup;
  });
  const { dialog, copy } = await launch(390);
  const prepare = () => page.elementLocator(dialog).getByRole('button', { name: copy.t('remoteDesktop.prepare'), exact: true });
  await userEvent.click(prepare());
  await expect.poll(() => dialog.querySelector('progress')).not.toBeNull();
  expect(renderErrors).toEqual([]);
  const finished = { ...setup, state: outcome, can_cancel: false, error_code: outcome === 'failed' ? 'download_failed' : undefined };
  if (outcome === 'cancelled') {
    state.cancel.mockImplementation(async () => {
      state.status.mockResolvedValue({ ...setupRequired, setup: finished });
      return finished;
    });
    await userEvent.click(page.elementLocator(dialog).getByRole('button', { name: copy.t('remoteDesktop.cancel'), exact: true }));
    expect(state.cancel).toHaveBeenCalledWith('task-preparation');
  } else state.status.mockResolvedValue({ ...setupRequired, setup: finished });
  await expect.poll(() => dialog.querySelector('progress'), { timeout: 5000 }).toBeNull();
  if (outcome === 'failed') expect(dialog.querySelector('[role=alert]')?.textContent).toContain('download_failed');
  await userEvent.click(prepare());
  await expect.poll(() => dialog.querySelector('progress')).not.toBeNull();
  expect(state.prepare).toHaveBeenCalledTimes(2);
  expect(dialog.querySelector('[role=alert]')).toBeNull();
});

it('does not report permission reuse as enabled when saving fails', async () => {
  state.status.mockResolvedValue({ ...ready, capabilities: { ...ready.capabilities, backend: 'wayland', state: 'ready', authorization: 'needs_consent' } });
  state.save.mockRejectedValue(new LocalApiError({ status: 403, code: 'DESKTOP_FORBIDDEN', message: 'Permission required' }));
  const { dialog, copy } = await launch(390);
  await userEvent.click(dialog.querySelector('summary')!);
  const input = dialog.querySelector<HTMLInputElement>('.remote-desktop-sharing [role=switch]')!;
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

it.each(SUPPORTED_LOCALES)('offers persistent Wayland approval before connecting in %s', async locale => {
  state.locale = locale;
  const wayland = { ...ready, capabilities: { ...ready.capabilities, backend: 'wayland', state: 'ready', authorization: 'needs_consent' } };
  state.status.mockResolvedValue(wayland);
  const { dialog, copy } = await launch(320);
  const sharing = page.elementLocator(dialog).getByRole('switch', { name: copy.t('remoteDesktop.unattended') });
  await expect.element(sharing).toBeVisible();
  expect(dialog.querySelector('.remote-desktop-sharing')?.closest('details')).toBeNull();
  expect(state.save).not.toHaveBeenCalled();
  expectSingleLineButtonLabels(dialog);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  expect(dialog.getBoundingClientRect().height).toBeLessThan(800);
  if (locale === 'zh-CN') await page.screenshot({ element: dialog, path: '__screenshots__/remote-desktop-remember-approval.png' });
  state.save.mockResolvedValue({ unattended: true });
  state.status.mockResolvedValue({ ...wayland, unattended: true });
  dialog.querySelector<HTMLInputElement>('.remote-desktop-sharing [role=switch]')!.focus();
  await userEvent.keyboard(' ');
  await expect.poll(() => state.save.mock.calls).toEqual([[true]]);
  await expect.poll(() => dialog.querySelector('.remote-desktop-state')?.textContent).toContain(copy.t('remoteDesktop.approvalNeeded'));
  expect(dialog.querySelector('.remote-desktop-guidance')).not.toBeNull();
});


it.each(SUPPORTED_LOCALES)('confirms local approval reset and restores keyboard focus in %s', async locale => {
  state.locale = locale;
  const wayland = { ...ready, unattended: true, capabilities: { ...ready.capabilities, backend: 'wayland', authorization: 'saved' } };
  state.status.mockResolvedValue(wayland);
  const { dialog, copy } = await launch(320);
  expect(dialog.querySelector<HTMLInputElement>('.remote-desktop-sharing [role=switch]')!.checked).toBe(true);
  expect(dialog.querySelector('.remote-desktop-state')?.textContent).toContain(copy.t('remoteDesktop.approvalSaved'));
  await userEvent.click(dialog.querySelector('summary')!);
  const reset = page.elementLocator(dialog).getByRole('button', { name: copy.t('remoteDesktop.approvalForget'), exact: true });
  reset.element().focus(); await userEvent.keyboard('{Enter}');
  const confirm = page.getByRole('button', { name: copy.t('remoteDesktop.approvalForgetConfirm'), exact: true });
  await expect.element(confirm).toBeVisible();
  const modal = confirm.element().closest('[role=dialog]')!;
  await Promise.allSettled(modal.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
  await expect.poll(() => modal.contains(document.activeElement)).toBe(true);
  expect(modal.textContent).toContain(copy.t('remoteDesktop.approvalForgetHint'));
  expect(modal.scrollWidth).toBeLessThanOrEqual(modal.clientWidth);
  expectSingleLineButtonLabels(modal);
  expect(state.forget).not.toHaveBeenCalled();
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.activeElement).toBe(reset.element());
  expect(state.forget).not.toHaveBeenCalled();
  await reset.click();
  state.forget.mockResolvedValue({ authorization: 'needs_consent' });
  state.status.mockResolvedValue({ ...wayland, capabilities: { ...wayland.capabilities, authorization: 'needs_consent' } });
  await confirm.click();
  await expect.poll(() => state.forget.mock.calls.length).toBe(1);
  await expect.poll(() => dialog.querySelector('.remote-desktop-state')?.textContent).toContain(copy.t('remoteDesktop.approvalNeeded'));
});

it('closes only the ready reset confirmation after a pointer opening', async () => {
  state.locale = 'en-US';
  state.status.mockResolvedValue({ ...ready, unattended: true, capabilities: { ...ready.capabilities, backend: 'wayland', authorization: 'saved' } });
  const { dialog, copy } = await launch(320);
  await userEvent.click(dialog.querySelector('summary')!);
  await page.elementLocator(dialog).getByRole('button', { name: copy.t('remoteDesktop.approvalForget'), exact: true }).click();
  const modal = page.getByRole('button', { name: copy.t('remoteDesktop.approvalForgetConfirm'), exact: true }).element().closest('[role=dialog]')!;
  await Promise.allSettled(modal.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
  await expect.poll(() => modal.contains(document.activeElement)).toBe(true);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => modal.isConnected).toBe(false);
  expect(dialog.isConnected).toBe(true);
  expect(state.forget).not.toHaveBeenCalled();
});
