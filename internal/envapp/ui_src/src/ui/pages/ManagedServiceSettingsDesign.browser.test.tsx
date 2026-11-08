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
    const footer = dialog.querySelector('[data-managed-settings-footer]')!;
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

it('keeps a source update explicit and binds its exact digest to preflight', async () => {
  await page.viewport(1024,768);
  const oldSource = {sha256:'a'.repeat(64),revision:1,repository:'owner/repo',commit_sha:'a'.repeat(40)};
  const newSource = {...oldSource,sha256:'b'.repeat(64),revision:2,commit_sha:'b'.repeat(40)};
  const original = {service_id:'source-review',name:'Pinned service',access_mode:'unified_proxy',deployment:'host',template_source:'git',observed_state:'stopped',configuration_revision:1,configuration_sha256:'configuration',runtime:{host:{start_script:'exec old'}},source_version:oldSource,available_source_version:newSource};
  api.request.mockReset().mockImplementation(async (url,_options) => {
    if(url.includes('template_source_sha256=')) return {...original,source_version:newSource,runtime:{host:{start_script:'exec new'}}};
    if(url.endsWith('/preflight')) return {configuration_revision:1,plan_digest:'source-plan',changed_sections:['template_source'],requires_rebuild:false,risks:[]};
    return original;
  });
  const applied=vi.fn();const host=document.createElement('div');document.body.append(host);
  dispose=render(() => <FloeProvider><ManagedServiceSettingsDrawer open serviceID="source-review" serviceName="Pinned service" canManage onOpenChange={() => {}} onChanged={() => {}} onRequestStop={() => {}} onDuplicateTemplate={() => {}} onApply={applied} /></FloeProvider>,host);
  await expect.element(page.getByRole('button',{name:'Review source update',exact:true})).toBeVisible();
  expect(api.request.mock.calls.some(([,options]) => options?.method==='POST')).toBe(false);
  await userEvent.click(page.getByRole('button',{name:'Review source update',exact:true}));
  await userEvent.click(page.getByRole('button',{name:'Review changes',exact:true}));
  await expect.poll(() => api.request.mock.calls.find(([url]) => url.endsWith('/preflight'))?.[1]?.body).toBeDefined();
  const draft = JSON.parse(api.request.mock.calls.find(([url]) => url.endsWith('/preflight'))![1].body);
  expect(draft.template_source_sha256).toBe(newSource.sha256);
  expect(draft.runtime.host.start_script).toBe('exec new');
  expect(applied).not.toHaveBeenCalled();
  await userEvent.click(page.getByRole('button',{name:'Apply configuration',exact:true}));
  expect(applied).toHaveBeenCalledWith(expect.objectContaining({plan_digest:'source-plan',draft:expect.objectContaining({template_source_sha256:newSource.sha256})}));
});

it.each([false, true])('adopts the confirmed service revision after apply with category switch=%s', async switchCategory => {
  const settings = (revision: number) => ({ service_id: 'one', name: 'Service', access_mode: 'unified_proxy', deployment: 'container', template_source: 'custom', observed_state: 'stopped', configuration_revision: revision, configuration_sha256: `sha-${revision}`, parameters: {}, runtime: { container: { entrypoint: revision === 3 ? '' : '/saved', command: [], environment: [], labels: {}, ports: [], mounts: [], read_only_root: true } } });
  let revision = 3;
  api.request.mockReset().mockImplementation(async (url: string) => url.endsWith('/preflight') ? { configuration_revision: revision, plan_digest: 'checked', risks: [], changed_sections: ['runtime'], requires_rebuild: true } : settings(revision));
  const [open, setOpen] = createSignal(true);
  let complete!: () => void;
  const apply = vi.fn(async () => { await new Promise<void>(resolve => { complete = resolve; }); revision = 4; });
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeProvider><div hidden={!open()}><ManagedServiceSettingsDrawer embedded open={open()} serviceID="one" serviceName="Service" canManage onOpenChange={setOpen} onChanged={() => {}} onRequestStop={() => {}} onDuplicateTemplate={() => {}} onApply={apply} /></div></FloeProvider>, host);
  await expect.element(page.getByTestId('managed-service-settings')).toBeVisible();
  await userEvent.fill(host.querySelector<HTMLInputElement>('.managed-settings-fields input')!, 'Unsaved metadata');
  await page.getByRole('button', { name: 'Parameters', exact: true }).click();
  await page.getByPlaceholder('/usr/local/bin/start').fill('/saved');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await page.getByRole('button', { name: 'Apply configuration', exact: true }).click();
  await expect.poll(() => apply.mock.calls.length).toBe(1);
  if (switchCategory) setOpen(false);
  complete(); await expect.poll(() => revision).toBe(4);
  if (!switchCategory) await expect.poll(open).toBe(false);
  setOpen(true); await expect.poll(() => host.querySelector<HTMLInputElement>('input[placeholder="/usr/local/bin/start"]')?.value).toBe('/saved');
  await page.getByPlaceholder('/usr/local/bin/start').fill('/next');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect.poll(() => {
    const call = api.request.mock.calls.filter(([url]) => url.endsWith('/preflight')).at(-1);
    return call && JSON.parse(String(call[1].body)).configuration_revision;
  }).toBe(4);
  await page.getByRole('button', { name: 'General', exact: true }).click();
  expect(host.querySelector<HTMLInputElement>('.managed-settings-fields input')?.value).toBe('Unsaved metadata');
});

it('settles a hidden preflight without accepting its stale plan', async () => {
  const value = { service_id: 'one', name: 'Service', access_mode: 'unified_proxy', deployment: 'container', template_source: 'custom', observed_state: 'stopped', configuration_revision: 3, parameters: {}, runtime: { container: { entrypoint: '', command: [], read_only_root: true } } };
  let finish!: (value: unknown) => void;
  api.request.mockReset().mockImplementation(async (url: string) => url.endsWith('/preflight') ? new Promise(resolve => { finish = resolve; }) : value);
  const [open, setOpen] = createSignal(true);
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeProvider><div hidden={!open()}><ManagedServiceSettingsDrawer embedded open={open()} serviceID="one" serviceName="Service" canManage onOpenChange={setOpen} onChanged={() => {}} onRequestStop={() => {}} onDuplicateTemplate={() => {}} onApply={async () => {}} /></div></FloeProvider>, host);
  await page.getByRole('button', { name: 'Parameters', exact: true }).click();
  await page.getByPlaceholder('/usr/local/bin/start').fill('/pending');
  await page.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect.poll(() => finish).toBeTypeOf('function');
  setOpen(false); finish({ configuration_revision: 3, plan_digest: 'stale', risks: [], changed_sections: ['runtime'] });
  setOpen(true);
  await expect.element(page.getByRole('button', { name: 'Review changes', exact: true })).toBeEnabled();
  await expect.element(page.getByRole('button', { name: 'Apply configuration', exact: true })).toBeDisabled();
});
