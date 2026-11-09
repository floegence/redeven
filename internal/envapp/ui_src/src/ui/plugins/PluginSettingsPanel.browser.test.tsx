import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { I18nProvider } from '../i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import { PluginSettingsPanel } from './PluginSettingsPanel';
import { pluginAuthorSettingsResource, pluginInstalledSettingsResource } from './pluginSettingsTarget';
import type { PluginSettingsOwner } from './PluginSettingsPanel';
import type { PluginInventoryItem } from './pluginTypes';

const state = vi.hoisted(() => ({ list: vi.fn(), identity: vi.fn(), open: vi.fn(), changed: vi.fn(), error: vi.fn(),
  connections: vi.fn(), mutate: vi.fn(), resource: () => undefined as string | undefined, ready: (): boolean => true, generation: (): number => 0 }));
vi.mock('../pages/EnvContext', () => ({ useEnvContext: () => ({ resourceCacheAccess: () => ({ phase: state.ready() ? 'ready' : 'denied', generation: state.generation() }), openSettings: state.open, bumpSettingsSeq: state.changed }) }));
vi.mock('../pages/settings/EnvSettingsPageContext', () => ({ useEnvSettingsPage: () => ({ canAdmin: () => true, notify: { error: state.error } }) }));
vi.mock('../../../../../settings_ui/src/SettingsPanelHost', () => ({ useSettingsPanelHost: () => ({ present: () => true, target: () => ({ section: 'plugins', resource: state.resource() }) }) }));
vi.mock('./pluginCreationApi', () => ({ listPluginDrafts: state.list }));
vi.mock('./pluginAuthorApi', () => ({ authorPreviewIdentity: state.identity }));
vi.mock('./PluginAuthorAccess', () => ({ PluginAuthorAccess: (props: { workspaceID: string; pluginInstanceID: string }) => <div data-preview-editor={props.pluginInstanceID}><input aria-label="Connection draft" /><output>{props.workspaceID}</output></div> }));
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  state.ready = () => true; state.generation = () => 0;
  vi.spyOn(console, 'warn');
  localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, 'en-US');
  state.list.mockResolvedValue([{ id: 'draft-a', workspace_id: 'author-a', title: 'Draft A', lifecycle: 'active' }]);
  state.identity.mockResolvedValue({ preview: { plugin_instance_id: 'preview-a' } });
});
afterEach(() => {
  dispose?.(); dispose = undefined; document.body.replaceChildren(); localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY);
  const warnings = vi.mocked(console.warn).mock.calls.filter(([message]) => String(message).includes('computations created outside'));
  vi.restoreAllMocks(); expect(warnings).toEqual([]);
});

async function mount(width: number, installed?: PluginSettingsOwner) {
  await page.viewport(width, 760);
  const [resource, setResource] = createSignal<string>(); state.resource = resource;
  state.open.mockImplementation((_section: string, target?: { resource?: string }) => setResource(target?.resource));
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <I18nProvider><FloeProvider><Dialog open title="Settings" closeLabel="Close" onOpenChange={() => undefined}>
    <PluginSettingsPanel resource={resource()} installed={installed} />
  </Dialog></FloeProvider></I18nProvider>, host);
  await expect.poll(() => state.list.mock.calls.length).toBe(1);
}

it.each([390, 1100])('uses a labelled Floe resource picker and preserves author drafts at %ipx', async width => {
  await mount(width);
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect.element(dialog.getByRole('group', { name: 'Plugin configuration' })).toBeVisible();
  const picker = dialog.getByRole('combobox', { name: 'Plugin configuration' });
  await picker.click();
  await expect.element(page.getByRole('listbox', { name: 'Plugin configuration' })).toBeVisible();
  await page.getByRole('option', { name: 'Draft A', exact: true }).click();
  await expect.element(dialog.getByRole('textbox', { name: 'Connection draft' })).toBeVisible();
  const editor = document.querySelector('[data-preview-editor="preview-a"]')!;
  await dialog.getByRole('textbox', { name: 'Connection draft' }).fill('https://draft.example');
  await picker.click(); await page.getByRole('option', { name: 'Plugin configuration', exact: true }).click();
  expect(document.querySelector('[data-plugin-center-view]')).toBeNull();
  await picker.click(); await page.getByRole('option', { name: 'Draft A', exact: true }).click();
  await expect.element(dialog.getByRole('textbox', { name: 'Connection draft' })).toHaveValue('https://draft.example');
  expect(document.querySelector('[data-preview-editor="preview-a"]')).toBe(editor);
  const surface = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
});

it.each([390, 1100])('keeps installed connection drafts and exact targets outside Plugin Center at %ipx', async width => {
  const items: PluginInventoryItem[] = ['Metrics', 'Documents'].map((name, index) => ({
    inventoryKey: `instance:${index}`, pluginID: `example.${index}`, pluginInstanceID: `instance-${index}`, displayName: name, description: '', iconFallback: 'generic', category: 'utilities', publisher: 'Workspace', searchKeywords: [], lifecycleState: 'enabled', sourceKind: 'community', pinned: false, managementRevision: 1,
    networkConnectors: [{ connectorID: 'workspace-api', transport: 'http', configurable: true, httpMethods: ['GET'] }],
  }));
  state.connections.mockImplementation(async ({ plugin_instance_id }: { plugin_instance_id: string }) => ({ connections: [{ plugin_instance_id, connector_id: 'workspace-api', transport: 'http', status: 'active', destination: `https://${plugin_instance_id}.example.com`, revision: 1, scope: 'environment', http_methods: ['GET'], private_prefixes: [] }] }));
  const owner: PluginSettingsOwner = { items, ownerScope: {}, loading: false, canManage: true, refresh: async () => undefined, api: { listConnections: state.connections, reviewConnection: state.mutate, approveConnection: state.mutate, cancelConnectionReview: state.mutate, revokeConnection: state.mutate } };
  await mount(width, owner);
  const picker = page.getByRole('combobox', { name: 'Plugin configuration', exact: true });
  await picker.click(); await page.getByRole('option', { name: 'Metrics', exact: true }).click();
  await expect.poll(() => state.connections.mock.calls.length).toBe(1);
  const destination = page.getByRole('textbox', { name: 'Destination', exact: true });
  await expect.element(destination).toBeVisible();
  await destination.fill('https://unsaved.example.com');
  const original = destination.element();
  await picker.click(); await page.getByRole('option', { name: 'Documents', exact: true }).click();
  await expect.element(destination).toHaveValue('https://instance-1.example.com');
  state.open('plugins', { resource: pluginInstalledSettingsResource('missing-instance') });
  await expect.element(page.getByRole('alert')).toHaveTextContent('This settings target is no longer available.');
  expect([...document.querySelectorAll<HTMLElement>('[data-plugin-connections]')].filter(node => node.checkVisibility())).toHaveLength(0);
  await picker.click(); await page.getByRole('option', { name: 'Metrics', exact: true }).click();
  await expect.element(destination).toHaveValue('https://unsaved.example.com');
  expect(destination.element()).toBe(original);
  expect(document.querySelector('[data-plugin-center-view]')).toBeNull();
  expect(state.mutate).not.toHaveBeenCalled();
});

it('requires explicit same-value selection before adopting a replaced author preview', async () => {
  await mount(900);
  const picker = page.getByRole('combobox', { name: 'Plugin configuration' });
  await picker.click(); await page.getByRole('option', { name: 'Draft A', exact: true }).click();
  await expect.poll(() => document.querySelector('[data-preview-editor="preview-a"]')).not.toBeNull();
  state.identity.mockResolvedValue({ preview: { plugin_instance_id: 'preview-replaced' } });
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect.element(page.getByRole('alert')).toHaveTextContent('This settings target is no longer available.');
  expect(document.querySelector('[data-preview-editor="preview-replaced"]')).toBeNull();
  await picker.click(); await page.getByRole('option', { name: 'Draft A', exact: true }).click();
  await expect.poll(() => document.querySelector('[data-preview-editor="preview-replaced"]')).not.toBeNull();
  expect(state.open).toHaveBeenLastCalledWith('plugins', { resource: pluginAuthorSettingsResource({ draftID: 'draft-a', workspaceID: 'author-a' }) });
});

it('preserves installed drafts and their CAS revision across temporary authority and transport loss', async () => {
  const [transport, setTransport] = createSignal<object | false>({});
  const [manage, setManage] = createSignal(true);
  const [ready, setReady] = createSignal(true); state.ready = ready;
  const [generation, setGeneration] = createSignal(0); state.generation = generation;
  const item: PluginInventoryItem = { inventoryKey: 'instance:metrics', pluginID: 'example.metrics', pluginInstanceID: 'metrics-instance', displayName: 'Metrics', description: '', iconFallback: 'generic', category: 'utilities', publisher: 'Workspace', searchKeywords: [], lifecycleState: 'enabled', sourceKind: 'community', pinned: false, managementRevision: 1, networkConnectors: [{ connectorID: 'workspace-api', transport: 'http', configurable: true, httpMethods: ['GET'] }] };
  let serverRevision = 1;
  state.connections.mockImplementation(async () => ({ connections: [{ plugin_instance_id: 'metrics-instance', connector_id: 'workspace-api', transport: 'http', status: 'active', destination: 'https://saved.example.com', revision: serverRevision, scope: 'environment', http_methods: ['GET'], private_prefixes: [] }] }));
  state.mutate.mockResolvedValue({ review: { plugin_instance_id: 'metrics-instance', review_id: 'review-a', connector_id: 'workspace-api', destination: 'https://unsaved.example.com', scope: 'environment', expected_revision: 1, http_methods: ['GET'], review_expires_at: new Date(Date.now() + 60000).toISOString(), expires_at: new Date(Date.now() + 3600000).toISOString() } });
  const owner: PluginSettingsOwner = { get items() { return transport() ? [item] : []; }, get ownerScope() { return transport(); }, loading: false, get canManage() { return manage(); }, refresh: async () => undefined, api: { listConnections: state.connections, reviewConnection: state.mutate, approveConnection: state.mutate, cancelConnectionReview: state.mutate, revokeConnection: state.mutate } };
  await mount(900, owner);
  await page.getByRole('combobox', { name: 'Plugin configuration', exact: true }).click();
  await page.getByRole('option', { name: 'Metrics', exact: true }).click();
  const destination = page.getByRole('textbox', { name: 'Destination', exact: true });
  await expect.element(destination).toHaveValue('https://saved.example.com');
  await destination.fill('https://unsaved.example.com');
  const original = destination.element();
  const review = page.getByRole('button', { name: 'Review connection', exact: true });
  serverRevision = 9; setManage(false);
  await expect.element(destination).toBeDisabled();
  await expect.element(review).toBeDisabled();
  expect(state.mutate).not.toHaveBeenCalled();
  setReady(false); setTransport(false); setGeneration(1);
  expect(original.isConnected).toBe(true);
  expect(original.checkVisibility()).toBe(false);
  expect(state.mutate).not.toHaveBeenCalled();
  setTransport({}); setReady(true); setManage(true);
  await expect.element(destination).toHaveValue('https://unsaved.example.com');
  await expect.element(review).toBeEnabled();
  expect(destination.element()).toBe(original);
  await review.click();
  await expect.poll(() => state.mutate.mock.calls.length).toBe(1);
  expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ plugin_instance_id: 'metrics-instance', connector_id: 'workspace-api', destination: 'https://unsaved.example.com', expected_revision: 1 }), expect.anything());
});
