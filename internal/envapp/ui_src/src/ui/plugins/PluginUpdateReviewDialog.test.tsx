// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { PluginPlatformRequestError } from '@floegence/redevplugin-ui';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { PluginUpdateReviewDialog } from './PluginUpdateReviewDialog';
import { OFFICIAL_PLUGIN_CATALOG_SEED, OFFICIAL_PLUGIN_MARKET_DETAIL } from './officialPluginCatalog.test-fixture';
import type { PluginInventoryItem } from './pluginTypes';

const officialItem: PluginInventoryItem = {
  inventoryKey: 'instance:metrics', pluginID: 'com.example.metrics', pluginInstanceID: 'metrics',
  displayName: 'Metrics', publisher: 'Example Publisher', description: '', iconFallback: 'generic',
  category: 'development', searchKeywords: [], pinned: false, trustBadge: 'official',
  lifecycleState: 'update_available', version: '4.4.8', managementRevision: 3,
  officialCatalog: OFFICIAL_PLUGIN_CATALOG_SEED[0],
};
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

it('renders verified official review without refreshing the market or downloading the package', async () => {
  const onRefresh = vi.fn(() => new Promise<void>(() => undefined));
  const onInspect = vi.fn(() => new Promise<never>(() => undefined));
  const onOfficialUpdate = vi.fn();
  const mount = document.createElement('div'); document.body.append(mount);
  dispose = render(() => <PluginUpdateReviewDialog open item={officialItem} canManage onOpenChange={vi.fn()}
    onInspect={onInspect} onCommitExternal={vi.fn()} onOfficialUpdate={onOfficialUpdate}
    onRefresh={onRefresh} onCommitted={vi.fn()} onOpenSurface={vi.fn()} onViewPermissions={vi.fn()} />, mount);
  await Promise.resolve();
  expect(document.querySelector('[data-plugin-update-submit]')).not.toBeNull();
  expect(onRefresh).not.toHaveBeenCalled();
  expect(onInspect).not.toHaveBeenCalled();
  expect(onOfficialUpdate).not.toHaveBeenCalled();
});

function mountReview(item = officialItem, options: Partial<Parameters<typeof PluginUpdateReviewDialog>[0]> = {}) {
  const [current, setCurrent] = createSignal(item);
  const [open, setOpen] = createSignal(true);
  const onOfficialUpdate = vi.fn(async () => undefined);
  const onRefresh = vi.fn(async () => undefined);
  const props = { canManage: true, onOpenChange: setOpen, onInspect: vi.fn(), onCommitExternal: vi.fn(),
    onOfficialUpdate, onRefresh, onCommitted: vi.fn(), onOpenSurface: vi.fn(), onViewPermissions: vi.fn(), ...options };
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <PluginUpdateReviewDialog {...props} open={open()} item={current()} />, host);
  return { setCurrent, setOpen, props };
}

it('submits the exact reviewed release and refreshes only after the mutation', async () => {
  const { props } = mountReview();
  await Promise.resolve();
  document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-complete]')).not.toBeNull());
  expect(props.onOfficialUpdate).toHaveBeenCalledExactlyOnceWith(officialItem, officialItem.officialCatalog!.distribution.releaseRef);
  expect(props.onRefresh).toHaveBeenCalledOnce();
  expect(props.onInspect).not.toHaveBeenCalled();
});

it.each(['revision', 'release', 'revoked'] as const)('rejects a changed %s before submitting', async (change) => {
  const { setCurrent, props } = mountReview();
  await Promise.resolve();
  const changed = structuredClone(officialItem);
  if (change === 'revision') changed.managementRevision!++;
  if (change === 'revoked') changed.officialCatalog!.rolloutState = 'revoked';
  if (change === 'release') changed.officialCatalog!.distribution.releaseRef = {
    ...changed.officialCatalog!.distribution.releaseRef, release_metadata_sha256: 'f'.repeat(64),
  };
  setCurrent(changed);
  document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();
  await Promise.resolve();
  expect(props.onOfficialUpdate).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('target changed');
});

it('discards a canceled detail response after the dialog is reopened', async () => {
  let resolveDetail!: (value: typeof OFFICIAL_PLUGIN_MARKET_DETAIL) => void;
  let signal!: AbortSignal;
  const onLoadMarketDetail = vi.fn((_id: string, _generation: number, current: AbortSignal) => {
    signal = current;
    return new Promise<typeof OFFICIAL_PLUGIN_MARKET_DETAIL>((resolve) => { resolveDetail = resolve; });
  });
  const { setCurrent, setOpen } = mountReview({ ...officialItem,
    officialCatalog: { ...officialItem.officialCatalog!, installPreview: undefined } }, { onLoadMarketDetail });
  await Promise.resolve();
  document.querySelector<HTMLButtonElement>('[data-plugin-update-cancel]')!.click();
  expect(signal.aborted).toBe(true);
  setCurrent(officialItem); setOpen(true);
  resolveDetail({ ...OFFICIAL_PLUGIN_MARKET_DETAIL, generation: 999 });
  await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector('[data-plugin-update-submit]')).not.toBeNull();
  expect(document.querySelector('[role="alert"]')).toBeNull();
});

it('reconciles an unknown outcome without replaying the update', async () => {
  const onOfficialUpdate = vi.fn(async () => { throw new PluginPlatformRequestError('PLUGIN_INVALID_REQUEST', 'lost response', {}, 'unknown'); });
  const { setCurrent, props } = mountReview(officialItem, { onOfficialUpdate });
  await Promise.resolve();
  document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-reconcile]')).not.toBeNull());
  const hashes = officialItem.officialCatalog!.distribution.releaseRef.expected_hashes;
  setCurrent({ ...officialItem, managementRevision: 4, installedPackage: {
    packageHash: hashes.package_sha256, manifestHash: hashes.manifest_sha256,
    entriesHash: hashes.entries_sha256,
  } });
  document.querySelector<HTMLButtonElement>('[data-plugin-update-reconcile]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-complete]')).not.toBeNull());
  expect(onOfficialUpdate).toHaveBeenCalledOnce();
  expect(props.onRefresh).toHaveBeenCalledOnce();
});
