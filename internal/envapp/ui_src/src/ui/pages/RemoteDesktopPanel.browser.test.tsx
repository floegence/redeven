import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { I18nProvider } from '../i18n/I18nProvider';
import { SUPPORTED_LOCALES } from '../i18n/localeMeta';
import { loadEnvAppDictionary } from '../i18n/locales';
import { writeStoredLanguagePreference } from '../i18n/storage';
import { RemoteDesktopPanel } from './RemoteDesktopPanel';

vi.mock('./EnvContext', () => ({ useEnvContext: () => ({
  env: () => ({ name: 'Qualification host', permissions: { can_read: true, can_write: true, can_execute: true } }),
  env_id: () => 'desktop-layout', localRuntime: () => ({}),
}) }));
vi.mock('../services/desktopSessionContext', async original => ({ ...await original<object>(), readDesktopSessionContextSnapshot: () => ({ label: 'Qualification host' }) }));
vi.mock('../services/desktopShellBridge', async original => ({ ...await original<object>(),
  desktopShellWebServiceWindowOpenAvailable: () => true,
  remoteDesktopDeploymentInDesktopShell: async () => ({ ok: true, available: true }),
  onRemoteDesktopDeploymentProgress: () => () => {},
}));
vi.mock('../services/remoteDesktopApi', async original => ({ ...await original<object>(), getRemoteDesktopStatus: async () => ({
  capabilities: { backend: 'linux-drm-kms', state: 'setup_required', screen: false, input: false, audio: false, clipboard: false, unattended: true, displays: [] },
  login_service: { state: 'not_installed', backend: 'linux-drm-kms' },
  unattended: false, control_in_use: false, last_display_id: '',
}) }));

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); writeStoredLanguagePreference('system'); });

it.each(SUPPORTED_LOCALES)('centers the primary label and keeps SSH authorization usable in narrow %s windows', async locale => {
  await page.viewport(320, 780);
  await loadEnvAppDictionary(locale);
  writeStoredLanguagePreference(locale);
  const host = document.createElement('main'); document.body.append(host);
  dispose = render(() => <I18nProvider><RemoteDesktopPanel /></I18nProvider>, host);
  await expect.poll(() => document.documentElement.lang).toBe(locale);
  const primary = host.querySelector<HTMLButtonElement>('.remote-desktop-connect')!;
  await expect.poll(() => primary?.disabled).toBe(false);
  const button = primary.getBoundingClientRect();
  const label = primary.querySelector('span > span')!.getBoundingClientRect();
  const labelFontSize = Number.parseFloat(getComputedStyle(primary).fontSize);
  expect(label.height).toBeLessThan(labelFontSize * 1.7);
  expect(Math.abs(label.x + label.width / 2 - button.x - button.width / 2)).toBeLessThan(1);
  expect(button.right).toBeLessThanOrEqual(320);
  expect(primary.scrollWidth).toBeLessThanOrEqual(primary.clientWidth + 1);
  await userEvent.click(primary);
  await expect.poll(() => document.querySelector('[role=dialog]')).not.toBeNull();
  const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  for (const control of dialog.querySelectorAll<HTMLElement>('input, button')) {
    const rect = control.getBoundingClientRect();
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(320);
    expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth + 1);
  }
});
