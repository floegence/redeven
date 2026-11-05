import { PluginCenterView } from './PluginCenterView';
import { projectPluginInventory } from './pluginInventoryProjection';
import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { PluginUpdateReviewDialog } from './PluginUpdateReviewDialog';
import { OFFICIAL_PLUGIN_CATALOG_SEED } from './officialPluginCatalog.test-fixture';
import { exampleInspection, EXAMPLE_PACKAGE_HASHES } from './examplePluginPackage.test-fixture';
import type { PluginInventoryItem, ExternalPluginInspection, ExternalPluginCommitResult } from './pluginTypes';

const official = OFFICIAL_PLUGIN_CATALOG_SEED[0]!;
const inspection = exampleInspection({ intent: { action: 'update', plugin_instance_id: 'metrics', expected_management_revision: 3 } });
const item: PluginInventoryItem = {
  inventoryKey: 'instance:metrics', pluginID: official.pluginID, pluginInstanceID: 'metrics',
  displayName: 'Metrics', publisher: 'Example Publisher', description: '', iconFallback: 'generic',
  category: 'development', searchKeywords: [], pinned: false, sourceKind: 'official',
  externalPackage: { sourceProvenance: { kind: 'package_url', source_origin: 'https://example.com', source_path: '/plugin.redevplugin', redirect_chain: [], package_sha256: 'sha256:' + 'c'.repeat(64), resolved_at: '2026-11-05T00:00:00Z' }, executionApproval: inspection.execution_approval, updateEligibility: inspection.update_eligibility, securitySummary: inspection.security_summary },
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
async function capture(name: string) { await page.screenshot({ path: '../../../.vitest-attachments/package-review/' + name + '.png' }); }

it.each([320, 390, 1180].flatMap(width => ['light', 'dark'].map(theme => ({ width, theme }))))(
  'keeps update review and completion compact at $width in $theme', async ({ width, theme }) => {
    await page.viewport(width, 844); await media.emulateMediaPreferences({ reducedMotion: 'reduce' });
    document.documentElement.classList.toggle('dark', theme === 'dark');
    const [current, setCurrent] = createSignal(item);
    let finish!: () => void;
    const onInspect = vi.fn(async () => inspection); const onRefresh = vi.fn();
    const onCommitExternal = vi.fn(() => new Promise<ExternalPluginCommitResult>(resolve => { finish = () => {
      const hashes = EXAMPLE_PACKAGE_HASHES;
      setCurrent({ ...item, version: official.latestVersion, managementRevision: 4, lifecycleState: 'enabled',
        installedPackage: { packageHash: hashes.package_sha256, manifestHash: hashes.manifest_sha256, entriesHash: hashes.entries_sha256 },
        defaultLaunchTarget: { pluginID: item.pluginID, pluginInstanceID: 'metrics', surfaceID: 'main', displayName: 'Metrics', expectedManagementRevision: 4 } });
      resolve({} as ExternalPluginCommitResult);
    }; }));
    dispose = render(() => <PluginUpdateReviewDialog open item={current()} canManage onOpenChange={vi.fn()}
      onInspect={onInspect} onCommitExternal={onCommitExternal} onRefresh={onRefresh}
      onCommitted={vi.fn()} onOpenSurface={vi.fn()} onViewPermissions={vi.fn()} />, host());
    await expect.poll(() => document.querySelector('[data-plugin-update-submit]')).not.toBeNull();
    await settled(); geometry('[role="dialog"]'); geometry('[data-plugin-update-footer]');
    expect(onInspect).toHaveBeenCalledTimes(1); expect(onRefresh).not.toHaveBeenCalled();
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

it.each([320, 390, 1180])('contains inspection loading and failure at %i px', async (width) => {
  await page.viewport(width, 700);
  let reject!: (error: Error) => void;
  const onInspect = vi.fn(() => new Promise<ExternalPluginInspection>((_resolve, fail) => { reject = fail; }));
  dispose = render(() => <PluginUpdateReviewDialog open item={item} canManage onOpenChange={vi.fn()} onInspect={onInspect} onCommitExternal={vi.fn()} onRefresh={vi.fn()} onCommitted={vi.fn()} onOpenSurface={vi.fn()} onViewPermissions={vi.fn()} />, host());
  await settled(); geometry('[role="dialog"]'); await capture('update-loading-' + width);
  reject(new Error('offline'));
  await expect.poll(() => document.querySelector('[data-plugin-update-retry]')).not.toBeNull();
  await settled(); geometry('[role="dialog"]'); await capture('update-error-' + width);
});

it.each(['official', 'community'] as const)('uses one exact package review for %s market installs', async (sourceKind) => {
  await page.viewport(390, 844);
  const reviewed = exampleInspection();
  const onInspect = vi.fn(async (_request: unknown) => reviewed);
  const onCommit = vi.fn(async () => ({ plugin: { ...reviewed, plugin_instance_id: 'metrics', manifest: { plugin: { display_name: 'Metrics' } }, enable_state: 'enabled', update_eligibility: reviewed.update_eligibility }, operation: { version: reviewed.version, execution: { plugin_instance_id: 'metrics' } } }) as unknown as ExternalPluginCommitResult);
  const onCommitted = vi.fn();
  const projection = projectPluginInventory({ officialCatalog: [{ ...official, sourceKind }], installedPlugins: [] });
  dispose = render(() => <PluginCenterView projection={projection} loading={false} canManagePlugins canOpenPluginSurfaces={false}
    onCommand={vi.fn()} onRefresh={vi.fn()} onInspectExternal={onInspect} onCommitExternal={onCommit} onRefreshInstalled={onCommitted} />, host());
  await userEvent.click(document.querySelector<HTMLButtonElement>('[data-plugin-center-install]')!);
  await expect.poll(() => document.querySelector('[data-external-plugin-confirmation]')).not.toBeNull();
  expect(onInspect).toHaveBeenCalledOnce();
  expect(onInspect.mock.calls[0]?.[0]).toMatchObject({ sourceKind: 'github_repository', expected: official.installPreview });
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  geometry('[role="dialog"]'); geometry('[data-external-plugin-footer]');
  await userEvent.click(dialog.querySelector<HTMLInputElement>('[data-external-plugin-confirmation] input')!);
  await page.getByRole('button', { name: 'Install plugin', exact: true }).click();
  await expect.poll(() => onCommitted.mock.calls.length).toBe(1);
  expect(onCommit).toHaveBeenCalledExactlyOnceWith(reviewed, expect.any(AbortSignal));
  await capture('market-' + sourceKind + '-complete');
});
