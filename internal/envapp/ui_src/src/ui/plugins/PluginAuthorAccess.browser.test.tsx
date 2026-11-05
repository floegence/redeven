import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
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
  api.loadInventoryProjection.mockResolvedValue({ items: [item] });
  api.listConnections.mockResolvedValue({ connections: [{ connector_id: 'api', revision: 0, scope: 'environment', status: 'unconfigured' }] });
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); });
function mount() {
  const host = document.createElement('div'); document.body.append(host);
  const onError = vi.fn();
  dispose = render(() => <FloeConfigProvider><I18nProvider><PluginAuthorAccess workspaceID="author-1" pluginInstanceID="preview" canManage onChanged={vi.fn()} onError={onError} /></I18nProvider></FloeConfigProvider>, host);
  return { onError };
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
