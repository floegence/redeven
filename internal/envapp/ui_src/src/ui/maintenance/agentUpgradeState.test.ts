import { describe, expect, it } from 'vitest';

import { resolveAgentUpgradeState } from './agentUpgradeState';

describe('agentUpgradeState', () => {
  it('blocks updates until an explicit Gateway-supervised maintenance context is available', () => {
    expect(resolveAgentUpgradeState({
      current_version: 'v1.2.3',
      upgrade_policy: 'desktop_release',
      release_page_url: 'https://example.test/releases/v1.2.3',
    })).toEqual({
      policy: 'desktop_release',
      allowsUpgradeAction: false,
      automaticPromptAllowed: false,
      requiresTargetVersion: false,
      message: 'Runtime management is provided through Redeven Gateway setup. Use Desktop or your administrator\'s setup flow to install the update.',
      releasePageURL: 'https://example.test/releases/v1.2.3',
      actionLabel: 'Manage in Desktop',
      actionMethod: 'manual',
    });
  });

  it('does not expose Runtime self-upgrade as a product lifecycle fallback', () => {
    expect(resolveAgentUpgradeState({
      current_version: 'v1.0.0',
      latest_version: 'v1.1.0',
      recommended_version: 'v1.1.0',
      upgrade_policy: 'self_upgrade',
      message: '',
    })).toEqual({
      policy: 'self_upgrade',
      allowsUpgradeAction: false,
      automaticPromptAllowed: false,
      requiresTargetVersion: true,
      message: '',
      releasePageURL: '',
      actionLabel: 'Update Redeven',
      actionMethod: 'manual',
    });
  });

  it('falls back to manual semantics when latest metadata is unavailable', () => {
    expect(resolveAgentUpgradeState({
      current_version: 'v1.2.3',
      message: 'Offline: latest version check is unavailable in local mode.',
    })).toEqual({
      policy: 'manual',
      allowsUpgradeAction: false,
      automaticPromptAllowed: false,
      requiresTargetVersion: true,
      message: 'Offline: latest version check is unavailable in local mode.',
      releasePageURL: '',
      actionLabel: 'Update Redeven',
      actionMethod: 'manual',
    });
  });

  it('uses an explicit available maintenance context as the only update affordance', () => {
    expect(resolveAgentUpgradeState({
      current_version: 'v1.0.0',
      upgrade_policy: 'desktop_release',
    }, {
      available: true,
      authority: 'gateway_supervisor',
      runtime_kind: 'ssh',
      management: {
        support: 'supported',
        authorization: 'allowed',
        readiness: 'ready',
        presentation_state: 'allowed',
      },
      upgrade_policy: 'desktop_release',
      restart: {
        availability: 'available',
        method: 'gateway_supervisor',
        label: 'Restart Runtime',
        title: 'Restart Runtime',
        message: 'Gateway will restart the Runtime.',
      },
      upgrade: {
        availability: 'available',
        method: 'gateway_supervisor',
        label: 'Update Runtime',
        title: 'Update Runtime',
        message: 'Gateway will install the verified Runtime release.',
        requires_target_version: false,
      },
    })).toEqual(expect.objectContaining({
      allowsUpgradeAction: true,
      requiresTargetVersion: false,
      message: 'Gateway will install the verified Runtime release.',
      actionLabel: 'Update Runtime',
      actionMethod: 'gateway_supervisor',
    }));
  });
});
