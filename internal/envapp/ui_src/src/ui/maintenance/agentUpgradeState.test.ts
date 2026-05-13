import { describe, expect, it } from 'vitest';

import { resolveAgentUpgradeState } from './agentUpgradeState';

describe('agentUpgradeState', () => {
  it('uses desktop release policy message and blocks self-upgrade actions', () => {
    expect(resolveAgentUpgradeState({
      current_version: 'v1.2.3',
      upgrade_policy: 'desktop_release',
      release_page_url: 'https://example.test/releases/v1.2.3',
    })).toEqual({
      policy: 'desktop_release',
      allowsUpgradeAction: true,
      automaticPromptAllowed: false,
      requiresTargetVersion: false,
      message: 'Managed by Redeven Desktop. Update from the desktop release instead of self-upgrade.',
      releasePageURL: 'https://example.test/releases/v1.2.3',
      actionLabel: 'Manage in Desktop',
      actionMethod: 'manual',
    });
  });

  it('keeps self-upgrade eligible for automatic prompting', () => {
    expect(resolveAgentUpgradeState({
      current_version: 'v1.0.0',
      latest_version: 'v1.1.0',
      recommended_version: 'v1.1.0',
      upgrade_policy: 'self_upgrade',
      message: '',
    })).toEqual({
      policy: 'self_upgrade',
      allowsUpgradeAction: true,
      automaticPromptAllowed: true,
      requiresTargetVersion: true,
      message: '',
      releasePageURL: '',
      actionLabel: 'Update Redeven',
      actionMethod: 'runtime_rpc_upgrade',
    });
  });

  it('falls back to manual semantics when latest metadata is unavailable', () => {
    expect(resolveAgentUpgradeState({
      current_version: 'v1.2.3',
      message: 'Offline: latest version check is unavailable in local mode.',
    })).toEqual({
      policy: 'manual',
      allowsUpgradeAction: true,
      automaticPromptAllowed: false,
      requiresTargetVersion: true,
      message: 'Offline: latest version check is unavailable in local mode.',
      releasePageURL: '',
      actionLabel: 'Update Redeven',
      actionMethod: 'manual',
    });
  });

  it('lets the maintenance context own desktop SSH update affordances', () => {
    expect(resolveAgentUpgradeState({
      current_version: 'v1.0.0',
      upgrade_policy: 'desktop_release',
    }, {
      available: true,
      authority: 'desktop_ssh',
      runtime_kind: 'ssh',
      lifecycle_owner: 'external',
      service_owner: 'desktop',
      desktop_managed: true,
      upgrade_policy: 'desktop_release',
      restart: {
        availability: 'available',
        method: 'desktop_ssh_restart',
        label: 'Restart SSH runtime',
        confirm_label: 'Restart',
        title: 'Restart SSH Runtime?',
        message: 'Desktop will restart the SSH runtime.',
      },
      upgrade: {
        availability: 'available',
        method: 'desktop_ssh_force_update',
        label: 'Update SSH runtime',
        confirm_label: 'Update',
        title: 'Update SSH Runtime?',
        message: 'Desktop will reinstall the SSH runtime.',
        requires_target_version: false,
      },
    })).toEqual(expect.objectContaining({
      allowsUpgradeAction: true,
      requiresTargetVersion: false,
      message: 'Desktop will reinstall the SSH runtime.',
      actionLabel: 'Update SSH runtime',
      actionMethod: 'desktop_ssh_force_update',
    }));
  });
});
