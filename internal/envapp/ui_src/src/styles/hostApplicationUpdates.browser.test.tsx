import '../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { SUPPORTED_LOCALES, type RedevenLocale } from '../ui/i18n/localeMeta';
import { createTestI18nHelpers } from '../ui/i18n/locales/testDictionaries';
import { EnvHostApplicationsPage } from '../ui/pages/EnvHostApplicationsPage';

const state = vi.hoisted(() => ({ locale: 'en-US' as RedevenLocale, missing: 0, start: vi.fn() }));
const status = { state: 'ready', received_bytes: 0, expected_bytes: 176668991, can_cancel: false, update_available: true,
  installed: { id: 'alpine-3.23-xpra-6.2.2-amd64-r1', digest: 'c'.repeat(64), ready: true },
  package: { id: 'alpine-3.23-xpra-6.2.2-amd64-r2', digest: 'a'.repeat(64), architecture: 'amd64', size_bytes: 176668991 } };
vi.mock('../ui/i18n', () => ({ useI18n: () => ({ ...createTestI18nHelpers(state.locale), locale: () => state.locale }) }));
vi.mock('../ui/pages/EnvContext', () => ({ useEnvContext: () => ({ env: () => ({ permissions: { can_read: true, can_write: true, can_execute: true } }), env_id: () => 'fixture', localRuntime: () => ({}) }) }));
vi.mock('../ui/services/hostApplicationsApi', async importOriginal => ({
  ...await importOriginal<object>(),
  listHostApplications: async () => ({ availability: { supported: true, ready: true }, applications: [{ id: 'editor.desktop', name: 'Text Editor', description: '', categories: [], icon: '', custom: false }], sessions: [], running: [] }),
  listHostApplicationSessions: async () => [], listRunningHostApplications: async () => [],
  getHostApplicationSetup: async () => status,
  getHostApplicationTransferPlan: async () => ({ package_digest: 'a'.repeat(64), architecture: 'amd64', missing_artifacts: state.missing ? ['b'.repeat(64)] : [], missing_bytes: state.missing }),
  observeHostApplicationSetup: (_callback: unknown, signal: AbortSignal) => new Promise<void>(resolve => signal.addEventListener('abort', () => resolve())),
  startHostApplicationSetup: state.start,
}));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); document.documentElement.classList.remove('dark', 'light'); delete document.documentElement.dataset.floeShellTheme; state.locale = 'en-US'; state.missing = 0; vi.clearAllMocks(); });

async function openUpdate(width = 390) {
  await page.viewport(width, 850);
  const host = document.createElement('main');
  host.style.cssText = 'height:800px;background:var(--background);color:var(--foreground)';
  document.body.append(host);
  dispose = render(() => <EnvHostApplicationsPage />, host);
  const copy = createTestI18nHelpers(state.locale);
  const feedbackTrigger = host.querySelector<HTMLButtonElement>('[data-floe-status-indicator] button')!;
  await expect.poll(() => feedbackTrigger.getAttribute('aria-label')).toContain(copy.t('hostApplications.update.available'));
  expect(state.start).not.toHaveBeenCalled();
  await userEvent.click(feedbackTrigger);
  const updateDetails = page.getByRole('button', { name: copy.t('hostApplications.update.view'), exact: true });
  await expect.element(updateDetails).toBeVisible();
  const trigger = updateDetails.element() as HTMLButtonElement;
  await userEvent.click(trigger);
  await expect.poll(() => document.querySelector('.host-apps-dialog[role=dialog]')).toBeTruthy();
  const dialog = document.querySelector<HTMLElement>('.host-apps-dialog[role=dialog]')!;
  await expect.poll(() => dialog.textContent).toContain(copy.t(state.missing ? 'hostApplications.prepare.hostDownload' : 'hostApplications.update.local'));
  // Evaluate final colors, not the modal's transparent entrance frame.
  await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
  return { host, dialog, trigger, feedbackTrigger, copy };
}

it.each(builtInShellThemePresets)('keeps the optional update usable in $name', async preset => {
  document.documentElement.dataset.floeShellTheme = preset.name;
  document.documentElement.classList.add(preset.mode!);
  const { dialog, trigger, feedbackTrigger, copy } = await openUpdate(preset.mode === 'dark' ? 390 : 1000);
  expect(dialog.textContent).toContain(copy.t('hostApplications.update.stabilityFix'));
  expect(dialog.querySelector('input[type=radio], [role=radio]')).toBeNull();
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  const versions = dialog.querySelector<HTMLElement>('dl')!;
  expect(versions.scrollWidth).toBeLessThanOrEqual(versions.clientWidth);
  const update = page.elementLocator(dialog).getByRole('button', { name: copy.t('hostApplications.update.start'), exact: true }).element();
  expect(getComputedStyle(update).cursor).toBe('pointer');
  expect((await axe.run(dialog, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations).toEqual([]);
  if (preset.name.startsWith('porcelain-')) await page.screenshot({ element: dialog, path: `__screenshots__/components-${preset.name}.png` });
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('.host-apps-dialog[role=dialog]')).toBeNull();
  await expect.poll(() => document.activeElement).toBe(trigger);
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('[role=dialog]')).toBeNull();
  await expect.poll(() => document.activeElement).toBe(feedbackTrigger);
});

it.each(SUPPORTED_LOCALES)('localizes update, transfer size and keyboard actions in %s', async locale => {
  state.locale = locale; state.missing = 2500000;
  const { dialog, copy } = await openUpdate(360);
  expect(dialog.textContent).toContain(copy.t('hostApplications.update.title'));
  expect(dialog.textContent).toContain(new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(2.5));
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  const hostMethod = page.elementLocator(dialog).getByRole('radio', { name: copy.t('hostApplications.prepare.hostDownload') });
  await expect.element(hostMethod).toBeChecked();
  const update = page.elementLocator(dialog).getByRole('button', { name: copy.t('hostApplications.update.start'), exact: true }).element() as HTMLButtonElement;
  state.start.mockResolvedValue({ ...status, state: 'validating', operation_id: 'update', can_cancel: true });
  update.focus(); await userEvent.keyboard('{Enter}');
  expect(state.start).toHaveBeenCalledWith(expect.any(String), 'download', 0, 'a'.repeat(64));
  if (locale === 'zh-CN') await page.screenshot({ element: dialog, path: '__screenshots__/components-zh-CN.png' });
});

it.each(SUPPORTED_LOCALES)('shows cached and partially downloaded Desktop components accessibly in %s', async locale => {
  state.locale = locale;
  await page.viewport(360, 850);
  const { HostApplicationSetupPanel } = await import('../ui/pages/HostApplicationSetupPanel');
  const { createSignal } = await import('solid-js');
  const [progress, update] = createSignal<import('../ui/pages/HostApplicationSetupPanel').HostApplicationDesktopProgress>({ phase: 'packing', component_bytes: 10000000, cached_bytes: 10000000, download_bytes: 0, downloaded_bytes: 0 });
  const host = document.createElement('main'); document.body.append(host);
  dispose = render(() => <HostApplicationSetupPanel setup={{ ...status, state: 'available', installed: undefined, package: { ...status.package, architecture: 'amd64', installed_bytes: 100000000 } }} desktopProgress={progress()} plan={{ package_digest: 'a'.repeat(64), architecture: 'amd64', missing_artifacts: ['b'.repeat(64)], missing_bytes: 10000000 }}
    allowed submitting canRelay disconnected={false} downloadMethod="desktop" onDownloadMethodChange={() => {}}
    onStart={() => {}} onCancel={() => {}} onReconnect={() => {}} onUpload={() => {}} />, host);
  const copy = createTestI18nHelpers(locale);
  await expect.poll(() => host.textContent).toContain(copy.t('hostApplications.prepare.desktopCached'));
  expect(host.querySelector('[role=progressbar]')!.hasAttribute('aria-valuenow')).toBe(false);
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  expect((await axe.run(host, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations).toEqual([]);
  if (locale === 'zh-CN') await page.screenshot({ element: host, path: '__screenshots__/component-cache-zh-CN.png' });
  update({ phase: 'downloading', component_bytes: 10000000, cached_bytes: 6000000, download_bytes: 4000000, downloaded_bytes: 2000000 });
  await expect.poll(() => host.querySelector('[role=progressbar]')!.getAttribute('aria-valuenow')).toBe('50');
  expect(host.textContent).toContain(copy.t('hostApplications.prepare.desktopBytes', { cached: new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(6), download: new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(4) }));
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
});
