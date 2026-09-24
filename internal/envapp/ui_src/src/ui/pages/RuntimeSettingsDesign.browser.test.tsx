import '../../index.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { EnvSettingsPage } from './EnvSettingsPage';
import { SETTINGS_NAV_ITEMS } from './settings/settingsStructure';
import { createRuntimeSettingsFixture } from '../../../scripts/fixtures/runtime-settings/fixture';

const api = vi.hoisted(() => ({ request: async (_url: string, _init: RequestInit): Promise<unknown> => ({}) }));
vi.mock('../services/localApi', async (original) => ({ ...await original<typeof import('../services/localApi')>(), fetchLocalApiJSON: (url: string, init: RequestInit) => api.request(url, init) }));
let host: HTMLDivElement;
let dispose: (() => void) | undefined;
let fixture: ReturnType<typeof createRuntimeSettingsFixture>;
async function mount(width = 1280, dark = false) {
  await page.viewport(width, 800);
  localStorage.removeItem('runtime-settings-test-theme');
  host = document.createElement('div'); host.style.height = '780px'; document.body.append(host);
  dispose = render(() => {
    fixture = createRuntimeSettingsFixture(); api.request = fixture.request;
    return <FloeProvider config={{ theme: { storageKey: 'runtime-settings-test-theme', defaultTheme: dark ? 'dark' : 'light' } }}><EnvSettingsPage context={fixture.context} /></FloeProvider>;
  }, host);
  await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(dark);
}
async function openSection(id: typeof SETTINGS_NAV_ITEMS[number]['id']) {
  fixture.setActiveSection(id);
  await expect.element(page.getByTestId(`settings-section-${id}`).getByRole('heading', { level: 1 })).toBeVisible();
  return host.querySelector(`[data-testid="settings-section-${id}"]`)! as HTMLElement;
}
function expectNoOverflow(panel: HTMLElement) {
  expect(panel.scrollWidth, `${fixture.context.activeSection()} page width`).toBeLessThanOrEqual(panel.clientWidth + 1);
  for (const element of panel.querySelectorAll<HTMLElement>('input, [role="combobox"], .floe-setting-row__control')) {
    if (!element.getClientRects().length) continue;
    const box = element.getBoundingClientRect(); const bounds = panel.getBoundingClientRect();
    expect(box.right, `${fixture.context.activeSection()} field right edge`).toBeLessThanOrEqual(bounds.right + 1);
    expect(box.left, `${fixture.context.activeSection()} field left edge`).toBeGreaterThanOrEqual(bounds.left - 1);
  }
}
afterEach(() => { dispose?.(); host?.remove(); document.documentElement.classList.remove('dark'); });

it.each([1280, 1024, 768, 390, 320])('keeps all ten pages readable without overflow at %ipx', async (width) => {
  await mount(width);
  for (const item of SETTINGS_NAV_ITEMS) {
    const panel = await openSection(item.id); expectNoOverflow(panel);
    expect(panel.querySelectorAll('h1')).toHaveLength(1);
    expect(getComputedStyle(panel.querySelector('h1')!).fontSize).toBe('16px');
    expect(getComputedStyle(panel.querySelector('h1')!).fontWeight).toBe('500');
    if (width === 1280) await page.screenshot({ path: `runtime-settings-${item.id}.png` });
  }
});

it('retains drafts and scroll position when navigating, and saves real settings values', async () => {
  await mount();
  const panel = await openSection('runtime');
  const home = page.getByPlaceholder('/home/user');
  await home.fill('/workspace/new-home');
  panel.scrollTop = 120;
  const scrollTop = panel.scrollTop;
  await page.getByRole('button', { name: 'Logging', exact: true }).click();
  await expect.element(page.getByTestId('settings-section-logging').getByRole('heading', { level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Shell & Workspace', exact: true }).click();
  await expect.element(home).toHaveValue('/workspace/new-home');
  expect(panel.scrollTop).toBe(scrollTop);
  await expect.poll(() => fixture.settings().runtime.agent_home_dir).toBe('/workspace/new-home');
});

it('opens every provider step at a mobile width with a reachable footer', async () => {
  await mount(390);
  await openSection('ai');
  await page.getByRole('button', { name: 'Edit provider', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect.element(dialog).toBeVisible();
  for (const step of ['type', 'connection', 'models', 'advanced']) {
    const button = document.querySelector(`[data-provider-dialog-step="${step}"]`)!;
    await userEvent.click(button);
    const element = document.querySelector('[role="dialog"]') as HTMLElement;
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
    const save = [...element.querySelectorAll('button')].find((item) => item.textContent?.includes('Save Provider'))!;
    const bounds = save.getBoundingClientRect();
    expect(bounds.bottom).toBeLessThanOrEqual(800);
  }
  await page.screenshot({ path: 'runtime-settings-provider-mobile.png' });
});

it('switches Flower groups without losing permissions or health access and respects read-only state', async () => {
  await mount(1280, true);
  await openSection('ai');
  await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
  await expect.element(page.getByText('Approval required', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Health & storage', exact: true }).click();
  await expect.element(page.getByText('Flower backups', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'runtime-settings-health-dark.png' });
  fixture.setCanAdmin(false);
  await openSection('runtime');
  await expect.element(page.getByPlaceholder('/home/user')).toBeDisabled();
  await openSection('skills');
  await expect.element(page.getByRole('button', { name: 'Create Skill', exact: true })).toBeDisabled();
});

it('navigates through the mobile section picker and exposes storage recovery from the model page', async () => {
  await mount(390);
  await page.getByRole('button', { name: 'Config File', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Flower', exact: true }).click();
  await expect.element(page.getByTestId('settings-section-ai').getByRole('heading', { level: 1 })).toBeVisible();
  fixture.setReadinessSnapshot({ state: 'blocked', reason_code: 'store_integrity_error', retryable: false, safe_to_retry: false });
  const recovery = page.getByRole('button', { name: 'Health & storage', exact: true });
  await expect.element(recovery).toBeVisible();
  await recovery.click();
  await expect.element(page.getByText('Flower backups', { exact: true })).toBeVisible();
});

it('submits logging and port values using the flat settings API contract', async () => {
  await mount();
  await openSection('logging');
  await page.getByRole('button', { name: 'json', exact: true }).click();
  await page.getByRole('menuitem', { name: 'text', exact: true }).click();
  await expect.poll(() => fixture.settings().logging.log_format).toBe('text');
  await openSection('codespaces');
  await page.getByRole('textbox', { name: 'Starting port', exact: true }).fill('22000');
  await page.getByRole('textbox', { name: 'Ending port', exact: true }).fill('23000');
  await expect.poll(() => fixture.settings().codespaces.code_server_port_min).toBe(22000);
  await expect.poll(() => fixture.settings().codespaces.code_server_port_max).toBe(23000);
  await page.getByText('Use default port range', { exact: true }).click();
  await expect.poll(() => fixture.settings().codespaces.code_server_port_min).toBe(0);
});

it('keeps a failed autosave draft without retrying until the user edits it', async () => {
  await mount();
  await openSection('runtime');
  fixture.setSaveError('Workspace is unavailable');
  await page.getByPlaceholder('/home/user').fill('/workspace/unavailable');
  await expect.element(page.getByRole('alert')).toHaveTextContent('Workspace is unavailable');
  await new Promise((resolve) => setTimeout(resolve, 1600));
  expect(fixture.requests.filter((request) => request.url.endsWith('/api/settings'))).toHaveLength(1);
  await expect.element(page.getByPlaceholder('/home/user')).toHaveValue('/workspace/unavailable');
  fixture.setSaveError(null);
  await page.getByPlaceholder('/home/user').fill('/workspace/available');
  await expect.poll(() => fixture.settings().runtime.agent_home_dir).toBe('/workspace/available');
});
