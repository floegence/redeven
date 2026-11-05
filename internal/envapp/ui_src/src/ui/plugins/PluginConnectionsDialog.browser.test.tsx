import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { PluginTransportError } from '@floegence/redevplugin-ui';
import { PluginConnectionsDialog, type PluginConnectionsAPI } from './PluginConnectionsDialog';
import { I18nProvider, type RedevenLocale } from '../i18n';
import { loadEnvAppDictionary } from '../i18n/locales';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from '../i18n/storageKey';
import type { PluginInventoryItem } from './pluginTypes';

const item: PluginInventoryItem = {
  inventoryKey: 'instance:network', pluginID: 'example.network', pluginInstanceID: 'network', displayName: 'Network',
  description: '', publisher: 'Example', iconFallback: 'generic', category: 'development', searchKeywords: [],
  version: '1.0.0', managementRevision: 1, lifecycleState: 'enabled', sourceKind: 'community', pinned: false,
  networkConnectors: [{ connectorID: 'api', transport: 'http', configurable: true, httpMethods: ['GET', 'POST'] }],
};
const connection = { connector_id: 'api', revision: 0, scope: 'environment' as const, status: 'unconfigured' as const };
const reviewed = {
  plugin_instance_id: 'network', connector_id: 'api', expected_revision: 0, review_id: 'exact-review',
  scope: 'environment' as const, destination: 'http://127.0.0.1:18080/', private_prefixes: ['127.0.0.1/32'],
  http_methods: ['GET' as const], expires_at: new Date(Date.now() + 30 * 86400000).toISOString(), review_expires_at: new Date(Date.now() + 300000).toISOString(),
};
const active = { ...connection, status: 'active' as const, revision: 1, destination: reviewed.destination, private_prefixes: reviewed.private_prefixes, http_methods: reviewed.http_methods };
const disposers: (() => void)[] = [];
function mount(overrides: Partial<PluginConnectionsAPI> = {}, initialManage = true, localized = false) {
  const host = document.createElement('div'); document.body.append(host);
  const [open, setOpen] = createSignal(true); const [owner, setOwner] = createSignal<object>({});
  const [canManage, setCanManage] = createSignal(initialManage); const [currentItem, setItem] = createSignal(item);
  const api = {
    listConnections: vi.fn(async () => ({ connections: [connection] })),
    reviewConnection: vi.fn(async () => ({ review: reviewed })),
    approveConnection: vi.fn(async () => active),
    cancelConnectionReview: vi.fn(async () => ({ canceled: true as const })),
    revokeConnection: vi.fn(async () => ({ revoked: true as const })), ...overrides,
  };
  const view = () => <PluginConnectionsDialog open={open()} item={currentItem()} ownerScope={owner()}
    canManage={canManage()} api={api} onOpenChange={setOpen} />;
  disposers.push(render(() => localized ? <I18nProvider>{view()}</I18nProvider> : view(), host));
  return { api, open, setOwner, setCanManage, setItem };
}
async function ready() { await vi.waitFor(() => expect(document.querySelector('select')?.disabled).toBe(false)); }
async function prepare() {
  await ready();
  await page.getByRole('textbox', { name: 'Destination', exact: true }).fill(reviewed.destination);
  await page.getByRole('textbox', { name: 'Private networks (optional)' }).fill('127.0.0.1/32');
  await page.getByRole('checkbox', { name: 'GET', exact: true }).click();
  await page.getByRole('button', { name: 'Review connection', exact: true }).click();
  await vi.waitFor(() => expect(document.querySelector('[data-connection-review]')).not.toBeNull());
}
afterEach(() => { while (disposers.length) disposers.pop()?.(); document.body.replaceChildren(); localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY); });

it('requires a separate explicit approval and binds the exact reviewed identity', async () => {
  const mounted = mount(); await prepare();
  expect(mounted.api.approveConnection).not.toHaveBeenCalled();
  expect(mounted.api.reviewConnection).toHaveBeenCalledWith({ plugin_instance_id: 'network', connector_id: 'api',
    destination: reviewed.destination, expected_revision: 0, private_prefixes: ['127.0.0.1/32'], http_methods: ['GET'] }, expect.anything());
  expect(document.querySelector('[data-connection-review]')?.textContent).toContain('Environment');
  expect(document.querySelector('[data-connection-review]')?.textContent).toContain('127.0.0.1/32');
  const button = page.getByRole('button', { name: 'Approve connection', exact: true }); await button.click();
  await ready();
  expect(mounted.api.approveConnection).toHaveBeenCalledTimes(1);
  expect(mounted.api.approveConnection).toHaveBeenCalledWith({ plugin_instance_id: 'network', review_id: 'exact-review' }, expect.anything());
  expect(mounted.api.listConnections).toHaveBeenCalledTimes(2);
});
it('cancels a review without committing a connection', async () => {
  const mounted = mount(); await prepare();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await ready();
  expect(mounted.api.cancelConnectionReview).toHaveBeenCalledWith({ plugin_instance_id: 'network', review_id: 'exact-review' }, expect.anything());
  expect(mounted.api.approveConnection).not.toHaveBeenCalled();
});
it('finishes canceling the exact review before closing the dialog', async () => {
  let finish!: () => void;
  let requestSignal: AbortSignal | undefined;
  const cancel = vi.fn(async (_request, options) => {
    requestSignal = options?.signal;
    await new Promise<void>((resolve) => { finish = resolve; });
    return { canceled: true as const };
  });
  const mounted = mount({ cancelConnectionReview: cancel }); await prepare();
  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() => expect(cancel).toHaveBeenCalledTimes(1));
  expect(mounted.open()).toBe(true);
  expect(requestSignal?.aborted).toBe(false);
  finish();
  await vi.waitFor(() => expect(mounted.open()).toBe(false));
  expect(mounted.api.approveConnection).not.toHaveBeenCalled();
});
it('reconciles a lost approval response and never replays the one-use review', async () => {
  const list = vi.fn().mockResolvedValueOnce({ connections: [connection] }).mockResolvedValue({ connections: [active] });
  const approve = vi.fn(async () => { throw new PluginTransportError('Response lost', undefined, 'unknown'); });
  mount({ listConnections: list, approveConnection: approve }); await prepare();
  await page.getByRole('button', { name: 'Approve connection', exact: true }).click(); await ready();
  expect(approve).toHaveBeenCalledTimes(1); expect(list).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('outcome is uncertain');
  expect(document.querySelector('[data-connection-review]')).toBeNull();
  expect(document.querySelector('select')?.textContent).toContain('Active');
});
it('blocks further writes when reconciliation fails', async () => {
  const list = vi.fn().mockResolvedValueOnce({ connections: [connection] }).mockRejectedValue(new Error('Offline'));
  mount({ listConnections: list }); await prepare();
  await page.getByRole('button', { name: 'Approve connection', exact: true }).click();
  await vi.waitFor(() => expect(document.querySelector('[role="alert"]')).not.toBeNull());
  await expect.element(page.getByRole('button', { name: 'Review connection', exact: true })).toBeDisabled();
});
it('revokes the exact current revision and refreshes authority', async () => {
  const mounted = mount({ listConnections: vi.fn(async () => ({ connections: [active] })) }); await ready();
  await page.getByRole('button', { name: 'Revoke connection', exact: true }).click(); await ready();
  expect(mounted.api.revokeConnection).toHaveBeenCalledWith({ plugin_instance_id: 'network', connector_id: 'api', expected_revision: 1 }, expect.anything());
});
it('projects read-only connections without authorizing a mutation', async () => {
  const mounted = mount({}, false); await ready();
  await expect.element(page.getByRole('textbox', { name: 'Destination', exact: true })).toBeDisabled();
  await expect.element(page.getByRole('button', { name: 'Review connection', exact: true })).toBeDisabled();
  expect(mounted.api.reviewConnection).not.toHaveBeenCalled();
});
it.each(['owner', 'permission', 'revision'] as const)('invalidates a pending review on %s change', async (change) => {
  const mounted = mount(); await prepare();
  if (change === 'owner') mounted.setOwner({});
  if (change === 'permission') mounted.setCanManage(false);
  if (change === 'revision') mounted.setItem({ ...item, managementRevision: 2 });
  await ready(); expect(document.querySelector('[data-connection-review]')).toBeNull();
  expect(mounted.api.approveConnection).not.toHaveBeenCalled();
});
it('ignores a stale response after owner replacement', async () => {
  let resolve!: (value: Awaited<ReturnType<PluginConnectionsAPI['listConnections']>>) => void;
  const first = new Promise<Awaited<ReturnType<PluginConnectionsAPI['listConnections']>>>((done) => { resolve = done; });
  const list = vi.fn().mockReturnValueOnce(first).mockResolvedValue({ connections: [connection] });
  const mounted = mount({ listConnections: list }); mounted.setOwner({}); await ready();
  resolve({ connections: [active] }); await Promise.resolve();
  expect(document.querySelector('select')?.textContent).toContain('Not configured');
});

it.each([390, 1280])('keeps connection controls and review readable at %i pixels', async (width) => {
  await page.viewport(width, 844); mount(); await prepare();
  const dialog = document.querySelector<HTMLElement>('[data-plugin-connections]')!;
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
  for (const button of dialog.querySelectorAll('button')) {
    expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
  }
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await ready();
  await page.viewport(1280, 844);
});
it.each(['zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'] as RedevenLocale[])('renders explicit %s connection copy', async (locale) => {
  localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
  await loadEnvAppDictionary(locale); mount({}, true, true); await ready();
  expect(document.body.textContent).not.toContain('uiCopy.plugin.connections');
  expect(document.body.textContent).not.toContain('Private networks (optional)');
});
