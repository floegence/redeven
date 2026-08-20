import { describe, expect, it, vi } from 'vitest';

import { completeApprovedOfficialInstall } from './pluginApprovedInstallSetup';
import type { PluginInventoryItem, PluginInventoryProjection } from './pluginTypes';

const pluginInstanceID = 'plugini_redeven_official_containers';

function item(granted: readonly string[], lifecycleState: PluginInventoryItem['lifecycleState'] = 'needs_attention'): PluginInventoryItem {
  return {
    inventoryKey: `instance:${pluginInstanceID}`,
    pluginID: 'com.redeven.official.containers',
    pluginInstanceID,
    displayName: 'Containers',
    description: 'Containers',
    iconFallback: 'generic',
    category: 'other',
    searchKeywords: [],
    publisher: 'Redeven Official',
    version: '4.4.7',
    managementRevision: 7,
    canDisable: true,
    lifecycleState,
    trustBadge: 'official',
    pinned: false,
    authorization: {
      grants: [],
      permissions: ['containers.read', 'containers.execute'].map((permissionID) => ({
        permissionID,
        group: permissionID.endsWith('read') ? 'read' as const : 'execute' as const,
        requiredToOpen: true,
        methods: [],
        granted: granted.includes(permissionID),
        deniedByGrant: false,
        blockedByPolicy: false,
        grantBlockedByPolicy: false,
        blockedToOpen: false,
      })),
      revisions: {
        policyRevision: granted.length + 1,
        managementRevision: 7,
        revokeEpoch: 3,
      },
    },
  };
}

function projection(value: PluginInventoryItem): PluginInventoryProjection {
  return { items: [value] };
}

describe('approved official install setup', () => {
  it('grants every reviewed required permission and leaves an enabled plugin directly openable', async () => {
    const lifecycle = { execute: vi.fn(async () => ({})) };
    const inventories = [
      projection(item([])),
      projection(item(['containers.read'])),
      projection(item(['containers.read', 'containers.execute'], 'enabled')),
    ];
    const refreshInventory = vi.fn(async () => inventories.shift());

    await completeApprovedOfficialInstall({ pluginInstanceID, lifecycle: lifecycle as never, refreshInventory });

    expect(lifecycle.execute).toHaveBeenNthCalledWith(1, {
      type: 'grant_permission',
      pluginInstanceID,
      permissionID: 'containers.read',
      expectedPolicyRevision: 1,
      expectedManagementRevision: 7,
      expectedRevokeEpoch: 3,
    }, { signal: undefined });
    expect(lifecycle.execute).toHaveBeenNthCalledWith(2, {
      type: 'grant_permission',
      pluginInstanceID,
      permissionID: 'containers.execute',
      expectedPolicyRevision: 2,
      expectedManagementRevision: 7,
      expectedRevokeEpoch: 3,
    }, { signal: undefined });
    expect(lifecycle.execute).toHaveBeenCalledTimes(2);
  });

  it('uses the released enable API only when the committed inventory is actually disabled', async () => {
    const lifecycle = { execute: vi.fn(async () => ({})) };
    const inventories = [
      projection(item(['containers.read', 'containers.execute'], 'disabled')),
      projection(item(['containers.read', 'containers.execute'], 'enabled')),
    ];

    await completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: lifecycle as never,
      refreshInventory: vi.fn(async () => inventories.shift()),
    });

    expect(lifecycle.execute).toHaveBeenCalledWith({
      type: 'enable',
      pluginInstanceID,
      expectedManagementRevision: 7,
    }, { signal: undefined });
  });

  it('fails without issuing a grant when local policy blocks required access', async () => {
    const lifecycle = { execute: vi.fn(async () => ({})) };
    const blocked = item([]);
    blocked.authorization!.permissions[0].grantBlockedByPolicy = true;

    await expect(completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: lifecycle as never,
      refreshInventory: vi.fn(async () => projection(blocked)),
    })).rejects.toThrow('blocked by policy');
    expect(lifecycle.execute).not.toHaveBeenCalled();
  });
});
