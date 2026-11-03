import '../../index.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { EnvSettingsPage } from './EnvSettingsPage';
import { createRuntimeSettingsFixture } from '../../../scripts/fixtures/runtime-settings/fixture';
import { I18nProvider, useI18n } from '../i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import type { RedevenLocale } from '../i18n/localeMeta';
import type { CodeRuntimeStatus } from '../services/codeRuntimeApi';

let host: HTMLDivElement;
let dispose: (() => void) | undefined;
let fixture: ReturnType<typeof createRuntimeSettingsFixture>;
let activeLocale: () => RedevenLocale;
function LocaleProbe() { activeLocale = useI18n().locale; return null; }
const prepare = vi.fn();
const cancel = vi.fn();
const refresh = vi.fn();
const selectVersion = vi.fn();
const removeVersion = vi.fn();
function missingStatus(): CodeRuntimeStatus {
  return {
    ...fixture.context.codeRuntimeStatus()!,
    active_runtime: { present: false, detection_state: 'missing', source: 'none' },
    managed_runtime: { present: false, detection_state: 'missing', source: 'none' },
    managed_runtime_source: 'none', managed_runtime_version: '', installed_versions: [],
    operation: { state: 'idle', log_tail: [] },
  };
}
async function mount(width = 1440, dark = false, locale: RedevenLocale = 'en-US') {
  await page.viewport(width, 900);
  localStorage.removeItem('codespaces-settings-theme');
  localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
  host = document.createElement('div'); host.style.height = '880px'; document.body.append(host);
  dispose = render(() => {
    fixture = createRuntimeSettingsFixture();
    fixture.setActiveSection('codespaces');
    fixture.setCodeRuntimeStatus(missingStatus());
    fixture.context.setCodeRuntimeInstallMethod('desktop_transfer');
    return <FloeProvider config={{ theme: { storageKey: 'codespaces-settings-theme', defaultTheme: dark ? 'dark' : 'light' } }}>
      <I18nProvider><LocaleProbe /><EnvSettingsPage context={{ ...fixture.context, prepareManagedCodeRuntime: prepare, cancelManagedCodeRuntimeOperation: cancel, refreshCodeRuntimeStatus: refresh, selectManagedCodeRuntimeVersion: selectVersion, removeManagedCodeRuntimeVersion: removeVersion }} /></I18nProvider>
    </FloeProvider>;
  }, host);
  await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(dark);
  await expect.poll(() => host.querySelector('.browser-editor-setup__method-selector')).not.toBeNull();
  await expect.poll(() => activeLocale()).toBe(locale);
  await expect.poll(() => getComputedStyle(host.querySelector('#settings-port-min')!).opacity).toBe('1');
  await document.fonts.ready;
  return host.querySelector<HTMLElement>('.codespaces-settings')!;
}
function expectNoOverflow(panel: HTMLElement) {
  const bounds = panel.getBoundingClientRect();
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
  for (const element of panel.querySelectorAll<HTMLElement>('button, input, [role="radiogroup"], .browser-editor-setup__step-label')) {
    if (!element.getClientRects().length) continue;
    const box = element.getBoundingClientRect();
    expect(box.left, element.textContent ?? '').toBeGreaterThanOrEqual(bounds.left - 1);
    expect(box.right, element.textContent ?? '').toBeLessThanOrEqual(bounds.right + 1);
  }
}
afterEach(() => {
  dispose?.(); host?.remove(); vi.clearAllMocks();
  localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY);
  document.documentElement.classList.remove('dark');
});

it.each([
  { width: 1440, dark: false, locale: 'en-US' as const },
  { width: 1440, dark: true, locale: 'en-US' as const },
  { width: 390, dark: false, locale: 'en-US' as const },
  { width: 320, dark: false, locale: 'en-US' as const },
  { width: 1024, dark: false, locale: 'en-US' as const },
  { width: 390, dark: true, locale: 'en-US' as const },
  { width: 390, dark: false, locale: 'zh-TW' as const },
  { width: 390, dark: false, locale: 'de-DE' as const },
])('keeps setup concise, accessible and within the viewport ($width, $dark, $locale)', async ({ width, dark, locale }) => {
  const panel = await mount(width, dark, locale);
  expect(panel.querySelectorAll('h2')).toHaveLength(2);
  expect(panel.querySelector('.browser-editor-setup__header')).toBeNull();
  expect(panel.querySelector('.browser-editor-setup__progress')).toBeNull();
  expect(panel.querySelector('.browser-editor-setup__summary')).toBeNull();
  expect(panel.querySelectorAll('.browser-editor-setup__install-action')).toHaveLength(1);
  const details = panel.querySelector('details')!;
  expect(details.open).toBe(false);
  expectNoOverflow(panel);
  // The primary setup and ports remain visible together even on a phone.
  expect(panel.querySelector('#settings-port-max')!.getBoundingClientRect().bottom).toBeLessThan(880);
  const audit = await axe.run(panel);
  expect(audit.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  await page.screenshot({ path: `../../../dist/codespaces-settings/setup-${width}-${dark ? 'dark' : 'light'}-${locale}.png` });
});

it('keeps method keyboard selection, cancellation, retry and ready inventory connected to their actions', async () => {
  const panel = await mount();
  const desktop = page.getByRole('radio', { name: 'Desktop transfer', exact: true });
  const remote = page.getByRole('radio', { name: 'Environment download', exact: true });
  await desktop.click();
  await userEvent.keyboard('{ArrowRight}');
  await expect.element(remote).toHaveAttribute('aria-checked', 'true');
  expect(fixture.context.codeRuntimeInstallMethod()).toBe('remote_download');
  await page.getByRole('button', { name: 'Download and install', exact: true }).click();
  expect(prepare).toHaveBeenCalledTimes(1);
  fixture.setCodeRuntimeStatus({ ...missingStatus(), operation: { state: 'running', action: 'prepare_workspace_engine', install_method: 'remote_download', stage: 'downloading', log_tail: [] } });
  await expect.element(remote).toBeDisabled();
  await expect.element(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible();
  expect(panel.querySelector('.browser-editor-setup__progress')).not.toBeNull();
  expectNoOverflow(panel);
  await page.screenshot({ path: '../../../dist/codespaces-settings/installing.png' });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(cancel).toHaveBeenCalledTimes(1);
  fixture.setCodeRuntimeStatus({ ...missingStatus(), operation: { state: 'failed', action: 'prepare_workspace_engine', install_method: 'remote_download', last_error: 'Download interrupted.', log_tail: ['Download interrupted.'] } });
  await page.getByRole('button', { name: 'Retry setup', exact: true }).click();
  expect(prepare).toHaveBeenCalledTimes(2);
  await expect.element(page.getByText('Last attempt used Environment download. Download interrupted.', { exact: true })).toBeVisible();
  await page.screenshot({ path: '../../../dist/codespaces-settings/failed.png' });
  fixture.setCodeRuntimeStatus({ ...missingStatus(), active_runtime: { present: true, detection_state: 'ready', source: 'managed', version: '4.109.1' }, managed_runtime: { present: true, detection_state: 'ready', source: 'managed', version: '4.109.1' }, managed_runtime_source: 'managed', managed_runtime_version: '4.109.1', installed_versions: [{ version: '4.109.1', selected_by_local_environment: true, removable: false, detection_state: 'ready' }] });
  await expect.element(page.getByRole('button', { name: 'Update Browser Editor', exact: true })).toBeVisible();
  expect(panel.querySelector('.browser-editor-setup')).toBeNull();
  expect(panel.querySelector('details.code-runtime-versions')?.hasAttribute('open')).toBe(false);
  await page.screenshot({ path: '../../../dist/codespaces-settings/ready.png' });
  await page.getByRole('button', { name: 'Update Browser Editor', exact: true }).click();
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(prepare).toHaveBeenCalledTimes(2);
});

it('keeps setup and port mutation unavailable for a read-only viewer', async () => {
  const panel = await mount(390);
  fixture.setCanAdmin(false);
  await expect.poll(() => panel.querySelector('.browser-editor-setup__install-action')).toBeNull();
  await expect.element(page.getByRole('spinbutton', { name: 'Starting port', exact: true })).toBeDisabled();
  expect(prepare).not.toHaveBeenCalled();
});

it('keeps version selection and removal reachable through the collapsed inventory', async () => {
  const panel = await mount();
  fixture.setCodeRuntimeStatus({
    ...missingStatus(),
    active_runtime: { present: true, detection_state: 'ready', source: 'managed', version: '4.109.1' },
    managed_runtime: { present: true, detection_state: 'ready', source: 'managed', version: '4.109.1' },
    managed_runtime_source: 'managed', managed_runtime_version: '4.109.1',
    installed_versions: ['4.109.1', '4.108.2'].map((version, index) => ({ version, selected_by_local_environment: index === 0, removable: index !== 0, detection_state: 'ready' })),
  });
  await expect.poll(() => panel.querySelector('details.code-runtime-versions')).not.toBeNull();
  await userEvent.click(panel.querySelector('details.code-runtime-versions > summary')!);
  await page.getByRole('button', { name: 'Use this version', exact: true }).click();
  expect(selectVersion).toHaveBeenCalledWith('4.108.2');
  await page.getByRole('button', { name: 'Remove version', exact: true }).click();
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(removeVersion).not.toHaveBeenCalled();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove version', exact: true }).click();
  expect(removeVersion).toHaveBeenCalledWith('4.108.2');
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
});
