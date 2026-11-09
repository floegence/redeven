// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ContainerSettingsPanel } from './ContainerSettingsPanel';
import { SettingsPanelContext } from '../../../../../../settings_ui/src/SettingsPanelHost';
import { createSettingsSession } from '../../../../../../settings_ui/src/settingsSession';
import { ContainerOperationRejectedError, type ContainerOperation, type ContainerServiceConfiguration, type ContainerService } from '../../services/containerResourcesApi';
import type { EnvResourceCacheAccess } from '../../services/envResourceCache';

const state = vi.hoisted(() => ({
  services: vi.fn(), configuration: vi.fn(), preflight: vi.fn(), create: vi.fn(), subscribe: vi.fn(), operations: vi.fn(), operation: vi.fn(), open: vi.fn(),
  access: () => ({ phase: 'ready', generation: 0 }), permissions: () => ({ can_read: true, can_write: true, can_execute: true, can_admin: true }),
}));
vi.mock('@floegence/floe-webapp-core', () => ({ secureRandomUUID: () => crypto.randomUUID() }));
vi.mock('../EnvContext', () => ({ useEnvContext: () => ({
  resourceCacheAccess: () => state.access(), env: () => ({ permissions: state.permissions() }), openSettings: state.open,
}) }));
vi.mock('./EnvSettingsPageContext', () => ({ useEnvSettingsPage: () => ({ canInteract: () => state.access().phase === 'ready', canAdmin: () => state.permissions().can_admin }) }));
vi.mock('./SettingsPrimitives', () => ({ SettingsResourceToolbar: (props: { label: string; children: import('solid-js').JSX.Element; actions?: import('solid-js').JSX.Element }) => <div aria-label={props.label}>{props.children}{props.actions}</div> }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../services/containerResourcesApi', async original => ({
  ...await original<typeof import('../../services/containerResourcesApi')>(),
  listContainerServices: state.services, getContainerServiceConfiguration: state.configuration, preflightContainerOperation: state.preflight,
  createContainerOperation: state.create, subscribeContainerOperation: state.subscribe, listContainerOperations: state.operations, getContainerOperation: state.operation, getContainerOperationByRequestID: async (requestID: string) => (await state.operations()).find((item: ContainerOperation) => item.request_id === requestID),
}));
vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => <button type="button" aria-label={props.ariaLabel ?? props['aria-label']} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>,
  Input: (props: any) => <input value={props.value} aria-label={props.ariaLabel ?? props['aria-label']} placeholder={props.placeholder} disabled={props.disabled} onInput={props.onInput} onChange={props.onChange} />,
  Select: (props: any) => <select aria-label={props.ariaLabel ?? props['aria-label']} value={props.value} disabled={props.disabled} onChange={event => props.onChange(event.currentTarget.value)}><option value="">{props.placeholder}</option>{props.options.map((option: any) => <option value={option.value}>{option.label}</option>)}</select>,
  Tabs: (props: any) => <div role="tablist">{props.items.map((item: any) => <button type="button" role="tab" aria-selected={props.activeId === item.id} onClick={() => props.onChange(item.id)}>{item.label}</button>)}</div>,
  Tag: (props: any) => <span>{props.children}</span>,
  SettingsSection: (props: any) => <section class={props.class} aria-label={props['aria-label']}><header><h2>{props.title}</h2>{props.actions}</header>{props.children}</section>,
  SettingsList: (props: any) => <div>{props.children}</div>,
  SettingRow: (props: any) => <div><span>{props.title}</span>{props.control}{props.children}</div>,
}));
vi.mock('../../widgets/TextFilePreviewPane', () => ({
  TextFilePreviewPane: (props: any) => <textarea aria-label={props.path} data-source-editor value={props.draftText} onInput={event => props.onDraftChange(event.currentTarget.value)} />,
}));

const service: ContainerService = {
  service_id: 'docker-a', engine: 'docker', name: 'Docker A', implementation: 'docker_engine', state: 'running',
  capabilities: { start: true, stop: true, restart: true }, configuration: { mode: 'local', sources: ['engine', 'docker_cli'] },
};
const configuration = (revision = 'a'): ContainerServiceConfiguration => ({
  service_id: service.service_id,
  sources: [
    { source_id: 'engine', display_path: '/docker/daemon.json', status: 'ready', exists: true, format: 'json', sections: ['advanced'], apply_modes: ['save', 'save_and_restart'], base_revision: `engine-${revision}`, content: JSON.stringify({ engine: revision }) },
    { source_id: 'docker_cli', display_path: '/docker/config.json', status: 'ready', exists: true, format: 'json', sections: ['advanced'], apply_modes: ['save'], base_revision: `cli-${revision}`, content: JSON.stringify({ context: revision, credsStore: 'desktop' }) },
  ],
});
const preflight = { method: 'container.services.configuration.update', resource_kind: 'container_service', request_hash: 'request', plan_hash: 'plan', plan: { summary: ['Review configuration update'], risk_flags: [] } };
const operation = (requestID: string, id: string, phase: string) => ({ request_id: requestID, operation_id: id, state: phase } as ContainerOperation);
let panelSession: ReturnType<typeof createSettingsSession>;
let host: HTMLDivElement, dispose: (() => void) | undefined;
let setAccess!: (value: EnvResourceCacheAccess) => void, setPermissions!: (value: ReturnType<typeof state.permissions>) => void, setTarget!: (value: string | undefined) => void;
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(resolve => setTimeout(resolve, 0)); };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
beforeEach(() => {
  vi.resetAllMocks();
  state.services.mockResolvedValue([service]); state.configuration.mockResolvedValue(configuration()); state.operations.mockResolvedValue([]);
  state.preflight.mockResolvedValue(preflight);
  state.operation.mockImplementation(async (id: string) => operation(state.create.mock.lastCall![2], id, 'succeeded'));
  state.create.mockImplementation(async (_preflight, _request, requestID) => operation(requestID, 'op-a', 'queued'));
  state.subscribe.mockImplementation(async (id, receive) => {
    const requestID = state.create.mock.lastCall![2]; receive(operation(requestID, id, 'succeeded'));
  });
  host = document.createElement('div'); document.body.append(host);
});
afterEach(() => { dispose?.(); host.remove(); });
async function mount(target: string | undefined = service.service_id) {
  dispose = render(() => {
    const [access, updateAccess] = createSignal<EnvResourceCacheAccess>({ phase: 'ready', generation: 0 }); state.access = access; setAccess = updateAccess;
    const [permissions, updatePermissions] = createSignal({ can_read: true, can_write: true, can_execute: true, can_admin: true }); state.permissions = permissions; setPermissions = updatePermissions;
    const [resource, updateTarget] = createSignal(target); setTarget = updateTarget;
    panelSession = createSettingsSession(); panelSession.open({ section: 'containers', resource: target }); panelSession.setPresent(true);
    return <SettingsPanelContext.Provider value={{ ...panelSession, register: () => () => {} }}><ContainerSettingsPanel resource={resource()} /></SettingsPanelContext.Provider>;
  }, host); await settle();
}
const visible = (element: Element) => !element.closest('[hidden]');
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => visible(item) && (item.textContent === label || item.getAttribute('aria-label') === label))!;
const save = () => button('containers.services.save');
const run = () => button('containers.actions.run');
const sourceRefresh = () => host.querySelector<HTMLButtonElement>('.container-settings-configuration > header button[aria-label="common.actions.refresh"]')!;
const editor = () => [...host.querySelectorAll<HTMLTextAreaElement>('textarea[data-source-editor]')].find(visible)!;
function edit(value: string) { editor().value = value; editor().dispatchEvent(new Event('input', { bubbles: true })); }
async function selectSource(source: 'engine' | 'docker_cli') { button(source === 'engine' ? 'containers.services.engineConfiguration' : 'containers.services.dockerCLI').click(); await settle(); }
async function review() { save().click(); await settle(); expect(run()).toBeDefined(); }

it('opens a known target with reads only and leaves all mutations behind explicit review', async () => {
  await mount(); expect(state.services).toHaveBeenCalledOnce(); expect(state.configuration).toHaveBeenCalledExactlyOnceWith('docker-a', expect.any(AbortSignal));
  expect(editor().value).toBe('{"engine":"a"}'); expect(state.preflight).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled(); expect(state.subscribe).not.toHaveBeenCalled();
  edit('{"engine":"draft"}'); await review(); expect(state.create).not.toHaveBeenCalled();
  button('containers.actions.cancel').click(); await settle(); expect(editor().value).toBe('{"engine":"draft"}');
  await review(); run().click(); await settle(); expect(state.create).toHaveBeenCalledOnce();
  expect(state.create.mock.calls[0][2]).toMatch(/^envapp-/);
});

it('never substitutes the first service for an invalid or unspecified global target', async () => {
  await mount('missing-service'); expect(host.textContent).toContain('settings.targetUnavailable');
  expect(state.configuration).not.toHaveBeenCalled(); expect(editor()).toBeUndefined();
  setTarget(undefined); await settle(); expect(state.configuration).not.toHaveBeenCalled();
  const target = host.querySelector<HTMLSelectElement>('select')!; target.value = 'docker-a'; target.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  expect(state.open).toHaveBeenCalledExactlyOnceWith('containers', { resource: 'docker-a' }); expect(state.configuration).toHaveBeenCalledOnce();
});

it('retries a failed service discovery without pretending a target exists', async () => {
  state.services.mockRejectedValueOnce(new Error('discovery offline')); await mount();
  expect(host.textContent).toContain('discovery offline'); expect(state.configuration).not.toHaveBeenCalled();
  button('common.actions.refresh').click(); await settle(); expect(state.services).toHaveBeenCalledTimes(2); expect(editor().value).toContain('engine');
  expect(state.create).not.toHaveBeenCalled();
});

it('retries the initial configuration read without resetting state or submitting defaults', async () => {
  state.configuration.mockRejectedValueOnce(new Error('configuration read failed')); await mount();
  expect(host.textContent).toContain('configuration read failed'); expect(save().disabled).toBe(true);
  sourceRefresh().click(); await settle(); expect(state.configuration).toHaveBeenCalledTimes(2); expect(editor().value).toBe('{"engine":"a"}');
  expect(state.preflight).not.toHaveBeenCalled(); expect(state.create).not.toHaveBeenCalled();
});

it.each(['refresh', 'reconnect'] as const)('preserves each dirty draft original CAS base after %s', async action => {
  await mount(); await selectSource('docker_cli'); const draft = '{"context":"user-draft","credsStore":"desktop"}'; edit(draft);
  state.configuration.mockResolvedValue(configuration('b'));
  if (action === 'refresh') sourceRefresh().click();
  else { setAccess({ phase: 'pending', generation: 1 }); await settle(); setAccess({ phase: 'ready', generation: 2 }); }
  await settle(); await selectSource('docker_cli'); expect(editor().value).toBe(draft);
  await review(); expect(state.preflight).toHaveBeenLastCalledWith(preflight.method, expect.objectContaining({ source_id: 'docker_cli', content: draft, base_revision: 'cli-a' }));
  expect(state.create).not.toHaveBeenCalled();
});

it('resets only the successfully saved Engine source and retains an unsaved Docker CLI draft', async () => {
  await mount(); edit('{"engine":"saved"}'); await selectSource('docker_cli'); const draft = '{"context":"unsaved","credsStore":"desktop"}'; edit(draft);
  await selectSource('engine'); state.configuration.mockResolvedValue(configuration('b')); await review(); run().click(); await settle();
  expect(editor().value).toBe('{"engine":"b"}'); await selectSource('docker_cli'); expect(editor().value).toBe(draft);
  await review(); expect(state.preflight).toHaveBeenLastCalledWith(preflight.method, expect.objectContaining({ source_id: 'docker_cli', base_revision: 'cli-a', content: draft }));
  expect(state.create).toHaveBeenCalledOnce();
});

it('does not use a previous successful operation to resolve a newer save with a lost response', async () => {
  await mount(); edit('{"engine":"first"}'); await review(); run().click(); await settle();
  const firstRequest = state.create.mock.calls[0][2]; expect(save().disabled).toBe(false);
  edit('{"engine":"second"}'); state.create.mockRejectedValueOnce(new Error('response lost')); await review(); run().click(); await settle();
  const secondRequest = state.create.mock.calls[1][2]; expect(secondRequest).not.toBe(firstRequest); expect(save().disabled).toBe(true);
  expect(host.textContent).toContain('settings.operationUnknown');
  state.operations.mockResolvedValue([operation(firstRequest, 'op-a', 'succeeded')]); sourceRefresh().click(); await settle();
  expect(save().disabled).toBe(true); expect(editor().value).toBe('{"engine":"second"}'); expect(state.create).toHaveBeenCalledTimes(2);
  state.operations.mockResolvedValue([operation(firstRequest, 'op-a', 'succeeded'), operation(secondRequest, 'op-b', 'failed')]); sourceRefresh().click(); await settle();
  expect(save().disabled).toBe(false); expect(host.textContent).not.toContain('settings.operationUnknown'); expect(editor().value).toBe('{"engine":"second"}');
});

it('unlocks a definitively rejected admission without replaying it', async () => {
  await mount(); edit('{"engine":"draft"}'); state.create.mockRejectedValueOnce(new ContainerOperationRejectedError(new Error('preflight expired')));
  await review(); run().click(); await settle(); expect(save().disabled).toBe(false); expect(host.textContent).toContain('preflight expired');
  expect(host.textContent).not.toContain('settings.operationUnknown'); expect(state.create).toHaveBeenCalledOnce(); expect(state.subscribe).not.toHaveBeenCalled();
  expect(editor().value).toBe('{"engine":"draft"}');
});

it.each(['can_read', 'can_write', 'can_execute', 'can_admin'] as const)('invalidates reviewed mutation after %s revocation without losing draft', async permission => {
  await mount(); edit('{"engine":"draft"}'); await review(); const staleRun = run();
  setPermissions({ ...state.permissions(), [permission]: false }); await settle(); expect(run()).toBeUndefined(); staleRun.click();
  expect(state.create).not.toHaveBeenCalled(); expect(save().disabled).toBe(true); expect(editor().value).toBe('{"engine":"draft"}');
});

it('does not show or submit a late preflight after reconnect', async () => {
  await mount(); edit('{"engine":"draft"}'); const pending = deferred<typeof preflight>(); state.preflight.mockReturnValueOnce(pending.promise);
  save().click(); await settle(); setAccess({ phase: 'ready', generation: 1 }); await settle(); pending.resolve(preflight); await settle();
  expect(run()).toBeUndefined(); expect(state.create).not.toHaveBeenCalled(); expect(editor().value).toBe('{"engine":"draft"}');
});

it('ignores stale initial configuration data after a newer authority has loaded', async () => {
  const pending = deferred<ContainerServiceConfiguration>(); state.configuration.mockReturnValueOnce(pending.promise); await mount();
  state.configuration.mockResolvedValue(configuration('b')); setAccess({ phase: 'ready', generation: 1 }); await settle();
  expect(editor().value).toBe('{"engine":"b"}'); pending.resolve(configuration('a')); await settle();
  expect(editor().value).toBe('{"engine":"b"}'); expect(state.create).not.toHaveBeenCalled();
});

it('discards only the selected source and keeps other unsaved source drafts', async () => {
  await mount(); edit('{"engine":"unsaved"}'); await selectSource('docker_cli'); edit('{"context":"discard-me"}');
  state.configuration.mockResolvedValue(configuration('b'));
  button('filePreview.discardChanges').click(); await settle();
  expect(editor().value).toBe('{"engine":"unsaved"}'); await selectSource('docker_cli'); expect(editor().value).toBe('{"context":"b","credsStore":"desktop"}');
  await review(); expect(state.preflight).toHaveBeenLastCalledWith(preflight.method, expect.objectContaining({ source_id: 'docker_cli', base_revision: 'cli-b' }));
});

it('preserves a readable dirty draft when refreshing its source fails', async () => {
  await mount(); edit('{"engine":"draft"}'); state.configuration.mockRejectedValueOnce(new Error('source temporarily unavailable'));
  sourceRefresh().click(); await settle(); expect(editor().value).toBe('{"engine":"draft"}'); expect(host.textContent).toContain('source temporarily unavailable');
  await review(); expect(state.preflight).toHaveBeenLastCalledWith(preflight.method, expect.objectContaining({ base_revision: 'engine-a', content: '{"engine":"draft"}' }));
});

it('can retry an initial configuration read independently of an unrelated operation-list failure', async () => {
  state.configuration.mockRejectedValueOnce(new Error('initial read failed')); state.operations.mockRejectedValue(new Error('operation list offline'));
  await mount(); sourceRefresh().click(); await settle();
  expect(state.configuration).toHaveBeenCalledTimes(2); expect(editor().value).toBe('{"engine":"a"}');
  expect(state.create).not.toHaveBeenCalled();
});

it('rejects a removed target instead of moving its draft or review to another service', async () => {
  await mount(); edit('{"engine":"draft"}'); await review(); const staleRun = run();
  state.services.mockResolvedValue([{ ...service, service_id: 'docker-b', name: 'Docker B' }]);
  button('common.actions.refresh').click(); await settle();
  expect(host.textContent).toContain('settings.targetUnavailable'); expect(save().disabled).toBe(true); staleRun.click();
  expect(state.create).not.toHaveBeenCalled(); expect(state.configuration.mock.calls.every(([id]) => id === 'docker-a')).toBe(true);
  expect(editor().value).toBe('{"engine":"draft"}');
});

it('does not discard a new draft when Refresh observes an already-consumed successful save', async () => {
  await mount(); edit('{"engine":"saved"}'); state.configuration.mockResolvedValue(configuration('b'));
  await review(); run().click(); await settle();
  const requestID = state.create.mock.calls[0][2]; expect(editor().value).toBe('{"engine":"b"}');
  edit('{"engine":"new-unsaved"}'); state.operations.mockResolvedValue([operation(requestID, 'op-a', 'succeeded')]);
  sourceRefresh().click(); await settle();
  expect(editor().value).toBe('{"engine":"new-unsaved"}');
  await review(); expect(state.preflight).toHaveBeenLastCalledWith(preflight.method, expect.objectContaining({ base_revision: 'engine-b', content: '{"engine":"new-unsaved"}' }));
});


it('recovers a known operation by exact ID even outside the recent list', async () => {
  state.subscribe.mockRejectedValueOnce(new Error('stream disconnected'));
  await mount(); edit('{"engine":"saved"}'); await review(); run().click(); await settle();
  expect(save().disabled).toBe(true); state.operations.mockRejectedValue(new Error('recent list unavailable'));
  sourceRefresh().click(); await settle();
  expect(state.operation).toHaveBeenCalledExactlyOnceWith('op-a'); expect(state.operations).not.toHaveBeenCalled();
  expect(save().disabled).toBe(false); expect(state.create).toHaveBeenCalledOnce();
});

it('does not treat an exact request lookup failure as safe to retry', async () => {
  state.create.mockRejectedValueOnce(new Error('response lost'));
  await mount(); edit('{"engine":"draft"}'); await review(); run().click(); await settle();
  state.operations.mockRejectedValue(new Error('404 not found')); sourceRefresh().click(); await settle();
  expect(save().disabled).toBe(true); expect(editor().value).toBe('{"engine":"draft"}'); expect(state.create).toHaveBeenCalledOnce();
});

it('rejects a retained container Save after another target is selected', async () => {
 await mount(); const stale=save(); setTarget('missing'); await settle(); stale.click(); await settle(); expect(state.preflight).not.toHaveBeenCalled();
});
it('invalidates a retained container review after another target is selected', async () => {
 await mount(); await review(); const stale=run(); setTarget('missing'); await settle(); stale.click(); await settle(); expect(state.create).not.toHaveBeenCalled();
});
it('does not create review after delayed preflight loses current target', async () => {
 await mount(); const pending=deferred<typeof preflight>(); state.preflight.mockReturnValueOnce(pending.promise); save().click(); setTarget('missing'); await settle(); pending.resolve(preflight); await settle();
 expect(host.textContent).not.toContain('containers.actions.run');
});

it('retires delayed preflight intent after leaving and returning to the same target', async () => {
  await mount(); const pending = deferred<typeof preflight>(); state.preflight.mockReturnValueOnce(pending.promise);
  save().click(); setTarget('missing'); await settle(); setTarget(service.service_id); await settle();
  pending.resolve(preflight); await settle();
  expect(button('containers.actions.run')).toBeUndefined(); expect(state.create).not.toHaveBeenCalled();
  expect(save().disabled).toBe(false);
});

for (const retirement of ['category', 'closed'] as const) it(`retires container preflight after ${retirement} ABA`, async () => {
  await mount(); edit('{"engine":"unsaved"}');
  const pending = deferred<typeof preflight>(); state.preflight.mockReturnValueOnce(pending.promise); save().click();
  if (retirement === 'category') panelSession.open({ section: 'terminal' }); else panelSession.setPresent(false);
  await settle();
  if (retirement === 'category') panelSession.open({ section: 'containers', resource: service.service_id }); else panelSession.setPresent(true);
  await settle(); pending.resolve(preflight); await settle();
  expect(run()).toBeUndefined(); expect(state.create).not.toHaveBeenCalled();
  expect(editor().value).toBe('{"engine":"unsaved"}'); expect(save().disabled).toBe(false);
});
for (const retirement of ['category', 'closed'] as const) it(`settles admitted container operation after ${retirement}`, async () => {
  await mount(); edit('{"engine":"saved"}'); await review();
  const pending = deferred<ContainerOperation>(); state.create.mockReturnValueOnce(pending.promise); run().click(); await settle();
  expect(state.create).toHaveBeenCalledOnce(); const requestID = state.create.mock.lastCall![2];
  if (retirement === 'category') panelSession.open({ section: 'terminal' }); else panelSession.setPresent(false);
  await settle(); state.configuration.mockResolvedValue(configuration('b')); pending.resolve(operation(requestID, 'accepted', 'queued')); await settle();
  expect(state.subscribe).toHaveBeenCalledOnce();
  if (retirement === 'category') panelSession.open({ section: 'containers', resource: service.service_id }); else panelSession.setPresent(true);
  await settle(); expect(editor().value).toBe('{"engine":"b"}'); expect(save().disabled).toBe(false);
  expect(state.create).toHaveBeenCalledOnce();
});
