import '../../index.css';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { I18nProvider } from '../i18n';
import type { PluginInventoryItem } from './pluginTypes';
import { PluginAuthorAccess } from './PluginAuthorAccess';

const api = vi.hoisted(() => ({
  loadInventoryProjection: vi.fn(), execute: vi.fn(), listConnections: vi.fn(),
  reviewConnection: vi.fn(), approveConnection: vi.fn(), cancelConnectionReview: vi.fn(), revokeConnection: vi.fn(),
}));
vi.mock('./pluginApi', async (original) => ({ ...await original<typeof import('./pluginApi')>(), createPluginLifecycleAPI: () => api }));
const item: PluginInventoryItem = {
  inventoryKey: 'instance:preview', pluginID: 'example.network', pluginInstanceID: 'preview',
  displayName: 'Preview', description: '', publisher: 'Example', iconFallback: 'generic',
  category: 'development', searchKeywords: [], version: '1.0.0', managementRevision: 1,
  lifecycleState: 'enabled', sourceKind: 'community', pinned: false,
  networkConnectors: [{ connectorID: 'api', transport: 'http', configurable: true, httpMethods: ['GET'] }],
};
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'warn');
  api.loadInventoryProjection.mockResolvedValue({ items: [item] });
  api.listConnections.mockResolvedValue({ connections: [{ connector_id: 'api', revision: 0, scope: 'environment', status: 'unconfigured' }] });
});
afterEach(() => {
  dispose?.(); dispose = undefined; document.body.replaceChildren();
  const ownerWarnings = vi.mocked(console.warn).mock.calls.filter(([message]) => String(message).includes('computations created outside'));
  vi.restoreAllMocks();
  expect(ownerWarnings).toHaveLength(0);
});
function mount(embedded = false) {
  const [visible, setVisible] = createSignal(true);
  const [canManage, setCanManage] = createSignal(true);
  const [authority, setAuthority] = createSignal<false | number>(1);
  const host = document.createElement('div'); document.body.append(host);
  const onError = vi.fn();
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginAuthorAccess workspaceID="author-1" pluginInstanceID="preview" embeddedConnections={embedded} visible={visible()} canManage={canManage()} authorityKey={authority()} onChanged={vi.fn()} onError={onError} /></I18nProvider></FloeConfigProvider>, host);
  return { onError, setVisible, setCanManage, setAuthority };
}
it('opens connections for the exact preview owner and loads their state', async () => {
  mount();
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await expect.element(page.getByRole('dialog')).toBeVisible();
  expect(api.listConnections).toHaveBeenCalledWith({ plugin_instance_id: 'preview' }, expect.anything());
});
it('shows a retry action after an inventory failure', async () => {
  api.loadInventoryProjection.mockRejectedValueOnce(new Error('offline'));
  mount();
  await expect.element(page.getByRole('alert')).toBeVisible();
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Connections', exact: true })).toBeVisible();
  expect(api.loadInventoryProjection).toHaveBeenCalledTimes(2);
});
it('ignores an inventory failure after the panel has closed', async () => {
  let reject!: (error: Error) => void;
  api.loadInventoryProjection.mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
  const { onError } = mount();
  await expect.poll(() => api.loadInventoryProjection.mock.calls.length).toBe(1);
  dispose?.(); dispose = undefined; reject(new Error('late failure'));
  await Promise.resolve(); await Promise.resolve();
  expect(onError).not.toHaveBeenCalled();
});

it('embeds author connections without a second dialog and retains the draft while hidden', async () => {
  const { setVisible } = mount(true);
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toBeVisible();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await page.getByRole('textbox', { name: 'Destination', exact: true }).fill('https://draft.example');
  setVisible(false);
  expect(document.querySelector('section')!.hidden).toBe(true);
  setVisible(true);
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toHaveValue('https://draft.example');
  expect(api.approveConnection).not.toHaveBeenCalled(); expect(api.execute).not.toHaveBeenCalled();
});
it('revokes management admission when author authority disappears', async () => {
  const { setAuthority } = mount(true);
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toBeVisible();
  setAuthority(false);
  await expect.element(page.getByRole('alert')).toBeVisible();
  expect(document.querySelector('[data-plugin-connections]')).not.toBeNull();
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toBeDisabled();
  expect(api.approveConnection).not.toHaveBeenCalled(); expect(api.execute).not.toHaveBeenCalled();
});

it('grants only the exact author preview permission after confirmation and hides confirmation with Settings', async () => {
  api.loadInventoryProjection.mockResolvedValue({ items: [{ ...item, authorization: {
    grants: [], permissions: [{ permissionID: 'metrics.read', group: 'read', requiredToOpen: true, methods: ['metrics.status'], requiredToOpenMethods: ['metrics.status'], granted: false, deniedByGrant: false, blockedByPolicy: false, grantBlockedByPolicy: false, blockedToOpen: false }],
    revisions: { policyRevision: 3, managementRevision: 1, revokeEpoch: 2 },
  } }] });
  api.execute.mockResolvedValue({}); const { setVisible } = mount(true);
  await page.getByRole('textbox', { name: 'Destination', exact: true }).fill('https://permission-draft.example/');
  const connectionEditor = document.querySelector('[data-plugin-connections]');
  await page.getByRole('switch', { name: 'Change Read data permission', exact: true }).click();
  await expect.element(page.getByRole('dialog')).toBeVisible(); expect(api.execute).not.toHaveBeenCalled();
  setVisible(false); await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  setVisible(true); await page.getByRole('button', { name: 'Grant', exact: true }).click();
  expect(api.execute).toHaveBeenCalledWith({ type: 'grant_permission', pluginInstanceID: 'preview', permissionID: 'metrics.read', expectedPolicyRevision: 3, expectedManagementRevision: 1, expectedRevokeEpoch: 2 });
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toBeEnabled();
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toHaveValue('https://permission-draft.example/');
  expect(document.querySelector('[data-plugin-connections]')).toBe(connectionEditor);
});
it('reviews and approves a connection for the author preview from the embedded settings editor', async () => {
  api.reviewConnection.mockResolvedValue({ review: { plugin_instance_id: 'preview', connector_id: 'api', expected_revision: 0, review_id: 'review-author', scope: 'environment', destination: 'https://preview.example/', http_methods: ['GET'], expires_at: new Date(Date.now() + 86400000).toISOString(), review_expires_at: new Date(Date.now() + 60000).toISOString() } });
  api.approveConnection.mockResolvedValue({}); mount(true);
  await page.getByRole('textbox', { name: 'Destination', exact: true }).fill('https://preview.example/');
  await userEvent.click(page.getByRole('checkbox', { name: 'GET', exact: true }).element().closest('label')!);
  await page.getByRole('button', { name: 'Review connection', exact: true }).click();
  expect(api.approveConnection).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
  expect(api.approveConnection).toHaveBeenCalledWith({ plugin_instance_id: 'preview', review_id: 'review-author' }, expect.anything());
});

it.each(['authority', 'management'] as const)('retains the same author connection draft across %s revalidation', async (change) => {
  const mounted = mount(true);
  await page.getByRole('textbox', { name: 'Destination', exact: true }).fill('https://retained.example/');
  await page.getByRole('textbox', { name: 'Private networks (optional)' }).fill('10.1.0.0/16');
  await userEvent.click(page.getByRole('checkbox', { name: 'GET', exact: true }).element().closest('label')!);
  const editor = document.querySelector('[data-plugin-connections]');
  if (change === 'authority') mounted.setAuthority(false); else mounted.setCanManage(false);
  await Promise.resolve();
  expect(document.querySelector('[data-plugin-connections]')).toBe(editor);
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toBeDisabled();
  if (change === 'authority') mounted.setAuthority(1); else mounted.setCanManage(true);
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toBeEnabled();
  expect(document.querySelector('[data-plugin-connections]')).toBe(editor);
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toHaveValue('https://retained.example/');
  await expect.element(page.getByRole('textbox', { name: 'Private networks (optional)' })).toHaveValue('10.1.0.0/16');
  await expect.element(page.getByRole('checkbox', { name: 'GET', exact: true })).toBeChecked();
  expect(api.reviewConnection).not.toHaveBeenCalled(); expect(api.approveConnection).not.toHaveBeenCalled();
});

it.each(['authority', 'management'] as const)('invalidates connection review across %s loss while keeping its draft and original CAS revision', async (change) => {
  api.reviewConnection.mockResolvedValue({ review: { plugin_instance_id: 'preview', connector_id: 'api', expected_revision: 0, review_id: 'review-author', scope: 'environment', destination: 'https://draft.example/', http_methods: ['GET'], expires_at: new Date(Date.now() + 86400000).toISOString(), review_expires_at: new Date(Date.now() + 60000).toISOString() } });
  const mounted = mount(true);
  await page.getByRole('textbox', { name: 'Destination', exact: true }).fill('https://draft.example/');
  await userEvent.click(page.getByRole('checkbox', { name: 'GET', exact: true }).element().closest('label')!);
  await page.getByRole('button', { name: 'Review connection', exact: true }).click();
  await expect.element(page.getByRole('button', { name: 'Approve connection', exact: true })).toBeVisible();
  api.listConnections.mockResolvedValue({ connections: [{ connector_id: 'api', revision: 9, scope: 'environment', status: 'active', destination: 'https://other.example/', http_methods: ['GET'] }] });
  if (change === 'authority') mounted.setAuthority(false); else mounted.setCanManage(false);
  await expect.element(page.getByRole('button', { name: 'Approve connection', exact: true })).not.toBeInTheDocument();
  if (change === 'authority') mounted.setAuthority(2); else mounted.setCanManage(true);
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toBeEnabled();
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toHaveValue('https://draft.example/');
  expect(api.approveConnection).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Review connection', exact: true }).click();
  expect(api.reviewConnection).toHaveBeenLastCalledWith(expect.objectContaining({ plugin_instance_id: 'preview', destination: 'https://draft.example/', expected_revision: 0 }), expect.anything());
});
