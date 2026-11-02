import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { PluginUpdateReviewDialog } from './PluginUpdateReviewDialog';
import { PluginCenterView } from './PluginCenterView';
import { OFFICIAL_PLUGIN_CATALOG_SEED } from './officialPluginCatalog.test-fixture';
import type { PluginInventoryItem, PluginMarketDetail } from './pluginTypes';

const official = OFFICIAL_PLUGIN_CATALOG_SEED[0]!;
const item: PluginInventoryItem = {
  inventoryKey: 'instance:metrics', pluginID: official.pluginID, pluginInstanceID: 'metrics',
  displayName: 'Metrics', publisher: 'Example Publisher', description: '', iconFallback: 'generic',
  category: 'development', searchKeywords: [], pinned: false, trustBadge: 'official',
  lifecycleState: 'update_available', version: '4.4.8', managementRevision: 3, officialCatalog: official,
};
const media = commands as unknown as { emulateMediaPreferences: (options: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
let dispose: (() => void) | undefined;
afterEach(async () => {
  dispose?.(); document.body.replaceChildren(); document.documentElement.classList.remove('dark');
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
});
function host() { const el = document.createElement('div'); document.body.append(el); return el; }
async function settled() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }
function geometry(selector: string, maxHeight?: number) {
  const el = document.querySelector<HTMLElement>(selector)!;
  expect(el).not.toBeNull();
  const rect = el.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(0); expect(rect.top).toBeGreaterThanOrEqual(0);
  expect(rect.right).toBeLessThanOrEqual(innerWidth + 1); expect(rect.bottom).toBeLessThanOrEqual(innerHeight + 1);
  expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth + 1);
  if (maxHeight) expect(rect.height).toBeLessThan(maxHeight);
  return rect;
}
async function capture(name: string) { await page.screenshot({ path: 'package-review/' + name + '.png' }); }

it.each([320, 390, 1180].flatMap(width => ['light', 'dark'].map(theme => ({ width, theme }))))(
  'keeps update review and completion compact at $width in $theme', async ({ width, theme }) => {
    await page.viewport(width, 844); await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const [current, setCurrent] = createSignal(item);
    let finish!: () => void;
    const onInspect = vi.fn(); const onRefresh = vi.fn();
    const onOfficialUpdate = vi.fn(() => new Promise<void>(resolve => { finish = () => {
      const hashes = official.distribution.releaseRef.expected_hashes;
      setCurrent({ ...item, version: official.latestVersion, managementRevision: 4, lifecycleState: 'enabled',
        installedPackage: { packageHash: hashes.package_sha256, manifestHash: hashes.manifest_sha256, entriesHash: hashes.entries_sha256 },
        defaultLaunchTarget: { pluginID: item.pluginID, pluginInstanceID: 'metrics', surfaceID: 'main', displayName: 'Metrics', expectedManagementRevision: 4 } });
      resolve();
    }; }));
    dispose = render(() => <PluginUpdateReviewDialog open item={current()} canManage onOpenChange={vi.fn()}
      onInspect={onInspect} onCommitExternal={vi.fn()} onOfficialUpdate={onOfficialUpdate} onRefresh={onRefresh}
      onCommitted={vi.fn()} onOpenSurface={vi.fn()} onViewPermissions={vi.fn()} />, host());
    await expect.poll(() => document.querySelector('[data-plugin-update-submit]')).not.toBeNull();
    await settled(); geometry('[role="dialog"]'); geometry('[data-plugin-update-footer]');
    expect(onInspect).not.toHaveBeenCalled(); expect(onRefresh).not.toHaveBeenCalled();
    await capture('update-review-' + width + '-' + theme);
    await userEvent.click(document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!);
    await settled(); geometry('[role="dialog"]', 350);
    await capture('update-installing-' + width + '-' + theme);
    finish();
    await expect.poll(() => document.querySelector('[data-plugin-update-complete]')).not.toBeNull();
    await settled(); geometry('[role="dialog"]', 360); geometry('[data-plugin-update-footer]');
    expect(document.querySelector('[data-plugin-update-open]')).not.toBeNull();
    await capture('update-complete-' + width + '-' + theme);
  },
);

it.each([320, 390, 1180])('contains loading, failure and long review at %i px', async (width) => {
  await page.viewport(width, 700); await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  let reject!: (error: Error) => void;
  const onLoadMarketDetail = vi.fn(() => new Promise<PluginMarketDetail>((_, fail) => { reject = fail; }));
  const [current, setCurrent] = createSignal({ ...item, officialCatalog: { ...official, installPreview: undefined } } as PluginInventoryItem);
  const props = { onOpenChange: vi.fn(), onInspect: vi.fn(), onCommitExternal: vi.fn(), onOfficialUpdate: vi.fn(),
    onRefresh: vi.fn(), onCommitted: vi.fn(), onOpenSurface: vi.fn(), onViewPermissions: vi.fn() };
  dispose = render(() => <PluginUpdateReviewDialog {...props} open item={current()} canManage onLoadMarketDetail={onLoadMarketDetail} />, host());
  await expect.poll(() => document.querySelector('[data-plugin-update-cancel]')).not.toBeNull();
  await settled(); geometry('[role="dialog"]', 340); await capture('update-loading-' + width);
  reject(new Error('offline'));
  await expect.poll(() => document.querySelector('[data-plugin-update-retry]')).not.toBeNull();
  await settled(); geometry('[role="dialog"]', 380); await capture('update-error-' + width);
  const preview = { ...official.installPreview!, security_summary: { ...official.installPreview!.security_summary,
    permissions: Array.from({ length: 24 }, (_, i) => ({ permission_id: 'long.permission.' + i, required: true, effects: ['read'] })) } };
  setCurrent({ ...item, displayName: 'Metrics '.repeat(14), officialCatalog: { ...official, installPreview: preview } });
  document.querySelector<HTMLButtonElement>('[data-plugin-update-retry]')!.click();
  await expect.poll(() => document.querySelector('[data-plugin-update-submit]')).not.toBeNull();
  await settled(); geometry('[role="dialog"]'); geometry('[data-plugin-update-footer]');
  await userEvent.click(document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!);
  expect(props.onOfficialUpdate).toHaveBeenCalledOnce();
});

it.each([320, 390, 1180])('keeps official install preview and completion contained at %i px', async (width) => {
  await page.viewport(width, 844); await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
  const catalogItem = { ...item, inventoryKey: 'catalog:metrics', pluginInstanceID: undefined, version: undefined, lifecycleState: 'not_installed' as const };
  const [items, setItems] = createSignal<PluginInventoryItem[]>([catalogItem]);
  const onCommand = vi.fn(async () => { setItems([{ ...item, pluginInstanceID: official.pluginInstanceID, lifecycleState: 'enabled', version: official.latestVersion }]); });
  const mount = host();
  dispose = render(() => <PluginCenterView projection={{ items: items() }} loading={false} canManagePlugins canOpenPluginSurfaces onRefresh={vi.fn()} onCommand={onCommand} />, mount);
  await expect.poll(() => mount.querySelector('[data-plugin-center-install]')).not.toBeNull();
  await userEvent.click(mount.querySelector<HTMLButtonElement>('[data-plugin-center-install]')!);
  await expect.poll(() => document.querySelector('[data-plugin-install-review-confirm]')).not.toBeNull();
  await settled(); geometry('[role="dialog"]'); geometry('[data-plugin-install-review-confirm]');
  await capture('install-review-' + width);
  await userEvent.click(document.querySelector<HTMLButtonElement>('[data-plugin-install-review-confirm]')!);
  await expect.poll(() => document.querySelector('[data-plugin-install-complete]')).not.toBeNull();
  await settled(); geometry('[role="dialog"]', 340); await capture('install-complete-' + width);
});
