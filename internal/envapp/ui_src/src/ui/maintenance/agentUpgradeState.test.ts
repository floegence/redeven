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
      message: 'Managed by Redeven Desktop. Update from the desktop release instead of self-upgrade.',
      releasePageURL: 'https://example.test/releases/v1.2.3',
      actionLabel: 'Manage in Desktop',
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
      message: '',
      releasePageURL: '',
      actionLabel: 'Update Redeven',
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
      message: 'Offline: latest version check is unavailable in local mode.',
      releasePageURL: '',
      actionLabel: 'Update Redeven',
    });
  });
});
