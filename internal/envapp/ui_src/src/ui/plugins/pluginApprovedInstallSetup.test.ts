import { PluginPlatformRequestError } from '@floegence/redevplugin-ui';
import { describe, expect, it, vi } from 'vitest';

import {
  ApprovedInstallInventoryRefreshError,
  completeApprovedOfficialInstall,
} from './pluginApprovedInstallSetup';
import type { PluginInventoryItem, PluginInventoryProjection } from './pluginTypes';

const pluginInstanceID = 'plugini_redeven_official_metrics';
const permissionIDs = [
  'metrics.read',
  'metrics.execute',
  'metrics.logs',
  'metrics.admin',
] as const;

function item(
  granted: readonly string[],
  lifecycleState: PluginInventoryItem['lifecycleState'] = 'needs_attention',
  revisions = { policyRevision: 1, managementRevision: 7, revokeEpoch: 3 },
): PluginInventoryItem {
  const readyToOpen = lifecycleState === 'enabled' || lifecycleState === 'update_available';
  return {
    inventoryKey: `instance:${pluginInstanceID}`,
    pluginID: 'com.example.metrics',
    pluginInstanceID,
    displayName: 'Metrics',
    description: 'Metrics',
    iconFallback: 'generic',
    category: 'other',
    searchKeywords: [],
    publisher: 'Redeven Official',
    version: '4.4.9',
    managementRevision: revisions.managementRevision,
    canDisable: true,
    lifecycleState,
    trustBadge: 'official',
    pinned: false,
    defaultLaunchTarget: readyToOpen ? {
      pluginID: 'com.example.metrics',
      pluginInstanceID,
      surfaceID: 'metrics.dashboard',
      expectedManagementRevision: revisions.managementRevision,
      preferredPlacement: 'activity',
    } : undefined,
    authorization: {
      grants: [],
      permissions: permissionIDs.map((permissionID) => ({
        permissionID,
        group: permissionID === 'metrics.read' ? 'read' as const : 'execute' as const,
        requiredToOpen: true,
        methods: [],
        granted: granted.includes(permissionID),
        deniedByGrant: false,
        blockedByPolicy: false,
        grantBlockedByPolicy: false,
        blockedToOpen: false,
      })),
      revisions,
    },
  };
}

function projection(value: PluginInventoryItem): PluginInventoryProjection {
  return { items: [value] };
}

function mutationResult(index: number) {
  return {
    permission: {},
    revisions: {
      policy_revision: index + 2,
      management_revision: index + 8,
      revoke_epoch: index + 4,
    },
  };
}

describe('approved official install setup', () => {
  it('grants four reviewed permissions with chained response revisions and one final refresh', async () => {
    const grantPermission = vi.fn(async (_command: unknown) => mutationResult(grantPermission.mock.calls.length - 1));
    const lifecycle = { grantPermission };
    const refreshInventory = vi.fn(async () => projection(item(permissionIDs, 'enabled')));

    await expect(completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: lifecycle as never,
      inventory: projection(item([])),
      refreshInventory,
    })).resolves.toBe('ready');

    expect(grantPermission).toHaveBeenCalledTimes(4);
    expect(refreshInventory).toHaveBeenCalledOnce();
    expect(grantPermission.mock.calls.map(([command]) => command)).toEqual([
      expect.objectContaining({ permissionID: permissionIDs[0], expectedPolicyRevision: 1, expectedManagementRevision: 7, expectedRevokeEpoch: 3 }),
      expect.objectContaining({ permissionID: permissionIDs[1], expectedPolicyRevision: 2, expectedManagementRevision: 8, expectedRevokeEpoch: 4 }),
      expect.objectContaining({ permissionID: permissionIDs[2], expectedPolicyRevision: 3, expectedManagementRevision: 9, expectedRevokeEpoch: 5 }),
      expect.objectContaining({ permissionID: permissionIDs[3], expectedPolicyRevision: 4, expectedManagementRevision: 10, expectedRevokeEpoch: 6 }),
    ]);
  });

  it('uses an already complete initial inventory without another refresh', async () => {
    const lifecycle = { grantPermission: vi.fn() };
    const refreshInventory = vi.fn();

    await expect(completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: lifecycle as never,
      inventory: projection(item(permissionIDs, 'enabled')),
      refreshInventory,
    })).resolves.toBe('ready');

    expect(lifecycle.grantPermission).not.toHaveBeenCalled();
    expect(refreshInventory).not.toHaveBeenCalled();
  });

  it('does not overwrite a later user disable or revoked permission', async () => {
    const lifecycle = { grantPermission: vi.fn() };
    const refreshInventory = vi.fn();
    const disabled = item(permissionIDs, 'disabled');
    const revoked = item(permissionIDs.slice(1));
    revoked.authorization!.grants = [{
      plugin_instance_id: pluginInstanceID,
      permission_id: permissionIDs[0],
      effect: 'grant',
      granted_at: '2026-08-21T01:00:00Z',
      revoked_at: '2026-08-21T02:00:00Z',
      revoked_reason: 'user',
    }];

    await expect(completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: lifecycle as never,
      inventory: projection(disabled),
      refreshInventory,
    })).resolves.toBe('superseded');
    await expect(completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: lifecycle as never,
      inventory: projection(revoked),
      refreshInventory,
    })).resolves.toBe('superseded');

    expect(lifecycle.grantPermission).not.toHaveBeenCalled();
    expect(refreshInventory).not.toHaveBeenCalled();
  });

  it('checks the complete permission set before issuing any mutation', async () => {
    const lifecycle = { grantPermission: vi.fn() };
    const blocked = item([]);
    blocked.authorization!.permissions[3]!.grantBlockedByPolicy = true;

    await expect(completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: lifecycle as never,
      inventory: projection(blocked),
      refreshInventory: vi.fn(),
    })).rejects.toThrow(`blocked by policy: ${permissionIDs[3]}`);
    expect(lifecycle.grantPermission).not.toHaveBeenCalled();
  });

  it('stops as superseded when a permission revision changed concurrently', async () => {
    const lifecycle = {
      grantPermission: vi.fn(async () => {
        throw new PluginPlatformRequestError(
          'PLUGIN_AUTHORIZATION_REVISION_MISMATCH',
          'authorization changed',
          {},
          'not_committed',
        );
      }),
    };

    await expect(completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: lifecycle as never,
      inventory: projection(item([])),
      refreshInventory: vi.fn(),
    })).resolves.toBe('superseded');
    expect(lifecycle.grantPermission).toHaveBeenCalledOnce();
  });

  it('does not silently retry a lost response and continues from refreshed state on explicit retry', async () => {
    const grantPermission = vi.fn()
      .mockRejectedValueOnce(new TypeError('connection lost'))
      .mockImplementation(async () => mutationResult(grantPermission.mock.calls.length - 2));
    const lifecycle = { grantPermission };
    const refreshInventory = vi.fn(async () => projection(item(permissionIDs, 'enabled')));

    await expect(completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: lifecycle as never,
      inventory: projection(item([])),
      refreshInventory,
    })).rejects.toThrow('connection lost');
    expect(grantPermission).toHaveBeenCalledOnce();
    expect(refreshInventory).not.toHaveBeenCalled();

    await expect(completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: lifecycle as never,
      inventory: projection(item([permissionIDs[0]], 'needs_attention', {
        policyRevision: 2,
        managementRevision: 8,
        revokeEpoch: 4,
      })),
      refreshInventory,
    })).resolves.toBe('ready');
    expect(grantPermission).toHaveBeenCalledTimes(4);
    expect(refreshInventory).toHaveBeenCalledOnce();
  });

  it('classifies the one final inventory failure separately from permission setup', async () => {
    const lifecycle = { grantPermission: vi.fn(async () => mutationResult(0)) };

    await expect(completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: lifecycle as never,
      inventory: projection(item(permissionIDs.slice(1))),
      refreshInventory: vi.fn(async () => { throw new Error('offline'); }),
    })).rejects.toBeInstanceOf(ApprovedInstallInventoryRefreshError);
  });

  it('does not finish until the authoritative inventory is launchable', async () => {
    const installed = item(permissionIDs, 'enabled');
    installed.defaultLaunchTarget = undefined;

    await expect(completeApprovedOfficialInstall({
      pluginInstanceID,
      lifecycle: { grantPermission: vi.fn() } as never,
      inventory: projection(installed),
      refreshInventory: vi.fn(),
    })).rejects.toThrow('no launchable surface');
  });
});
