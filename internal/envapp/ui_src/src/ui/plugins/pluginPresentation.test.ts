import { describe, expect, it } from 'vitest';

import { presentPlugin, type PluginPrimaryAction } from './pluginPresentation';
import type { PluginInventoryItem } from './pluginTypes';

function plugin(overrides: Partial<PluginInventoryItem> = {}): PluginInventoryItem {
  return {
    inventoryKey: 'instance:plugin-1',
    pluginID: 'com.example.plugin',
    pluginInstanceID: 'plugin-1',
    displayName: 'Example Plugin',
    description: 'Example plugin',
    iconFallback: 'generic',
    category: 'other',
    searchKeywords: [],
    publisher: 'Example',
    version: '1.0.0',
    managementRevision: 4,
    lifecycleState: 'disabled',
    trustBadge: 'unsigned',
    pinned: false,
    ...overrides,
  };
}

function authorization(options: { missing?: boolean; policyBlocked?: boolean } = {}): PluginInventoryItem['authorization'] {
  return {
    grants: [],
    permissions: [{
      permissionID: 'workspace.read',
      group: 'other',
      requiredToOpen: true,
      methods: ['workspace.list'],
      granted: !options.missing,
      deniedByGrant: false,
      blockedByPolicy: Boolean(options.policyBlocked),
      grantBlockedByPolicy: Boolean(options.policyBlocked),
      blockedToOpen: Boolean(options.policyBlocked),
    }],
    revisions: { policyRevision: 2, managementRevision: 4, revokeEpoch: 1 },
  };
}

describe('presentPlugin', () => {
  it.each<readonly [string, PluginInventoryItem, PluginPrimaryAction]>([
    ['offers review and install for an available package', plugin({ pluginInstanceID: undefined, lifecycleState: 'not_installed', trustBadge: 'official' }), 'install'],
    ['enables and completes required access for a disabled plugin', plugin({ authorization: authorization({ missing: true }) }), 'enable'],
    ['enables a disabled plugin after required access is granted', plugin({ authorization: authorization() }), 'enable'],
    ['opens an enabled ready plugin in Activity', plugin({ lifecycleState: 'enabled', defaultLaunchTarget: { pluginID: 'com.example.plugin', pluginInstanceID: 'plugin-1', surfaceID: 'main', expectedManagementRevision: 4 } }), 'open'],
    ['reviews an update before allowing open', plugin({ lifecycleState: 'update_available' }), 'review_update'],
    ['shows a policy restriction before a lifecycle action', plugin({ lifecycleState: 'disabled', attentionReason: 'policy_restricted', authorization: authorization({ policyBlocked: true }) }), 'view_policy'],
    ['shows a missing runtime requirement', plugin({ lifecycleState: 'needs_attention', attentionReason: 'runtime_missing' }), 'view_runtime'],
    ['fails closed for revoked trust even if lifecycle says enabled', plugin({ lifecycleState: 'enabled', trustBadge: 'revoked', defaultLaunchTarget: { pluginID: 'com.example.plugin', pluginInstanceID: 'plugin-1', surfaceID: 'main', expectedManagementRevision: 4 } }), 'view_trust'],
    ['fails closed for policy-blocked execution approval', plugin({ externalPackage: { executionApproval: { state: 'policy_blocked', reason_codes: ['blocked'], assessed_at: '2026-07-25T00:00:00Z' } } as PluginInventoryItem['externalPackage'] }), 'view_trust'],
    ['offers executable enable recovery if a stale lifecycle says enabled without its required access', plugin({ lifecycleState: 'enabled', authorization: authorization({ missing: true }), defaultLaunchTarget: { pluginID: 'com.example.plugin', pluginInstanceID: 'plugin-1', surfaceID: 'main', expectedManagementRevision: 4 } }), 'enable'],
  ])('%s', (_name, item, action) => {
    expect(presentPlugin(item).primaryAction).toBe(action);
  });

  it('exposes a mode-independent Open action for a runnable enabled target', () => {
    const target = { pluginID: 'com.example.plugin', pluginInstanceID: 'plugin-1', surfaceID: 'main', expectedManagementRevision: 4 };
    expect(presentPlugin(plugin({ lifecycleState: 'enabled', defaultLaunchTarget: target })).canOpenSurface).toBe(true);
  });

  it('exposes Open for runnable update states', () => {
    const target = { pluginID: 'com.example.plugin', pluginInstanceID: 'plugin-1', surfaceID: 'main', expectedManagementRevision: 4 };
    const presentation = presentPlugin(plugin({ lifecycleState: 'update_available', defaultLaunchTarget: target }));
    expect(presentation.canOpenSurface).toBe(true);
    expect(presentation.primaryAction).toBe('review_update');
  });

  it('does not expose stale launch capabilities while disabled', () => {
    const target = { pluginID: 'com.example.plugin', pluginInstanceID: 'plugin-1', surfaceID: 'main', expectedManagementRevision: 4 };
    const presentation = presentPlugin(plugin({ lifecycleState: 'disabled', defaultLaunchTarget: target }));
    expect(presentation.canOpenSurface).toBe(false);
  });
});
