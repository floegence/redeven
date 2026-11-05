// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { PluginPlatformRequestError } from '@floegence/redevplugin-ui';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { ExternalPackageInspectionTerminalError } from './pluginApi';
import { PluginUpdateReviewDialog } from './PluginUpdateReviewDialog';
import { exampleInspection, EXAMPLE_PACKAGE_HASHES } from './examplePluginPackage.test-fixture';
import type { ExternalPluginInspection, PluginInventoryItem } from './pluginTypes';

const inspection = exampleInspection({ intent: { action: 'update', plugin_instance_id: 'metrics', expected_management_revision: 3 } });
const item: PluginInventoryItem = {
  inventoryKey: 'instance:metrics', pluginID: inspection.plugin_id, pluginInstanceID: 'metrics',
  displayName: 'Metrics', publisher: 'Example Publisher', description: '', iconFallback: 'generic',
  category: 'development', searchKeywords: [], pinned: false, sourceKind: 'community',
  lifecycleState: 'update_available', version: '4.4.8', managementRevision: 3,
  externalPackage: {
    sourceProvenance: { kind: 'package_url', source_origin: 'https://example.com', source_path: '/plugin.redevplugin', redirect_chain: [], package_sha256: 'sha256:' + 'c'.repeat(64), resolved_at: '2026-11-05T00:00:00Z' },
    executionApproval: inspection.execution_approval, updateEligibility: inspection.update_eligibility, securitySummary: inspection.security_summary,
  },
};
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
function mount(options: Partial<Parameters<typeof PluginUpdateReviewDialog>[0]> = {}) {
  const [current, setCurrent] = createSignal(item);
  const [open, setOpen] = createSignal(true);
  const props = { canManage: true, onOpenChange: setOpen, onInspect: vi.fn(async () => inspection), onCommitExternal: vi.fn(), onRefresh: vi.fn(async () => undefined), onCommitted: vi.fn(), onOpenSurface: vi.fn(), onViewPermissions: vi.fn(), ...options };
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <PluginUpdateReviewDialog {...props} open={open()} item={current()} />, host);
  return { setCurrent, setOpen, props };
}
async function ready() { await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-submit]')).not.toBeNull()); }
it('checks the original source before presenting any update', async () => {
  const { props } = mount(); await ready();
  expect(props.onInspect).toHaveBeenCalledWith({ sourceKind: 'installed_source', pluginInstanceID: 'metrics', expectedManagementRevision: 3 }, expect.any(AbortSignal));
  expect(props.onRefresh).not.toHaveBeenCalled();
  expect(props.onCommitExternal).not.toHaveBeenCalled();
});
it('submits the exact inspection and refreshes after the mutation', async () => {
  const { props } = mount(); await ready();
  document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-complete]')).not.toBeNull());
  expect(props.onCommitExternal).toHaveBeenCalledExactlyOnceWith(inspection, expect.any(AbortSignal));
  expect(props.onRefresh).toHaveBeenCalledTimes(1);
});
it('rejects a changed management revision before submitting', async () => {
  const { setCurrent, props } = mount(); await ready();
  setCurrent({ ...item, managementRevision: 4 });
  document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();
  expect(props.onCommitExternal).not.toHaveBeenCalled();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('target changed');
});
it('discards an inspection response after the review is canceled', async () => {
  let resolve!: (value: ExternalPluginInspection) => void;
  const onInspect = vi.fn((_request, _signal: AbortSignal) => new Promise<ExternalPluginInspection>((done) => { resolve = done; }));
  const { setOpen } = mount({ onInspect });
  await Promise.resolve(); setOpen(false); resolve(inspection); await Promise.resolve();
  expect(onInspect.mock.calls[0]![1].aborted).toBe(true);
  expect(document.querySelector('[data-plugin-update-submit]')).toBeNull();
});
it('reconciles unknown effects without replaying the update', async () => {
  const onCommitExternal = vi.fn().mockRejectedValueOnce(new PluginPlatformRequestError('PLUGIN_INVALID_REQUEST', 'lost response', {}, 'unknown')).mockResolvedValue(undefined);
  const { setCurrent, props } = mount({ onCommitExternal }); await ready();
  document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-reconcile]')).not.toBeNull());
  setCurrent({ ...item, managementRevision: 4, installedPackage: { packageHash: EXAMPLE_PACKAGE_HASHES.package_sha256, manifestHash: EXAMPLE_PACKAGE_HASHES.manifest_sha256, entriesHash: EXAMPLE_PACKAGE_HASHES.entries_sha256 } });
  document.querySelector<HTMLButtonElement>('[data-plugin-update-reconcile]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-complete]')).not.toBeNull());
  expect(onCommitExternal).toHaveBeenCalledTimes(2); expect(props.onRefresh).toHaveBeenCalledTimes(1);
  expect(onCommitExternal.mock.calls[1]![0]).toBe(inspection);
});
it('requires explicit confirmation for changed capabilities', async () => {
  mount({ onInspect: vi.fn(async () => exampleInspection({ ...inspection, security_summary: { ...inspection.security_summary, permissions: [{ permission_id: 'workspace.read', methods: ['read'], effects: ['read'], required: true }] } })) });
  await ready();
  expect(document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.disabled).toBe(true);
});
it('offers a fresh inspection after the reviewed package expires', async () => {
  const { props } = mount({ onInspect: vi.fn(async () => exampleInspection({ ...inspection, expires_at: '2000-01-01T00:00:00Z' })) });
  await ready();
  document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();
  expect(props.onCommitExternal).not.toHaveBeenCalled();
  expect(document.querySelector('[data-plugin-update-retry]')).not.toBeNull();
});
it('offers inventory-only refresh after a committed update', async () => {
  const onRefresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
  const { props } = mount({ onRefresh }); await ready();
  document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-complete]')).not.toBeNull());
  const refresh = document.querySelector<HTMLButtonElement>('[data-plugin-update-refresh]');
  expect(refresh).not.toBeNull();
  refresh!.click();
  await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(2));
  expect(props.onCommitExternal).toHaveBeenCalledTimes(1);
});

it('resolves a failed durable update to fresh review instead of waiting forever', async () => {
  const onCommitExternal = vi.fn()
    .mockRejectedValueOnce(new PluginPlatformRequestError('PLUGIN_INSTALL_INTERRUPTED', 'lost response', {}, 'unknown'))
    .mockRejectedValueOnce(new ExternalPackageInspectionTerminalError('Review again'));
  mount({ onCommitExternal }); await ready();
  document.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-reconcile]')).not.toBeNull());
  document.querySelector<HTMLButtonElement>('[data-plugin-update-reconcile]')!.click();
  await vi.waitFor(() => expect(document.querySelector('[data-plugin-update-retry]')).not.toBeNull());
  expect(onCommitExternal).toHaveBeenCalledTimes(2);
  expect(onCommitExternal.mock.calls[1]![0]).toBe(inspection);
});
