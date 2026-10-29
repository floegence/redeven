import '../../index.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ManagedServiceSettingsDrawer } from './ManagedServiceSettingsDrawer';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../services/localApi', () => ({ fetchLocalApiJSON: api.request }));
vi.mock('../services/filesystemPicker', () => ({ useEnvFilesystemPicker: () => ({}) }));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

it.each([1280, 390])('keeps service sections readable with reachable actions at %ipx', async width => {
  await page.viewport(width, 900);
  api.request.mockResolvedValue({ service_id: 'design-service', name: 'Development API', access_mode: 'unified_proxy',
    deployment: 'container', template_source: 'custom', observed_state: 'stopped', configuration_revision: 3,
    configuration_sha256: 'fixture-sha', parameters: {}, parameter_definitions: [],
    runtime: { container: { entrypoint: '', command: [], environment: [], labels: {}, restart_policy: 'no',
      network_mode: 'bridge', ports: [], mounts: [], cpus: 2, memory_bytes: 4294967296, pids_limit: 512,
      shm_size_bytes: 0, cap_add: [], cap_drop: ['ALL'], devices: [], privileged: false, read_only_root: true,
      security_opts: ['no-new-privileges:true'], user: '' } } });
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeProvider><ManagedServiceSettingsDrawer open serviceID="design-service" serviceName="Development API"
    canManage onOpenChange={() => {}} onChanged={() => {}} onRequestStop={() => {}} onDuplicateTemplate={() => {}}
    onApply={async () => {}} /></FloeProvider>, host);
  await expect.element(page.getByTestId('managed-service-settings')).toBeVisible();
  const navigation = document.querySelector('.managed-settings-navigation')!;
  for (const button of navigation.querySelectorAll('button')) {
    await userEvent.click(button);
    const content = document.querySelector<HTMLElement>('.managed-settings-content')!;
    expect(content.scrollWidth, button.textContent ?? '').toBeLessThanOrEqual(content.clientWidth + 1);
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    const footer = dialog.querySelector('[data-floe-dialog-footer]')!;
    expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(900);
    if (width === 1280) await page.screenshot({ path: `../../../dist/settings-design/managed-settings-${button.textContent?.trim().replaceAll(' ', '-').toLowerCase()}.png` });
  }
  await userEvent.click(navigation.querySelector('button')!);
  const fields = [...document.querySelectorAll<HTMLElement>('.managed-settings-fields > label')];
  expect(fields).toHaveLength(2);
  if (width === 1280) {
    const label = fields[0].firstElementChild!.getBoundingClientRect();
    const input = fields[0].querySelector('input')!.getBoundingClientRect();
    expect(input.left - label.right).toBeGreaterThanOrEqual(27);
  }
  await page.screenshot({ path: `../../../dist/settings-design/managed-settings-overview-${width}.png` });
});


it('retains unsaved fields on reopening and fences reads from another service', async () => {
  await page.viewport(1280, 900);
  const value = (id: string) => ({ service_id: id, name: id, description: '', access_mode: 'unified_proxy', deployment: 'host', template_source: 'custom', observed_state: 'stopped', configuration_revision: 3, configuration_sha256: 'fixture', parameters: {}, parameter_definitions: [], runtime: { host: {} } });
  const [open, setOpen] = createSignal(true);
  const [id, setID] = createSignal('one');
  api.request.mockReset().mockResolvedValue(value('one'));
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeProvider><ManagedServiceSettingsDrawer open={open()} serviceID={id()} serviceName={id()} canManage onOpenChange={setOpen} onChanged={() => {}} onRequestStop={() => {}} onDuplicateTemplate={() => {}} onApply={async () => {}} /></FloeProvider>, host);
  await expect.element(page.getByTestId('managed-service-settings')).toBeVisible();
  const name = () => document.querySelector<HTMLInputElement>('.managed-settings-fields input')!;
  await userEvent.fill(name(), 'Unsaved name');
  setOpen(false);
  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
  let finish!: (value: unknown) => void;
  api.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  setOpen(true);
  await expect.poll(() => name()?.value).toBe('Unsaved name');
  const retained = name();
  finish(value('server changed'));
  await expect.poll(() => document.querySelector('[data-testid="managed-service-settings"]')?.getAttribute('aria-busy')).toBe('false');
  expect(name()).toBe(retained);
  expect(name().value).toBe('Unsaved name');
  setOpen(false); await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
  api.request.mockRejectedValueOnce(new Error('Refresh unavailable')); setOpen(true);
  await expect.element(page.getByRole('alert')).toHaveTextContent('Refresh unavailable');
  expect(name().value).toBe('Unsaved name');
  await expect.element(page.getByRole('button', { name: 'Save details', exact: true })).toBeDisabled();
  api.request.mockResolvedValueOnce(value('one'));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Save details', exact: true })).toBeEnabled();
  api.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  setID('two');
  await expect.poll(() => api.request.mock.calls.at(-1)?.[0]).toContain('/two/settings');
  expect(document.querySelector('[data-testid="managed-service-settings"]')).toBeNull();
  api.request.mockResolvedValueOnce(value('three'));
  setID('three');
  await expect.poll(() => name()?.value).toBe('three');
  finish(value('two'));
  await Promise.resolve();
  expect(name().value).toBe('three');
});

it('exposes an actionable initial read failure and retries inside the same drawer', async () => {
  api.request.mockReset().mockRejectedValueOnce(new Error('Settings unavailable'));
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeProvider><ManagedServiceSettingsDrawer open serviceID="one" serviceName="one" canManage onOpenChange={() => {}} onChanged={() => {}} onRequestStop={() => {}} onDuplicateTemplate={() => {}} onApply={async () => {}} /></FloeProvider>, host);
  await expect.element(page.getByRole('alert')).toHaveTextContent('Settings unavailable');
  api.request.mockResolvedValueOnce({ service_id: 'one', name: 'Recovered', access_mode: 'unified_proxy', deployment: 'host', configuration_revision: 1, runtime: { host: {} } });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.element(page.getByTestId('managed-service-settings')).toBeVisible();
});
