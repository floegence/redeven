import '../../../index.css';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { ContainerSettingsPanel } from './ContainerSettingsPanel';
import type { ContainerServiceConfiguration } from '../../services/containerResourcesApi';

const api = vi.hoisted(() => ({ list: vi.fn(), configuration: vi.fn(), preflight: vi.fn(), create: vi.fn() }));
vi.mock('../EnvContext', () => ({ useEnvContext: () => ({ env_id: () => 'container-settings-design', resourceCacheAccess: () => ({ phase: 'ready', generation: 0 }), env: () => ({ permissions: { can_read: true, can_write: true, can_execute: true, can_admin: true } }), openSettings: vi.fn() }) }));
vi.mock('./EnvSettingsPageContext', () => ({ useEnvSettingsPage: () => ({ canInteract: () => true, canAdmin: () => true }) }));
vi.mock('../../services/containerResourcesApi', async original => ({ ...await original<object>(), listContainerServices: api.list, getContainerServiceConfiguration: api.configuration, preflightContainerOperation: api.preflight, createContainerOperation: api.create }));
vi.mock('../../widgets/TextFilePreviewPane', () => ({ TextFilePreviewPane: (props: { path: string; draftText: string; onDraftChange: (value: string) => void }) => <textarea aria-label={props.path} value={props.draftText} onInput={event => props.onDraftChange(event.currentTarget.value)} /> }));
const configuration: ContainerServiceConfiguration = { service_id: 'docker-a', sources: [
  { source_id: 'engine', display_path: '/docker/daemon.json', status: 'ready', exists: true, format: 'json', sections: ['proxy', 'advanced'], apply_modes: ['save', 'save_and_restart'], base_revision: 'engine-a', http_proxy: '', https_proxy: '', no_proxy: '', content: '{}' },
  { source_id: 'docker_cli', display_path: '/docker/config.json', status: 'ready', exists: true, format: 'json', sections: ['general', 'proxy', 'credentials', 'advanced'], apply_modes: ['save'], base_revision: 'cli-a', content: '{"currentContext":"default","proxies":{"default":{}},"credsStore":"desktop","credHelpers":{"registry.example.com":"desktop"}}' },
] };
let dispose: (() => void) | undefined;
beforeEach(() => { api.list.mockResolvedValue([{ service_id: 'docker-a', name: 'Docker A', engine: 'docker', implementation: 'docker_engine', state: 'running', capabilities: { start: true, stop: true, restart: true }, configuration: { mode: 'local', sources: ['engine', 'docker_cli'] } }]); api.configuration.mockResolvedValue(configuration); });
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.clearAllMocks(); });
it.each([1100, 390])('uses one scrolling owner and aligned configuration rows at %ipx', async width => {
  await page.viewport(width, 900);
  const host = document.createElement('div'); host.style.padding = '20px'; document.body.append(host);
  dispose = render(() => <ContainerSettingsPanel resource="docker-a" />, host);
  await expect.element(page.getByRole('textbox', { name: 'HTTP proxy', exact: true })).toBeVisible();
  const content = host.querySelector('fieldset')!.parentElement!;
  expect(getComputedStyle(content).overflowY).toBe('visible');
  const header = content.querySelector(':scope > header')!;
  expect(header.querySelector('[role=tablist]')).not.toBeNull();
  const refresh = host.querySelector<HTMLButtonElement>('[data-settings-config-refresh]')!;
  expect(refresh.getAttribute('aria-label')).toBe('Refresh');
  expect([...host.querySelectorAll('button')].some(button => button.textContent?.includes('Save'))).toBe(false);
  refresh.click();
  await expect.poll(() => api.configuration.mock.calls.length).toBe(2);
  expect(api.list).toHaveBeenCalledTimes(2);
  const proxy = page.getByRole('textbox', { name: 'HTTP proxy', exact: true });
  await proxy.fill('http://proxy.example.com:3128');
  await expect.element(page.getByRole('button', { name: 'Save only', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Docker CLI', exact: true }).click();
  await expect.poll(() => [...host.querySelectorAll('button')].some(button => button.textContent?.includes('Save'))).toBe(false);
  expect([...host.querySelectorAll('button')].some(button => button.textContent?.includes('Discard'))).toBe(false);
  await page.getByRole('tab', { name: 'Engine', exact: true }).click();
  await expect.element(proxy).toHaveValue('http://proxy.example.com:3128');
  await expect.element(page.getByRole('button', { name: 'Save only', exact: true })).toBeVisible();
  for (const name of ['HTTP proxy', 'HTTPS proxy', 'No proxy']) {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
    expect(input.closest('.floe-setting-row')).not.toBeNull();
    expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  }
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
});

it.each([1100, 390])('keeps Docker CLI controls usable and drafts intact across tabs at %ipx', async width => {
  await page.viewport(width, 900);
  const host = document.createElement('div'); host.style.padding = '20px'; document.body.append(host);
  dispose = render(() => <ContainerSettingsPanel resource="docker-a" />, host);
  await page.getByRole('tab', { name: 'Docker CLI', exact: true }).click();
  await expect.element(page.getByRole('combobox', { name: 'Default context', exact: true })).toBeVisible();
  const detach = page.getByRole('textbox', { name: 'Detach keys', exact: true });
  await userEvent.type(detach, 'ctrl-a,ctrl-b');
  await expect.element(detach).toHaveValue('ctrl-a,ctrl-b');
  expect(document.activeElement).toBe(detach.element());
  await page.getByText('Command output formats', { exact: true }).click();
  await expect.element(page.getByRole('textbox', { name: 'docker ps', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Proxies', exact: true }).click();
  const proxy = page.getByLabelText('HTTP proxy', { exact: true });
  await userEvent.type(proxy, 'http://proxy.example.com:3128');
  await expect.element(proxy).toHaveValue('http://proxy.example.com:3128');
  expect(document.activeElement).toBe(proxy.element());
  expect((proxy.element() as HTMLInputElement).type).toBe('password');
  await page.getByRole('tab', { name: 'Credentials', exact: true }).click();
  const store = page.getByRole('textbox', { name: 'Default credential store', exact: true });
  await store.fill('osxkeychain');
  const helper = page.getByRole('textbox', { name: 'Credential helper', exact: true });
  await helper.fill('');
  await userEvent.type(helper, 'osxkeychain');
  await expect.element(helper).toHaveValue('osxkeychain');
  expect(document.activeElement).toBe(helper.element());
  for (const input of host.querySelectorAll<HTMLInputElement>('input')) {
    expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    expect(input.closest('.floe-setting-row')).not.toBeNull();
  }
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  const advancedEditor = page.getByRole('textbox', { name: '/docker/config.json', exact: true });
  await expect.element(advancedEditor).toBeVisible();
  const documentDraft = JSON.parse((advancedEditor.element() as HTMLTextAreaElement).value);
  expect(documentDraft).toMatchObject({ detachKeys: 'ctrl-a,ctrl-b', credsStore: 'osxkeychain', proxies: { default: { httpProxy: 'http://proxy.example.com:3128' } }, credHelpers: { 'registry.example.com': 'osxkeychain' } });
  await advancedEditor.fill('{');
  await expect.element(advancedEditor).toBeVisible();
  await expect.element(advancedEditor).toHaveValue('{');
  expect(document.activeElement).toBe(advancedEditor.element());
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('The Docker CLI file is invalid. Fix its JSON before editing it in Redeven.');
  await page.getByRole('tab', { name: 'Advanced', exact: true }).click();
  await expect.element(advancedEditor).toHaveValue('{');
  await advancedEditor.fill(JSON.stringify(documentDraft));
  await page.getByRole('tab', { name: 'General', exact: true }).click();
  await expect.element(page.getByRole('textbox', { name: 'Detach keys', exact: true })).toHaveValue('ctrl-a,ctrl-b');
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.poll(() => api.configuration.mock.calls.length).toBe(2);
  await expect.element(page.getByRole('tab', { name: 'Docker CLI', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect.element(page.getByRole('textbox', { name: 'Detach keys', exact: true })).toHaveValue('ctrl-a,ctrl-b');
  expect(api.preflight).not.toHaveBeenCalled();
  expect(api.create).not.toHaveBeenCalled();
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
});


it('presents unsupported engines without empty tabs or unavailable save actions', async () => {
  api.list.mockResolvedValue([{ service_id: 'remote', name: 'Remote Podman', engine: 'podman', implementation: 'podman', state: 'running', capabilities: {}, configuration: { mode: 'unsupported', sources: [] } }]);
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <ContainerSettingsPanel resource="remote" />, host);
  await expect.poll(() => host.querySelector('.container-service-config-unavailable')?.textContent).toContain('configuration');
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expect([...host.querySelectorAll('button')].some(button => button.textContent?.includes('Save'))).toBe(false);
  expect(api.configuration).not.toHaveBeenCalled();
});

it('shows engine identities in one grouped list without a duplicate selector', async () => {
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <ContainerSettingsPanel />, host);
  await expect.element(page.getByRole('button', { name: 'Docker A', exact: true })).toBeVisible();
  expect(host.querySelector('[role="combobox"]')).toBeNull();
  const list = host.querySelector('[data-settings-resource-list]');
  expect(list).not.toBeNull();
  expect(list?.querySelector('svg')).not.toBeNull();
  expect(api.configuration).not.toHaveBeenCalled();
});

it('uses the audited Docker and Podman brand assets in the settings inventory', async () => {
  await (commands as unknown as { installContainerServiceIconRoutes: () => Promise<void> }).installContainerServiceIconRoutes();
  api.list.mockResolvedValue(['docker', 'podman'].map(engine => ({ service_id: engine, name: engine, engine, configuration: { sources: [] } })));
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <ContainerSettingsPanel />, host);
  await expect.poll(() => host.querySelectorAll('.settings-resource-row').length).toBe(2);
  expect([...host.querySelectorAll<HTMLImageElement>('.settings-resource-row img')].map(image => image.getAttribute('src'))).toEqual(['/_redeven_proxy/env/container-service-icons/docker-default.svg', '/_redeven_proxy/env/container-service-icons/podman-default.svg']);
  // IMPORTANT: A correct URL is insufficient; the published icon must decode.
  for (const image of host.querySelectorAll<HTMLImageElement>('.settings-resource-row img')) {
    await image.decode();
    expect(image.naturalWidth).toBeGreaterThan(0);
  }
});
