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
  await expect.poll(() => host.querySelector('.host-apps-update-notice button')).toBeTruthy();
  const trigger = host.querySelector<HTMLButtonElement>('.host-apps-update-notice button')!;
  expect(state.start).not.toHaveBeenCalled();
  await userEvent.click(trigger);
  await expect.poll(() => document.querySelector('[role=dialog]')).toBeTruthy();
  const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
  await expect.poll(() => dialog.textContent).toContain(copy.t(state.missing ? 'hostApplications.prepare.hostDownload' : 'hostApplications.update.local'));
  // Evaluate final colors, not the modal's transparent entrance frame.
  await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
  return { host, dialog, trigger, copy };
}

it.each(builtInShellThemePresets)('keeps the optional update usable in $name', async preset => {
  document.documentElement.dataset.floeShellTheme = preset.name;
  document.documentElement.classList.add(preset.mode!);
  const { dialog, trigger, copy } = await openUpdate(preset.mode === 'dark' ? 390 : 1000);
  expect(dialog.textContent).toContain(copy.t('hostApplications.update.stabilityFix'));
  expect(dialog.querySelector('input[type=radio]')).toBeNull();
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  const versions = dialog.querySelector<HTMLElement>('dl')!;
  expect(versions.scrollWidth).toBeLessThanOrEqual(versions.clientWidth);
  const update = [...dialog.querySelectorAll('button')].find(button => button.textContent === copy.t('hostApplications.update.start'))!;
  expect(getComputedStyle(update).cursor).toBe('pointer');
  expect((await axe.run(dialog, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations).toEqual([]);
  if (preset.name.startsWith('porcelain-')) await page.screenshot({ element: dialog, path: `__screenshots__/components-${preset.name}.png` });
  await userEvent.keyboard('{Escape}');
  await expect.poll(() => document.querySelector('[role=dialog]')).toBeNull();
  await expect.poll(() => document.activeElement).toBe(trigger);
});

it.each(SUPPORTED_LOCALES)('localizes update, transfer size and keyboard actions in %s', async locale => {
  state.locale = locale; state.missing = 2500000;
  const { dialog, copy } = await openUpdate(360);
  expect(dialog.textContent).toContain(copy.t('hostApplications.update.title'));
  expect(dialog.textContent).toContain(new Intl.NumberFormat(locale, { style: 'unit', unit: 'megabyte', maximumFractionDigits: 1 }).format(2.5));
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  const input = dialog.querySelector<HTMLInputElement>('input[value=host]')!;
  expect(input.checked).toBe(true);
  const update = [...dialog.querySelectorAll('button')].find(button => button.textContent === copy.t('hostApplications.update.start'))!;
  state.start.mockResolvedValue({ ...status, state: 'validating', operation_id: 'update', can_cancel: true });
  update.focus(); await userEvent.keyboard('{Enter}');
  expect(state.start).toHaveBeenCalledWith(expect.any(String), 'download', 0, 'a'.repeat(64));
  if (locale === 'zh-CN') await page.screenshot({ element: dialog, path: '__screenshots__/components-zh-CN.png' });
});
