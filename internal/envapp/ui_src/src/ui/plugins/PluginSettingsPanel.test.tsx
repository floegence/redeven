// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PluginSettingsPanel } from './PluginSettingsPanel';
import { pluginAuthorSettingsResource } from './pluginSettingsTarget';
import type { PluginAuthorAccess } from './PluginAuthorAccess';
type Editor = Parameters<typeof PluginAuthorAccess>[0];
const state = vi.hoisted(() => ({ list: vi.fn(), identity: vi.fn(), open: vi.fn(), changed: vi.fn(), error: vi.fn(),
  ready: () => true, interact: (): boolean => true, generation: () => 0, manage: () => true, present: () => true, resource: () => undefined as string | undefined, editors: [] as Editor[] }));
vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => <button aria-label={props['aria-label']} disabled={props.disabled} onClick={props.onClick}>{props.children}</button>,
  SettingsList: (props: any) => <div data-settings-resource-list>{props.children}</div>,
  Select: (props: any) => <select aria-label={props.ariaLabel} value={props.value} onChange={event => props.onOptionSelect(props.options.find((option: any) => option.value === event.currentTarget.value))}>{props.options.map((option: any) => <option value={option.value} disabled={option.disabled}>{option.label}</option>)}</select>,
}));
vi.mock('../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../pages/EnvContext', () => ({ useEnvContext: () => ({ resourceCacheAccess: () => ({ phase: state.ready() ? 'ready' : 'denied', generation: state.generation() }), openSettings: state.open, bumpSettingsSeq: state.changed }) }));
vi.mock('../pages/settings/EnvSettingsPageContext', () => ({ useEnvSettingsPage: () => ({ canInteract: () => state.interact(), canAdmin: () => state.manage(), notify: { error: state.error } }) }));
vi.mock('../../../../../settings_ui/src/SettingsPanelHost', () => ({ useSettingsPanelHost: () => ({ present: () => state.present(), target: () => ({ section: 'plugins', resource: state.resource() }) }) }));
vi.mock('../primitives/UIFirstKeepAlivePanel', () => ({ UIFirstKeepAlivePanel: (props: any) => <div hidden={!props.active}>{props.render()}</div> }));
vi.mock('./pluginCreationApi', () => ({ listPluginDrafts: state.list }));
vi.mock('./pluginAuthorApi', () => ({ authorPreviewIdentity: state.identity }));
vi.mock('./PluginAuthorAccess', () => ({ PluginAuthorAccess: (props: Editor) => { state.editors.push(props); return <div data-editor><input aria-label="connection draft" /><output>{props.workspaceID}/{props.pluginInstanceID}</output></div>; } }));
const draft = { id: 'draft-a', workspace_id: 'author-a', title: 'Draft A', lifecycle: 'active' };
const second = { id: 'draft-b', workspace_id: 'author-b', title: 'Draft B', lifecycle: 'active' };
const exact = (id = 'a', instance = `preview-${id}`) => pluginAuthorSettingsResource({ draftID: `draft-${id}`, workspaceID: `author-${id}`, pluginInstanceID: instance });
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
let dispose: (() => void) | undefined, host: HTMLDivElement;
let setResource: (value: string | undefined) => void, setReady: (value: boolean) => void, setGeneration: (value: number) => void, setPresent: (value: boolean) => void;
beforeEach(() => {
  vi.resetAllMocks(); state.editors = [];
  state.list.mockResolvedValue([draft, second]); state.identity.mockImplementation(async (id: string) => ({ preview: { plugin_instance_id: `preview-${id.slice(-1)}` } }));
  state.manage = () => true; state.interact = () => true;
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); });
async function mount(resource?: string) {
  [state.resource, setResource] = createSignal(resource); [state.ready, setReady] = createSignal(true); [state.generation, setGeneration] = createSignal(0); [state.present, setPresent] = createSignal(true);
  host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <PluginSettingsPanel resource={state.resource()} />, host);
  await settle();
}
function shown() { return [...host.querySelectorAll<HTMLElement>('[data-editor]')].filter(node => !node.parentElement!.hidden); }
function refresh() { [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === 'common.actions.refresh')!.click(); }
it('groups catalog resources without a duplicate selector', async () => {
  await mount();
  expect(host.querySelector('[data-settings-resource-list]')).not.toBeNull();
  expect(host.querySelector('select')).toBeNull();
  expect(host.querySelector('button[aria-label="common.actions.refresh"]')).not.toBeNull();
});
it('discovers author previews from the catalog without opening a workspace', async () => {
  await mount();
  expect(state.identity).not.toHaveBeenCalled(); expect(state.editors).toHaveLength(0);
  host.querySelector<HTMLButtonElement>('button[aria-label="Draft A"]')!.click();
  expect(state.open).toHaveBeenCalledWith('plugins', { resource: pluginAuthorSettingsResource({ draftID: draft.id, workspaceID: draft.workspace_id }) });
});
it('loads only the exact author identity and renders its embedded editor', async () => {
  await mount(exact()); expect(shown()).toHaveLength(1); expect(state.identity).toHaveBeenCalledWith('author-a');
  expect(state.editors[0].workspaceID).toBe('author-a'); expect(state.editors[0].pluginInstanceID).toBe('preview-a'); expect(state.editors[0].embeddedConnections).toBe(true);
  expect(state.editors[0].canManage).toBe(true); expect(state.editors[0].visible).toBe(true);
});
it('rejects a replaced preview without silently selecting its successor', async () => {
  await mount(exact('a', 'previous-preview')); expect(shown()).toHaveLength(0); expect(state.editors).toHaveLength(0); expect(host.textContent).toContain('settings.targetUnavailable');
});
it('rejects a draft/workspace mismatch without reading its platform', async () => {
  await mount(pluginAuthorSettingsResource({ draftID: 'draft-a', workspaceID: 'author-b', pluginInstanceID: 'preview-b' })); expect(state.identity).not.toHaveBeenCalled(); expect(shown()).toHaveLength(0);
});
it('rejects deleted and malformed targets without falling back to installed settings', async () => {
  state.list.mockResolvedValue([{ ...draft, lifecycle: 'deleted' }]); await mount(exact()); expect(state.identity).not.toHaveBeenCalled(); expect(shown()).toHaveLength(0);
  setResource('instance:preview-a'); await settle(); expect(host.querySelector('[data-plugin-center-view]')).toBeNull(); expect(shown()).toHaveLength(0);
});
it('retains separate connection drafts while switching author targets and the configuration index', async () => {
  await mount(exact()); const first = shown()[0].querySelector('input')!; first.value = 'https://draft-a.example';
  setResource(exact('b')); await settle(); expect(shown()).toHaveLength(1); expect(state.editors[0].visible).toBe(false); shown()[0].querySelector('input')!.value = 'https://draft-b.example';
  setResource(undefined); await settle(); expect(shown()).toHaveLength(0);
  setResource(exact()); await settle(); expect(shown()[0].querySelector('input')).toBe(first); expect(first.value).toBe('https://draft-a.example'); expect(state.editors).toHaveLength(2);
});
it('locks retained editors immediately on permission or authority loss', async () => {
  await mount(exact()); setReady(false); await settle(); expect(state.editors[0].canManage).toBe(false); expect(state.editors[0].visible).toBe(false);
  setGeneration(1); setReady(true); await settle(); expect(state.editors[0].authorityKey).toBe(2); expect(state.editors[0].canManage).toBe(true);
});
it('hides retained editors when global Settings closes', async () => {
  await mount(exact()); setPresent(false); await settle(); expect(state.editors[0].visible).toBe(false);
});
it('handles status failure and recovers through an explicit refresh', async () => {
  state.identity.mockRejectedValueOnce(new Error('offline')); await mount(exact()); expect(shown()).toHaveLength(0); expect(host.textContent).toContain('settings.targetUnavailable');
  refresh(); await settle(); expect(shown()).toHaveLength(1);
});
it('shows absence of a preview without starting or resuming it', async () => {
  state.identity.mockResolvedValue({ preview: {} }); await mount(exact()); expect(shown()).toHaveLength(0); expect(host.textContent).toContain('settings.plugins.previewEmpty');
});
it('fences a late identity response after authority changes', async () => {
  let resolve!: (value: unknown) => void; state.identity.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  await mount(exact()); setReady(false); setGeneration(1); resolve({ preview: { plugin_instance_id: 'preview-a' } }); await settle(); expect(shown()).toHaveLength(0); expect(state.editors).toHaveLength(0);
});

it('pins a globally selected workspace to its confirmed preview until explicit reselection', async () => {
  const resource = pluginAuthorSettingsResource({ draftID: 'draft-a', workspaceID: 'author-a' });
  await mount(resource); expect(shown()).toHaveLength(1);
  state.identity.mockResolvedValue({ preview: { plugin_instance_id: 'replacement' } }); refresh(); await settle();
  expect(shown()).toHaveLength(0); expect(state.editors).toHaveLength(1); expect(host.textContent).toContain('settings.targetUnavailable');
  const select = host.querySelector('select')!;
  select.value = resource; select.dispatchEvent(new Event('change', { bubbles: true })); await settle();
  expect(state.open).toHaveBeenLastCalledWith('plugins', { resource });
  expect(shown()).toHaveLength(1); expect(state.editors.at(-1)?.pluginInstanceID).toBe('replacement');
});

it('does not replace author authority while unrelated agent settings reload', async () => {
  const [interact, setInteract] = createSignal(true); state.interact = interact;
  await mount(exact()); const editor = shown()[0]; const reads = state.identity.mock.calls.length;
  setInteract(false); await settle(); expect(shown()[0]).toBe(editor); expect(state.editors[0].authorityKey).toBe(1); expect(state.editors[0].canManage).toBe(true);
  setInteract(true); await settle(); expect(shown()[0]).toBe(editor); expect(state.identity.mock.calls.length).toBe(reads);
});
