// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PluginCenterView } from './PluginCenterView';
import { OFFICIAL_CONTAINERS_RELEASE_REF } from './officialContainersRelease.generated';
import { OFFICIAL_CONTAINERS_PACKAGE_URL } from './officialPluginCatalog';
import type { PluginInventoryProjection } from './pluginTypes';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

const containersPlugin = {
  inventoryKey: 'catalog:containers',
  pluginID: 'com.redeven.official.containers',
  displayName: 'Containers',
  description: 'Manage Docker and Podman resources.',
  iconFallback: 'containers',
  publisher: 'Redeven',
  lifecycleState: 'not_installed',
  trustBadge: 'official',
  pinned: false,
  officialCatalog: {
    pluginID: 'com.redeven.official.containers',
    publisherID: 'com.redeven.official',
    pluginInstanceID: 'plugini_redeven_official_containers',
    displayName: 'Containers',
    description: 'Manage Docker and Podman resources.',
    publisher: 'Redeven',
    latestVersion: '2.0.0',
    stableVersion: '2.0.0',
    minRedevenVersion: '0.9.0',
    minReDevPluginVersion: '0.6.5',
    rolloutState: 'stable',
    defaultSurfaceID: 'containers.dashboard',
    iconFallback: 'containers',
    trustedSigningKeyIDs: ['redeven-official-signing-2026'],
    distribution: {
      releaseRef: OFFICIAL_CONTAINERS_RELEASE_REF,
      installSource: {
        sourceKind: 'package_url',
        url: OFFICIAL_CONTAINERS_PACKAGE_URL,
      },
    },
  },
} satisfies PluginInventoryProjection['items'][number];

const databasePlugin = {
  ...containersPlugin,
  inventoryKey: 'catalog:database',
  pluginID: 'com.redeven.official.database',
  displayName: 'Database Tools',
  description: 'Inspect local database connections.',
  iconFallback: 'database',
  officialCatalog: undefined,
} satisfies PluginInventoryProjection['items'][number];

const projection: PluginInventoryProjection = {
  items: [containersPlugin, databasePlugin],
};

function containersPermissionProjection(granted = false): PluginInventoryProjection {
  return {
    items: [{
      ...containersPlugin,
      pluginInstanceID: 'plugininst_containers',
      version: '2.0.0',
      managementRevision: 7,
      canDisable: true,
      lifecycleState: granted ? 'enabled' : 'needs_attention',
      attentionReason: granted ? undefined : 'permission_required',
      authorization: {
        grants: [],
        permissions: [{
          permissionID: 'containers.read',
          group: 'read',
          requiredToOpen: true,
          methods: ['containers.status'],
          requiredToOpenMethods: ['containers.status'],
          granted,
          deniedByGrant: false,
          blockedByPolicy: false,
          grantBlockedByPolicy: false,
          blockedToOpen: false,
        }],
        revisions: {
          policyRevision: 3,
          managementRevision: 7,
          revokeEpoch: 2,
        },
      },
    }],
  };
}

function findDocumentButton(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  return button;
}

describe('PluginCenterView', () => {
  it('exposes the active Plugin Center view with tab semantics', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [containersPlugin] }}
        loading={false}
        canManagePlugins
        canOpenPluginSurfaces
        onRefresh={() => undefined}
        onCommand={() => undefined}
      />
    ), mount);

    const discover = mount.querySelector('[role="tab"][aria-selected="true"]');
    const panel = mount.querySelector('[role="tabpanel"]');
    expect(discover?.id).toBe('plugin-center-tab-discover');
    expect(panel?.getAttribute('aria-labelledby')).toBe(discover?.id);
    expect(discover?.getAttribute('aria-controls')).toBe(panel?.id);

    (discover as HTMLButtonElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(mount.querySelector('[role="tab"][aria-selected="true"]')?.id).toBe('plugin-center-tab-installed');
  });

  it('renders a dedicated management shell outside Settings with local search', () => {
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-center-view]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-shell]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-list]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-details]')).not.toBeNull();
    expect(mount.querySelector('[data-settings-nav-item="plugins"]')).toBeNull();
    expect(mount.textContent).toContain('Installed');
    expect(mount.textContent).toContain('Discover');
    expect(mount.textContent).toContain('Updates');
    expect(mount.textContent).toContain('Containers');
    expect(mount.textContent).not.toMatch(/Developer|Install from URL|Install from file|unsigned|marketplace/i);

    const search = mount.querySelector('[data-plugin-center-search]') as HTMLInputElement;
    search.value = 'database';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));

    expect(mount.querySelector('[data-plugin-center-item="catalog:database"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-center-item="catalog:containers"]')).toBeNull();
  });

  it('keeps header controls within narrow viewports by wrapping search onto its own row', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const search = mount.querySelector('[data-plugin-center-search]') as HTMLInputElement;
    const searchField = search.parentElement as HTMLElement;
    const actions = searchField.parentElement as HTMLElement;
    expect(actions.classList).toContain('w-full');
    expect(actions.classList).toContain('min-w-0');
    expect(actions.classList).toContain('flex-wrap');
    expect(searchField.classList).toContain('order-first');
    expect(searchField.classList).toContain('w-full');
    expect(searchField.classList).toContain('min-w-0');
  });

  it('selects a plugin details inspector from an explicit shell request', () => {
    const installedProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '2.0.0',
          managementRevision: 7,
          lifecycleState: 'disabled',
          attentionReason: 'disabled',
        },
      ],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        error={null}
        selectedInventoryKey="catalog:containers"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Containers');
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Disabled');
  });

  it('reopens mobile details for every explicit shell focus request while kept alive', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    const [focusRequest, setFocusRequest] = createSignal(1);
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={containersPermissionProjection()}
        loading={false}
        selectedInventoryKey="catalog:containers"
        focusRequest={focusRequest()}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    await Promise.resolve();
    const back = mount.querySelector<HTMLButtonElement>('[data-plugin-center-mobile-back]')!;
    expect(document.activeElement).toBe(back);
    back.click();
    await Promise.resolve();
    expect(getComputedStyle(mount.querySelector<HTMLElement>('[data-plugin-center-master]')!).display).not.toBe('none');

    setFocusRequest(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(getComputedStyle(mount.querySelector<HTMLElement>('[data-plugin-center-details]')!).display).not.toBe('none');
    expect(document.activeElement).toBe(back);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  });

  it('returns mobile details to the list for search and tab changes without losing the initiating focus', async () => {
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 320 });
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={containersPermissionProjection(true)}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const item = mount.querySelector<HTMLButtonElement>('[data-plugin-center-item="catalog:containers"]')!;
    item.click();
    await Promise.resolve();
    await Promise.resolve();
    const master = mount.querySelector<HTMLElement>('[data-plugin-center-master]')!;
    const details = mount.querySelector<HTMLElement>('[data-plugin-center-details]')!;
    expect(master.classList).toContain('hidden');
    expect(details.classList).toContain('block');

    const search = mount.querySelector<HTMLInputElement>('[data-plugin-center-search]')!;
    search.focus();
    search.value = 'containers';
    search.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    expect(master.classList).toContain('flex');
    expect(details.classList).toContain('hidden');
    expect(document.activeElement).toBe(search);

    item.click();
    await Promise.resolve();
    await Promise.resolve();
    const discover = mount.querySelector<HTMLButtonElement>('#plugin-center-tab-discover')!;
    discover.focus();
    discover.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(master.classList).toContain('flex');
    expect(details.classList).toContain('hidden');
    expect(document.activeElement).toBe(discover);
    expect(discover.getAttribute('aria-selected')).toBe('true');

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
  });

  it.each([
    {
      action: 'trust',
      label: 'View trust details',
      attentionReason: 'trust_unavailable',
      trustBadge: 'unavailable',
      recovery: 'Review the trust and approval reason codes and source below.',
      evidence: ['attention_reason=trust_unavailable', 'trust=unavailable', 'rollout_state=stable'],
    },
    {
      action: 'runtime',
      label: 'View runtime requirement',
      attentionReason: 'runtime_missing',
      trustBadge: 'official',
      recovery: 'Update Redeven or ReDevPlugin to the required version',
      evidence: ['attention_reason=runtime_missing', 'trust=official', 'rollout_state=stable'],
    },
    {
      action: 'diagnostics',
      label: 'View issue',
      attentionReason: 'diagnostic_error',
      trustBadge: 'official',
      recovery: 'Resolve the reported host or package issue shown below',
      evidence: ['attention_reason=diagnostic_error', 'trust=official', 'rollout_state=stable'],
    },
  ] as const)(
    'focuses the real $action evidence and recovery from its primary action',
    ({ action, label, attentionReason, trustBadge, recovery, evidence }) => {
      const mount = document.createElement('div');
      document.body.append(mount);
      const issueProjection: PluginInventoryProjection = {
        items: [{
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '2.0.0',
          managementRevision: 7,
          lifecycleState: 'needs_attention',
          attentionReason,
          trustBadge,
        }],
      };
      dispose = render(() => (
        <PluginCenterView
          projection={issueProjection}
          loading={false}
          selectedInventoryKey="catalog:containers"
          onCommand={vi.fn()}
          onRefresh={vi.fn()}
          canManagePlugins
          canOpenPluginSurfaces
        />
      ), mount);

      const issue = mount.querySelector<HTMLElement>('[data-plugin-issue-details]')!;
      const scrollIntoView = vi.fn();
      Object.defineProperty(issue, 'scrollIntoView', { configurable: true, value: scrollIntoView });
      const primary = mount.querySelector<HTMLButtonElement>(`[data-plugin-action="${action}"]`)!;
      expect(primary.textContent).toContain(label);
      primary.click();

      expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
      expect(document.activeElement).toBe(issue);
      expect(issue.textContent).toContain(recovery);
      const issueEvidence = issue.querySelector('[data-plugin-issue-evidence]')?.textContent ?? '';
      for (const fact of evidence) expect(issueEvidence).toContain(fact);
      expect(issue.textContent).toContain('0.9.0');
      expect(issue.textContent).toContain('0.6.5');
    },
  );

  it('describes and focuses technical details for an enabled plugin without a launch surface', () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const backgroundProjection: PluginInventoryProjection = {
      items: [{
        ...containersPlugin,
        pluginInstanceID: 'plugininst_background',
        managementRevision: 9,
        lifecycleState: 'enabled',
        defaultLaunchTarget: undefined,
      }],
    };
    dispose = render(() => (
      <PluginCenterView
        projection={backgroundProjection}
        loading={false}
        selectedInventoryKey="catalog:containers"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const details = mount.querySelector<HTMLDetailsElement>('[data-plugin-technical-details]')!;
    const summary = details.querySelector<HTMLElement>('summary')!;
    const scrollIntoView = vi.fn();
    Object.defineProperty(details, 'scrollIntoView', { configurable: true, value: scrollIntoView });
    const primary = mount.querySelector<HTMLButtonElement>('[data-plugin-action="details"]')!;
    expect(primary.textContent).toContain('Technical details');
    expect(primary.textContent).not.toContain('View issue');

    primary.click();

    expect(details.open).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
    expect(document.activeElement).toBe(summary);
  });

  it('opens official catalog installation through the reviewed package URL flow', async () => {
    const onCommand = vi.fn();
    const onInspectExternal = vi.fn(async () => {
      throw new Error('stop after request capture');
    });
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        error={null}
        onCommand={onCommand}
        onInspectExternal={onInspectExternal}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const install = mount.querySelector('[data-plugin-action="install"]') as HTMLButtonElement;
    expect(install.disabled).toBe(false);
    expect(install.textContent).toContain('Install');
    expect(containersPlugin.officialCatalog.distribution.releaseRef).toBe(OFFICIAL_CONTAINERS_RELEASE_REF);
    install.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCommand).not.toHaveBeenCalled();
    expect(document.querySelector('[data-external-plugin-dialog]')).not.toBeNull();
    expect((document.querySelector('[data-external-plugin-dialog] input[type="url"]') as HTMLInputElement).value)
      .toBe(OFFICIAL_CONTAINERS_PACKAGE_URL);
    findDocumentButton('Review package').click();
    await Promise.resolve();
    expect(onInspectExternal).toHaveBeenCalledWith({
      sourceKind: 'package_url',
      url: OFFICIAL_CONTAINERS_PACKAGE_URL,
      intent: { action: 'install' },
    }, expect.any(AbortSignal));
  });

  it('lets read-only users open surfaces while keeping management actions disabled', async () => {
    const onCommand = vi.fn();
    const installedProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '2.0.0',
          managementRevision: 7,
          canDisable: true,
          lifecycleState: 'enabled',
          defaultLaunchTarget: {
            pluginID: 'com.redeven.official.containers',
            pluginInstanceID: 'plugininst_containers',
            surfaceID: 'containers.dashboard',
            expectedManagementRevision: 7,
            preferredPlacement: 'activity',
          },
        },
      ],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        error={null}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins={false}
        canOpenPluginSurfaces
      />
    ), mount);

    const openActivity = mount.querySelector('[data-plugin-action="open"]') as HTMLButtonElement;
    const openWorkbench = mount.querySelector('[data-plugin-action="open-workbench"]') as HTMLButtonElement;
    expect(openActivity.disabled).toBe(false);
    expect(openWorkbench.disabled).toBe(false);
    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(findDocumentButton('Disable').disabled).toBe(true);
    expect(findDocumentButton('Uninstall').disabled).toBe(true);
    openActivity.click();
    await Promise.resolve();
    await Promise.resolve();
    openWorkbench.click();
    expect(onCommand).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'open_surface', placement: 'activity' }), expect.any(AbortSignal));
    expect(onCommand).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'open_surface', placement: 'workbench' }), expect.any(AbortSignal));
  });

  it('keeps Disable available for an enabled plugin that needs permission attention', async () => {
    const mount = document.createElement('div');
    document.body.append(mount);
    const installedProjection: PluginInventoryProjection = {
      items: [{
        ...containersPlugin,
        pluginInstanceID: 'plugininst_containers',
        managementRevision: 7,
        canDisable: true,
        lifecycleState: 'needs_attention',
        attentionReason: 'permission_required',
      }],
    };

    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(findDocumentButton('Disable').disabled).toBe(false);
  });

  it('keeps permission switches model-driven across cancellation and confirmed grant', async () => {
    const onCommand = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={containersPermissionProjection()}
        loading={false}
        error={null}
        selectedInventoryKey="catalog:containers"
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const permissionSwitch = mount.querySelector('[data-plugin-permission="containers.read"] [role="switch"]') as HTMLButtonElement;
    expect(permissionSwitch.getAttribute('aria-checked')).toBe('false');

    permissionSwitch.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(permissionSwitch.getAttribute('aria-checked')).toBe('false');
    expect(findDocumentButton('Cancel').className).toContain('min-h-[46px]');
    expect(findDocumentButton('Grant').className).toContain('min-h-[46px]');
    findDocumentButton('Cancel').click();
    await Promise.resolve();
    expect(permissionSwitch.getAttribute('aria-checked')).toBe('false');
    expect(onCommand).not.toHaveBeenCalled();

    permissionSwitch.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    findDocumentButton('Grant').click();
    await Promise.resolve();

    expect(onCommand).toHaveBeenCalledWith({
      type: 'grant_permission',
      pluginInstanceID: 'plugininst_containers',
      permissionID: 'containers.read',
      expectedPolicyRevision: 3,
      expectedManagementRevision: 7,
      expectedRevokeEpoch: 2,
    }, expect.any(AbortSignal));
    expect(permissionSwitch.getAttribute('aria-checked')).toBe('false');
  });

  it('names the actual plugin in permission disclosure and confirmation', async () => {
    const externalProjection = containersPermissionProjection();
    externalProjection.items[0] = {
      ...externalProjection.items[0],
      inventoryKey: 'instance:plugininst_toolbox',
      pluginID: 'com.example.toolbox',
      pluginInstanceID: 'plugininst_toolbox',
      displayName: 'Example Toolbox',
      trustBadge: 'unsigned',
      officialCatalog: undefined,
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={externalProjection}
        loading={false}
        selectedInventoryKey="instance:plugininst_toolbox"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    expect(mount.textContent).toContain('Example Toolbox permissions');
    (mount.querySelector('[data-plugin-permission="containers.read"] [role="switch"]') as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toContain('Grant View containers to Example Toolbox?');
    expect(document.body.textContent).not.toContain('Grant View containers to Containers?');
  });

  it('distinguishes generic permission IDs in switches and confirmation', async () => {
    const externalProjection = containersPermissionProjection();
    const base = externalProjection.items[0];
    externalProjection.items[0] = {
      ...base,
      inventoryKey: 'instance:plugininst_toolbox',
      pluginID: 'com.example.toolbox',
      pluginInstanceID: 'plugininst_toolbox',
      displayName: 'Example Toolbox',
      trustBadge: 'unsigned',
      officialCatalog: undefined,
      authorization: {
        ...base.authorization!,
        permissions: [
          { ...base.authorization!.permissions[0], permissionID: 'workspace.read', group: 'other', methods: ['workspace.list'] },
          { ...base.authorization!.permissions[0], permissionID: 'workspace.write', group: 'other', methods: ['workspace.write'] },
        ],
      },
    };
    const onCommand = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={externalProjection}
        loading={false}
        selectedInventoryKey="instance:plugininst_toolbox"
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const readSwitch = mount.querySelector('[data-plugin-permission="workspace.read"] [role="switch"]') as HTMLButtonElement;
    const writeSwitch = mount.querySelector('[data-plugin-permission="workspace.write"] [role="switch"]') as HTMLButtonElement;
    expect(readSwitch.getAttribute('aria-label')).toBe('Change workspace.read permission');
    expect(writeSwitch.getAttribute('aria-label')).toBe('Change workspace.write permission');
    writeSwitch.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).toContain('Grant workspace.write to Example Toolbox?');
    findDocumentButton('Grant').click();
    await Promise.resolve();
    expect(onCommand).toHaveBeenCalledWith(expect.objectContaining({
      type: 'grant_permission',
      pluginInstanceID: 'plugininst_toolbox',
      permissionID: 'workspace.write',
    }), expect.any(AbortSignal));
  });

  it('keeps the projected permission state unchanged when a confirmed mutation fails', async () => {
    const onCommand = vi.fn(async () => {
      throw new Error('permission update failed');
    });
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={containersPermissionProjection()}
        loading={false}
        error={null}
        selectedInventoryKey="catalog:containers"
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const permissionSwitch = mount.querySelector('[data-plugin-permission="containers.read"] [role="switch"]') as HTMLButtonElement;
    permissionSwitch.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    findDocumentButton('Grant').click();
    await Promise.resolve();
    await Promise.resolve();

    expect(permissionSwitch.getAttribute('aria-checked')).toBe('false');
    expect(mount.textContent).toContain('permission update failed');
  });

  it('allows enabled official plugin surfaces to open through the sandbox host', () => {
    const onCommand = vi.fn();
    const installedProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '2.0.0',
          managementRevision: 11,
          lifecycleState: 'enabled',
          defaultLaunchTarget: {
            pluginID: 'com.redeven.official.containers',
            pluginInstanceID: 'plugininst_containers',
            surfaceID: 'containers.dashboard',
            expectedManagementRevision: 11,
            preferredPlacement: 'activity',
          },
        },
      ],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        error={null}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const open = mount.querySelector('[data-plugin-action="open"]') as HTMLButtonElement;
    expect(open.disabled).toBe(false);
    open.click();
    expect(onCommand).toHaveBeenCalledWith({
      type: 'open_surface',
      pluginID: 'com.redeven.official.containers',
      pluginInstanceID: 'plugininst_containers',
      surfaceID: 'containers.dashboard',
      expectedManagementRevision: 11,
      placement: 'activity',
    }, expect.any(AbortSignal));
  });

  it('updates official catalog packages through the reviewed package URL flow', async () => {
    const onCommand = vi.fn();
    const updatesProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '1.9.0',
          managementRevision: 13,
          lifecycleState: 'update_available',
        },
      ],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={updatesProjection}
        loading={false}
        error={null}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    const update = mount.querySelector('[data-plugin-action="update-external"]') as HTMLButtonElement;
    expect(update.disabled).toBe(false);
    update.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCommand).not.toHaveBeenCalled();
    expect((document.querySelector('[data-external-plugin-dialog] input[type="url"]') as HTMLInputElement).value)
      .toBe(OFFICIAL_CONTAINERS_PACKAGE_URL);
  });

  it('does not offer enable for plugins that need trust attention or updates', () => {
    const needsAttentionProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '2.0.0',
          managementRevision: 17,
          lifecycleState: 'needs_attention',
          trustBadge: 'unavailable',
          attentionReason: 'trust_unavailable',
        },
      ],
    };
    const updatesProjection: PluginInventoryProjection = {
      items: [
        {
          ...containersPlugin,
          pluginInstanceID: 'plugininst_containers',
          version: '1.9.0',
          managementRevision: 19,
          lifecycleState: 'update_available',
        },
      ],
    };
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={needsAttentionProjection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.textContent).toContain('Needs attention');
    expect(mount.querySelector('[data-plugin-action="enable"]')).toBeNull();
    expect(mount.querySelector('[data-plugin-action="open"]')).toBeNull();

    dispose();
    mount.innerHTML = '';
    dispose = render(() => (
      <PluginCenterView
        projection={updatesProjection}
        loading={false}
        error={null}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-action="update-external"]')).not.toBeNull();
    expect(mount.querySelector('[data-plugin-action="enable"]')).toBeNull();
  });

  it('uses explicit inventory and refresh props without owning an implicit API client', () => {
    const onRefresh = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);

    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        error={null}
        canManagePlugins
        canOpenPluginSurfaces={false}
        onRefresh={onRefresh}
        onCommand={vi.fn()}
      />
    ), mount);

    (mount.querySelector('[data-plugin-center-refresh]') as HTMLButtonElement).click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('uses the combined authorization state instead of a stale enabled lifecycle', () => {
    const staleProjection = containersPermissionProjection(false);
    staleProjection.items[0] = {
      ...staleProjection.items[0],
      lifecycleState: 'enabled',
      defaultLaunchTarget: {
        pluginID: 'com.redeven.official.containers',
        pluginInstanceID: 'plugininst_containers',
        surfaceID: 'containers.dashboard',
        expectedManagementRevision: 7,
        preferredPlacement: 'activity',
      },
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={staleProjection}
        loading={false}
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-primary-actions]')?.textContent).toContain('Review required permissions');
    expect(mount.querySelector('[data-plugin-action="open"]')).toBeNull();
    expect(mount.querySelector('[data-plugin-action="open-workbench"]')).toBeNull();
  });

  it('requires a second destructive confirmation before uninstall deletes plugin data', async () => {
    const onCommand = vi.fn();
    const installedProjection: PluginInventoryProjection = {
      items: [{
        ...containersPlugin,
        pluginInstanceID: 'plugininst_containers',
        version: '2.0.0',
        managementRevision: 23,
        lifecycleState: 'disabled',
      }],
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    await Promise.resolve();
    findDocumentButton('Uninstall').click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(choices).toHaveLength(2);
    expect(choices[0]?.getAttribute('aria-checked')).toBe('true');
    expect(choices[1]?.getAttribute('aria-checked')).toBe('false');
    expect((document.querySelector('[data-plugin-uninstall-confirm]') as HTMLButtonElement).className).toContain('min-h-[46px]');
    choices[1]?.click();
    (document.querySelector('[data-plugin-uninstall-confirm]') as HTMLButtonElement).click();

    expect(onCommand).not.toHaveBeenCalled();
    expect(document.querySelector('[data-plugin-uninstall-delete-warning]')?.textContent).toContain('Permanently delete');
    expect((document.querySelector('[data-plugin-uninstall-confirm]') as HTMLButtonElement).textContent).toContain('Delete data');
    (document.querySelector('[data-plugin-uninstall-confirm]') as HTMLButtonElement).click();

    expect(onCommand).toHaveBeenCalledWith({
      type: 'uninstall',
      pluginInstanceID: 'plugininst_containers',
      expectedManagementRevision: 23,
      dataRetention: 'delete_data',
    }, expect.any(AbortSignal));
  });

  it('restores keep data as the safe default after cancelling an uninstall', async () => {
    const onCommand = vi.fn();
    const installedProjection: PluginInventoryProjection = {
      items: [{
        ...containersPlugin,
        pluginInstanceID: 'plugininst_containers',
        version: '2.0.0',
        managementRevision: 23,
        lifecycleState: 'disabled',
      }],
    };
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        onCommand={onCommand}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces
      />
    ), mount);

    const openUninstall = async () => {
      (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
      await Promise.resolve();
      findDocumentButton('Uninstall').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    await openUninstall();
    const choices = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    choices[1]?.click();
    findDocumentButton('Cancel').click();
    await Promise.resolve();

    await openUninstall();
    const reopenedChoices = [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    expect(reopenedChoices[0]?.getAttribute('aria-checked')).toBe('true');
    expect(reopenedChoices[1]?.getAttribute('aria-checked')).toBe('false');
    (document.querySelector('[data-plugin-uninstall-confirm]') as HTMLButtonElement).click();
    expect(onCommand).toHaveBeenCalledWith({
      type: 'uninstall',
      pluginInstanceID: 'plugininst_containers',
      expectedManagementRevision: 23,
      dataRetention: 'keep_data',
    }, expect.any(AbortSignal));
  });

  it('binds Plugin Center errors to a retry action and administrator guidance', () => {
    const onRefresh = vi.fn();
    const mount = document.createElement('div');
    document.body.append(mount);
    dispose = render(() => (
      <PluginCenterView
        projection={projection}
        loading={false}
        error={new Error('Inventory unavailable')}
        onCommand={vi.fn()}
        onRefresh={onRefresh}
        canManagePlugins={false}
        canOpenPluginSurfaces
      />
    ), mount);

    const error = mount.querySelector('[data-plugin-center-error]')!;
    expect(error.textContent).toContain('Inventory unavailable');
    expect(error.textContent).toContain('environment administrator');
    findDocumentButton('Retry').click();
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('admits one management mutation at a time and supplies an abort signal', async () => {
    let finish!: () => void;
    const onCommand = vi.fn((_command, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false);
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const mount = document.createElement('div');
    document.body.append(mount);

    const installedProjection: PluginInventoryProjection = {
      items: [{
        ...containersPlugin,
        pluginInstanceID: 'plugininst_containers',
        version: '2.0.0',
        managementRevision: 7,
        canDisable: true,
        lifecycleState: 'enabled',
      }],
    };
    dispose = render(() => (
      <PluginCenterView
        projection={installedProjection}
        loading={false}
        error={null}
        canManagePlugins
        canOpenPluginSurfaces={false}
        onRefresh={vi.fn()}
        onCommand={onCommand}
      />
    ), mount);

    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    await Promise.resolve();
    const disable = findDocumentButton('Disable');
    disable.click();
    disable.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onCommand).toHaveBeenCalledTimes(1);
    (mount.querySelector('[data-plugin-action="more"]') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(findDocumentButton('Disable').disabled).toBe(true);

    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(findDocumentButton('Disable').disabled).toBe(false);
  });

  it('selects same-plugin-id instances independently by inventory key', () => {
    const first = {
      ...containersPlugin,
      inventoryKey: 'instance:plugini_toolbox_alpha',
      pluginID: 'com.example.toolbox',
      pluginInstanceID: 'plugini_toolbox_alpha',
      displayName: 'Toolbox Alpha',
      description: 'First independently installed instance.',
      publisher: 'Example Publisher',
      version: '1.0.0',
      managementRevision: 3,
      lifecycleState: 'disabled',
      trustBadge: 'unsigned',
      officialCatalog: undefined,
    } satisfies PluginInventoryProjection['items'][number];
    const second = {
      ...first,
      inventoryKey: 'instance:plugini_toolbox_beta',
      pluginInstanceID: 'plugini_toolbox_beta',
      displayName: 'Toolbox Beta',
      description: 'Second independently installed instance.',
      managementRevision: 8,
    } satisfies PluginInventoryProjection['items'][number];
    const mount = document.createElement('div');
    document.body.append(mount);

    const matchingCatalog = {
      ...containersPlugin,
      inventoryKey: 'catalog:toolbox',
      pluginID: 'com.example.toolbox',
      displayName: 'Toolbox Catalog',
      officialCatalog: undefined,
    } satisfies PluginInventoryProjection['items'][number];

    dispose = render(() => (
      <PluginCenterView
        projection={{ items: [matchingCatalog, first, second] }}
        loading={false}
        error={null}
        selectedInventoryKey="instance:plugini_toolbox_beta"
        onCommand={vi.fn()}
        onRefresh={vi.fn()}
        canManagePlugins
        canOpenPluginSurfaces={false}
      />
    ), mount);

    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Toolbox Beta');
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).not.toContain('Toolbox Catalog');
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).not.toContain('Toolbox Alpha');
    const beta = mount.querySelector('[data-plugin-center-item="instance:plugini_toolbox_beta"]') as HTMLButtonElement;
    const alpha = mount.querySelector('[data-plugin-center-item="instance:plugini_toolbox_alpha"]') as HTMLButtonElement;
    expect(beta.getAttribute('aria-current')).toBe('true');
    expect(alpha.getAttribute('aria-current')).toBeNull();
    alpha.click();
    expect(mount.querySelector('[data-plugin-center-details]')?.textContent).toContain('Toolbox Alpha');
    expect(beta.getAttribute('aria-current')).toBeNull();
    expect(alpha.getAttribute('aria-current')).toBe('true');
  });
});
