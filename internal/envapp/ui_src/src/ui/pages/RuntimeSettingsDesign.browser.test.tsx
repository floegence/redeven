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

it('keeps long configuration paths with their copy action in the value column', async () => {
  await mount();
  const panel = await openSection('config');
  const code = panel.querySelector('code')!;
  const control = code.closest('.floe-setting-row__control');
  expect(control).not.toBeNull();
  expect(control?.querySelector('button')).not.toBeNull();
  expect(code.textContent).toBe(fixture.settings().config_path);
  expect(panel.querySelector('.floe-setting-row__children')).toBeNull();
});

it('places root identity and permission controls in separate aligned columns', async () => {
  await mount();
  const panel = await openSection('runtime');
  const roots = [...panel.querySelectorAll<HTMLElement>('.runtime-filesystem-root')];
  expect(roots).toHaveLength(3);
  for (const root of roots) {
    const label = root.querySelector('.floe-setting-row__label')!;
    const controls = root.querySelector('.floe-setting-row__control')!;
    expect(label).not.toBeNull();
    expect(controls).not.toBeNull();
    expect(label.textContent).not.toContain('Write');
    expect(controls.getBoundingClientRect().left).toBeGreaterThan(label.getBoundingClientRect().right);
  }
});

it('keeps version actions compact and installation paths inside one closed disclosure', async () => {
  await mount();
  const panel = await openSection('codespaces');
  const rows = [...panel.querySelectorAll<HTMLElement>('.redeven-settings-version-row')];
  expect(rows).toHaveLength(2);
  for (const row of rows) {
    expect(row.textContent).not.toContain('/Users/');
    expect(row.querySelector('.floe-setting-row__control')).not.toBeNull();
    expect(row.getBoundingClientRect().height).toBeLessThan(100);
  }
  expect(rows[0].querySelectorAll('button')).toHaveLength(0);
  const details = panel.querySelector<HTMLDetailsElement>('details.code-runtime-details')!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain('/versions/4.108.2/bin/code-server');
  await userEvent.click(details.querySelector('summary')!);
  expect(details.open).toBe(true);
  expectNoOverflow(panel);
});

it('pairs custom port fields in the value column without duplicating the range', async () => {
  await mount();
  const panel = await openSection('codespaces');
  const min = panel.querySelector<HTMLInputElement>('#settings-port-min')!;
  const max = panel.querySelector<HTMLInputElement>('#settings-port-max')!;
  expect(min.closest('.floe-setting-row__control')).toBe(max.closest('.floe-setting-row__control'));
  expect(min.closest('.floe-setting-row__control')).not.toBeNull();
  expect(Math.abs(min.getBoundingClientRect().top - max.getBoundingClientRect().top)).toBeLessThan(1);
  expect(min.closest('.floe-setting-row')?.querySelector('code')).toBeNull();
});

it.each([1280, 1024, 768, 390, 320])('keeps all ten pages readable without overflow at %ipx', async (width) => {
  await mount(width);
  for (const item of SETTINGS_NAV_ITEMS) {
    const panel = await openSection(item.id); expectNoOverflow(panel);
    expect(panel.querySelectorAll('h1')).toHaveLength(1);
    expect(getComputedStyle(panel.querySelector('h1')!).fontSize).toBe('25px');
    expect(getComputedStyle(panel.querySelector('h1')!).fontWeight).toBe('600');
    for (const description of panel.querySelectorAll('.floe-setting-row__label p')) {
      expect(getComputedStyle(description).fontSize).toBe('12px');
    }
    expect(getComputedStyle(panel.querySelector('.floe-settings-section__heading > p')!).fontSize).toBe('13px');
    if (item.id === 'config') {
      expect(getComputedStyle(panel.querySelector('code')!).fontSize).toBe('12px');
    }
    if (width === 1280) {
      const content = panel.querySelector<HTMLElement>('.redeven-settings-page')!;
      expect(content.getBoundingClientRect().width).toBe(860);
      expect(getComputedStyle(content).padding).toBe('44px 40px 64px');
      for (const list of content.querySelectorAll<HTMLElement>('.floe-settings-list')) {
        expect(getComputedStyle(list).borderRadius).toBe('14px');
      }
      await page.screenshot({ path: `../../../dist/settings-design/runtime-settings-${item.id}.png` });
    }
  }
});

it('prioritizes current connection and workload while disclosing identifiers and maintenance metadata', async () => {
  await mount(1280);
  const connection = await openSection('connection');
  const details = connection.querySelector<HTMLDetailsElement>('.connection-details')!;
  expect(details.open).toBe(false);
  expect(details.textContent).toContain('env_design_workspace');
  expect(details.textContent).toContain('runtime_macos_arm64');
  expect(connection.textContent).not.toContain('Connection information incomplete');
  fixture.context.mutateSettings({ ...fixture.settings(), connection: { direct: { artifact_provisioned: false } } } as typeof fixture.settings extends () => infer T ? T : never);
  await expect.element(page.getByText('Connected', { exact: true })).toBeVisible();
  const runtime = await openSection('agent');
  expect(runtime.querySelectorAll('.runtime-status-summary > .redeven-setting-row')).toHaveLength(4);
  const runtimeDetails = runtime.querySelector<HTMLDetailsElement>('.runtime-status-details')!;
  expect(runtimeDetails.open).toBe(false);
  expect(runtimeDetails.textContent).toContain('release-2026-09');
  expect(runtimeDetails.textContent).toContain('Runtime protocol');
});

it('edits directory identity separately and confirms write permission before saving', async () => {
  await mount();
  await openSection('runtime');
  const before = fixture.settings().runtime.filesystem_scope!.roots;
  await page.getByRole('button', { name: 'Edit directory', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Path', exact: true }).fill('/workspace/edited');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(fixture.settings().runtime.filesystem_scope!.roots).toEqual(before);
  await page.getByRole('button', { name: 'Edit directory', exact: true }).click();
  await page.getByRole('dialog').getByRole('textbox', { name: 'Path', exact: true }).fill('/workspace/edited');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect.poll(() => fixture.settings().runtime.filesystem_scope!.roots[2].path).toBe('/workspace/edited');
  await page.getByText('Allow writes', { exact: true }).click();
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(fixture.settings().runtime.filesystem_scope!.roots[2].permissions.write).toBe(false);
  await page.getByRole('dialog').getByRole('button', { name: 'Allow writes', exact: true }).click();
  await expect.poll(() => fixture.settings().runtime.filesystem_scope!.roots[2].permissions.write).toBe(true);
  fixture.setCanAdmin(false);
  await expect.element(page.getByRole('switch', { name: 'Allow writes', exact: true })).toBeDisabled();
  await expect.element(page.getByRole('button', { name: 'Edit directory', exact: true })).toBeDisabled();
});

it('keeps provider and skill diagnostics closed without hiding their actions', async () => {
  await mount();
  const models = await openSection('ai');
  const provider = models.querySelector<HTMLDetailsElement>('.settings-provider-details')!;
  expect(provider.open).toBe(false);
  await expect.element(page.getByRole('button', { name: 'Edit provider', exact: true })).toBeVisible();
  const skills = await openSection('skills');
  await expect.element(page.getByText('code-review', { exact: true })).toBeVisible();
  const detail = skills.querySelector<HTMLDetailsElement>('.settings-skill-details')!;
  expect(detail.open).toBe(false);
  expect(detail.textContent).toContain('/Users/alex/.redeven/skills/code-review');
  await userEvent.click(detail.querySelector('summary')!);
  await expect.element(page.getByRole('button', { name: 'Reinstall', exact: true })).toBeVisible();
});

it('cancels a new directory without saving an empty filesystem root', async () => {
  await mount();
  await openSection('runtime');
  await page.getByRole('button', { name: 'Add Root', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect.element(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Path', exact: true }).fill('/workspace/draft');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(fixture.requests.filter(request => request.url.endsWith('/api/settings'))).toHaveLength(0);
  expect(fixture.settings().runtime.filesystem_scope!.roots).toHaveLength(3);
});

it('saves permission table changes, narrows grants to the ceiling, and prevents reader edits', async () => {
  await mount();
  await openSection('permission_policy');
  const write = page.getByRole('checkbox', { name: 'user_design_reviewer: Write', exact: true });
  await userEvent.click(host.querySelector<HTMLInputElement>('input[aria-label="user_design_reviewer: Write"]')!.closest('label')!);
  await expect.poll(() => fixture.settings().permission_policy?.by_user?.user_design_reviewer.write).toBe(true);
  await userEvent.click([...host.querySelectorAll('.settings-permission-ceiling label')].find(label => label.textContent === 'Write')!);
  await expect.element(write).toBeDisabled();
  await expect.element(write).not.toBeChecked();
  await expect.poll(() => fixture.settings().permission_policy?.by_user?.user_design_reviewer.write).toBe(false);
  expect(fixture.settings().permission_policy?.local_max?.write).toBe(false);
  fixture.setCanAdmin(false);
  await expect.element(page.getByRole('textbox', { name: 'User', exact: true })).toBeDisabled();
  await expect.element(page.getByRole('checkbox', { name: 'Read', exact: true })).toBeDisabled();
});

it('selects default Flower permissions with the keyboard and saves the chosen policy', async () => {
  await mount();
  await openSection('ai');
  await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
  const selected = page.getByRole('radio', { name: /Approval required/ });
  await expect.element(selected).toBeVisible();
  await selected.click();
  await userEvent.keyboard('{ArrowDown}');
  await expect.poll(() => fixture.settings().ai?.permission_type).toBe('full_access');
  expect(document.activeElement?.getAttribute('aria-checked')).toBe('true');
  fixture.setCanAdmin(false);
  await expect.element(page.getByRole('radio', { name: /Full access/ })).toBeDisabled();
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
  await page.screenshot({ path: '../../../dist/settings-design/runtime-settings-provider-mobile.png' });
});

it('switches Flower groups without losing permissions or health access and respects read-only state', async () => {
  await mount(1280, true);
  await openSection('ai');
  await page.getByRole('tab', { name: 'Permissions', exact: true }).click();
  await expect.element(page.getByText('Approval required', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Health & storage', exact: true }).click();
  await expect.element(page.getByText('Flower backups', { exact: true })).toBeVisible();
  const health = host.querySelector('[data-flower-settings-panel="health"]')!;
  const backupButton = [...health.querySelectorAll('button')].find(button => button.textContent === 'View backups')!;
  expect(backupButton.closest('.floe-setting-row__control')).not.toBeNull();
  await page.screenshot({ path: '../../../dist/settings-design/runtime-settings-health-dark.png' });
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
  await page.getByRole('spinbutton', { name: 'Starting port', exact: true }).fill('22000');
  await page.getByRole('spinbutton', { name: 'Ending port', exact: true }).fill('23000');
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
