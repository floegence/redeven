// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PluginTransportError } from '@floegence/redevplugin-ui';

import { PluginUpdateReviewDialog } from './PluginUpdateReviewDialog';
import { officialPluginCatalog } from './officialPluginCatalog';
import type { PluginDevelopmentDelivery, PluginInventoryItem } from './pluginTypes';

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Dialog: (props: { open: boolean; title: string; children: JSX.Element; footer?: JSX.Element; onOpenChange: (open: boolean) => void }) => props.open ? (
    <section role="dialog" aria-label={props.title}>
      <button data-dialog-dismiss type="button" onClick={() => props.onOpenChange(false)}>Dismiss</button>
      {props.children}
      <footer>{props.footer}</footer>
    </section>
  ) : null,
}));

const delivery: PluginDevelopmentDelivery = {
  plugin_instance_id: 'plugini_redeven_official_containers',
  publisher_id: 'com.redeven.official',
  plugin_id: 'com.redeven.official.containers',
  version: '4.0.0',
  package_url: '/development/containers.redevplugin',
  package_sha256: 'a'.repeat(64),
  package_hash: 'sha256:target-package',
  manifest_hash: 'sha256:target-manifest',
  entries_hash: 'sha256:target-entries',
  capability_version: '3.0.0',
  release_notes_id: 'containers-4.0.0',
  release_notes_summary_sha256: '0bdb5e7ab960173b2855cf31fef9f3d635f90325b90215fa10e6bb639459504e',
  development_only: true,
};

function updateItem(): PluginInventoryItem {
  return {
    inventoryKey: `instance:${delivery.plugin_instance_id}`,
    pluginID: delivery.plugin_id,
    pluginInstanceID: delivery.plugin_instance_id,
    displayName: 'Containers',
    description: 'Containers',
    iconFallback: 'containers',
    category: 'infrastructure',
    searchKeywords: [],
    publisher: 'Redeven',
    version: '4.0.0',
    managementRevision: 8,
    installedPackage: { packageHash: 'sha256:old', manifestHash: 'sha256:old', entriesHash: 'sha256:old' },
    lifecycleState: 'update_available',
    trustBadge: 'unsigned',
    pinned: false,
    officialCatalog: officialPluginCatalog(delivery)[0],
    defaultLaunchTarget: {
      pluginID: delivery.plugin_id,
      pluginInstanceID: delivery.plugin_instance_id,
      surfaceID: 'containers.dashboard',
      expectedManagementRevision: 8,
      preferredPlacement: 'activity',
    },
  };
}

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; document.body.innerHTML = ''; });

function mountDialog(overrides: Partial<Parameters<typeof PluginUpdateReviewDialog>[0]> = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const props = {
    open: true,
    item: updateItem(),
    canManage: true,
    onOpenChange: vi.fn(),
    onInspect: vi.fn(),
    onCommitExternal: vi.fn(),
    onCommitDevelopment: vi.fn(async () => undefined),
    onRefresh: vi.fn(async () => undefined),
    onCommitted: vi.fn(),
    onOpenActivity: vi.fn(),
    onViewPermissions: vi.fn(),
    ...overrides,
  };
  dispose = render(() => <PluginUpdateReviewDialog {...props} />, host);
  return { host, props };
}

describe('PluginUpdateReviewDialog', () => {
  it('opens development review without a mutation and keeps a single-line explicit submit action', async () => {
    const { host, props } = mountDialog();
    await vi.waitFor(() => expect(host.querySelector('[data-plugin-update-submit]')).not.toBeNull());
    expect(props.onCommitDevelopment).not.toHaveBeenCalled();
    expect(host.textContent).toContain('New development build');
    expect(host.textContent).toContain('package-level signature or declaration-difference inspection');
    const submit = host.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!;
    expect(submit.textContent).toContain('Install new build');
    expect(submit.className).toContain('whitespace-nowrap');
    expect(submit.disabled).toBe(true);
  });

  it('locks dismissal during commit and retains the completion dialog', async () => {
    let resolveCommit!: () => void;
    const commit = new Promise<void>((resolve) => { resolveCommit = resolve; });
    const { host, props } = mountDialog({ onCommitDevelopment: vi.fn(() => commit) });
    await vi.waitFor(() => expect(host.querySelector('[data-plugin-update-submit]')).not.toBeNull());
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();
    await vi.waitFor(() => expect(props.onCommitDevelopment).toHaveBeenCalledTimes(1));
    expect(host.textContent).toContain('Installing the reviewed update');
    host.querySelector<HTMLButtonElement>('[data-dialog-dismiss]')!.click();
    expect(props.onOpenChange).not.toHaveBeenCalled();
    resolveCommit();
    await vi.waitFor(() => expect(host.querySelector('[data-plugin-update-complete]')).not.toBeNull());
    expect(props.onOpenChange).not.toHaveBeenCalled();
    expect(props.onCommitted).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-plugin-update-open-activity]')).toBeNull();
    expect(host.querySelector('[data-plugin-update-view-permissions]')).toBeNull();
    expect(host.textContent).not.toContain('Install new build');
  });

  it('offers Activity only after refreshed inventory proves the reviewed package identity', async () => {
    const [item, setItem] = createSignal(updateItem());
    const host = document.createElement('div');
    document.body.append(host);
    const props = {
      open: true,
      get item() { return item(); },
      canManage: true,
      onOpenChange: vi.fn(),
      onInspect: vi.fn(),
      onCommitExternal: vi.fn(),
      onCommitDevelopment: vi.fn(async () => undefined),
      onRefresh: vi.fn(async () => {
        const current = updateItem();
        setItem({
          ...current,
          lifecycleState: 'enabled',
          managementRevision: 9,
          installedPackage: {
            packageHash: delivery.package_hash,
            manifestHash: delivery.manifest_hash,
            entriesHash: delivery.entries_hash,
          },
          defaultLaunchTarget: { ...current.defaultLaunchTarget!, expectedManagementRevision: 9 },
        });
      }),
      onCommitted: vi.fn(),
      onOpenActivity: vi.fn(),
      onViewPermissions: vi.fn(),
    };
    dispose = render(() => <PluginUpdateReviewDialog {...props} />, host);

    await vi.waitFor(() => expect(host.querySelector('[data-plugin-update-submit]')).not.toBeNull());
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();

    await vi.waitFor(() => expect(host.querySelector('[data-plugin-update-complete]')).not.toBeNull());
    expect(host.querySelector('[data-plugin-update-open-activity]')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('[data-plugin-update-open-activity]')!.click();
    expect(props.onOpenActivity).toHaveBeenCalledTimes(1);
    expect(props.onCommitted).toHaveBeenCalledTimes(1);
  });

  it('reconciles an unknown outcome without submitting the update again', async () => {
    const [item, setItem] = createSignal(updateItem());
    const host = document.createElement('div');
    document.body.append(host);
    const onCommitDevelopment = vi.fn(async () => {
      throw new PluginTransportError('response was lost', new TypeError('offline'), 'unknown');
    });
    const onRefresh = vi.fn(async () => {
      const current = updateItem();
      setItem({
        ...current,
        lifecycleState: 'disabled',
        managementRevision: 9,
        installedPackage: {
          packageHash: delivery.package_hash,
          manifestHash: delivery.manifest_hash,
          entriesHash: delivery.entries_hash,
        },
        defaultLaunchTarget: undefined,
      });
    });
    const props = {
      open: true,
      get item() { return item(); },
      canManage: true,
      onOpenChange: vi.fn(),
      onInspect: vi.fn(),
      onCommitExternal: vi.fn(),
      onCommitDevelopment,
      onRefresh,
      onCommitted: vi.fn(),
      onOpenActivity: vi.fn(),
      onViewPermissions: vi.fn(),
    };
    dispose = render(() => <PluginUpdateReviewDialog {...props} />, host);

    await vi.waitFor(() => expect(host.querySelector('[data-plugin-update-submit]')).not.toBeNull());
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();
    await vi.waitFor(() => expect(host.querySelector('[data-plugin-update-reconcile]')).not.toBeNull());
    expect(onCommitDevelopment).toHaveBeenCalledTimes(1);

    host.querySelector<HTMLButtonElement>('[data-plugin-update-reconcile]')!.click();
    await vi.waitFor(() => expect(host.querySelector('[data-plugin-update-complete]')).not.toBeNull());
    expect(onCommitDevelopment).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(props.onCommitted).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-plugin-update-view-permissions]')).not.toBeNull();
  });

  it('separates a refresh failure from a confirmed update result', async () => {
    const { host, props } = mountDialog({
      onRefresh: vi.fn(async () => { throw new Error('inventory unavailable'); }),
    });
    await vi.waitFor(() => expect(host.querySelector('[data-plugin-update-submit]')).not.toBeNull());
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.click();

    await vi.waitFor(() => expect(host.querySelector('[data-plugin-update-complete]')).not.toBeNull());
    expect(host.textContent).toContain('could not refresh the latest inventory');
    expect(host.querySelector('[data-plugin-update-open-activity]')).toBeNull();
    expect(host.querySelector('[data-plugin-update-view-permissions]')).toBeNull();
    expect(props.onCommitted).toHaveBeenCalledTimes(1);
  });

  it('allows read-only review but disables submission', async () => {
    const { host } = mountDialog({ canManage: false });
    await vi.waitFor(() => expect(host.querySelector('[data-plugin-update-submit]')).not.toBeNull());
    host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
    expect(host.querySelector<HTMLButtonElement>('[data-plugin-update-submit]')!.disabled).toBe(true);
    expect(host.textContent).toContain('environment administrator');
  });
});
