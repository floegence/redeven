import { describe, expect, it } from 'vitest';

import {
  DESKTOP_PROVIDER_CARD_FORBIDDEN_ACTIONS,
  desktopEntryKindOwnsRuntimeManagement,
  desktopEnvironmentManagementSurface,
  desktopProviderCardAllowsAction,
  desktopProviderEnvironmentOpenRoute,
  normalizeDesktopProviderRuntimeLinkRequestTarget,
} from './environmentManagementPrinciples';

describe('environmentManagementPrinciples', () => {
  it('keeps provider cards remote-only and outside runtime management', () => {
    expect(desktopEnvironmentManagementSurface('provider_environment')).toBe('provider_card');
    expect(desktopProviderEnvironmentOpenRoute()).toBe('remote_desktop');
    expect(desktopEntryKindOwnsRuntimeManagement('provider_environment')).toBe(false);

    for (const action of DESKTOP_PROVIDER_CARD_FORBIDDEN_ACTIONS) {
      expect(desktopProviderCardAllowsAction(action)).toBe(false);
    }
    expect(desktopProviderCardAllowsAction('open_provider_environment')).toBe(true);
    expect(desktopProviderCardAllowsAction('refresh_environment_runtime')).toBe(true);
    expect(desktopProviderCardAllowsAction('open_local_environment')).toBe(false);
    expect(desktopProviderCardAllowsAction('open_ssh_environment')).toBe(false);
  });

  it('keeps Local and SSH cards as the only runtime-management surfaces', () => {
    expect(desktopEnvironmentManagementSurface('local_environment')).toBe('managed_runtime_card');
    expect(desktopEnvironmentManagementSurface('ssh_environment')).toBe('managed_runtime_card');
    expect(desktopEnvironmentManagementSurface('external_local_ui')).toBe('unmanaged_environment_card');
    expect(desktopEntryKindOwnsRuntimeManagement('local_environment')).toBe(true);
    expect(desktopEntryKindOwnsRuntimeManagement('ssh_environment')).toBe(true);
    expect(desktopEntryKindOwnsRuntimeManagement('external_local_ui')).toBe(false);
  });

  it('requires an exact selected Local or SSH runtime target for provider links', () => {
    expect(normalizeDesktopProviderRuntimeLinkRequestTarget({
      provider_environment_id: ' provider-env ',
      runtime_target_id: ' ssh:ssh%3Adevbox%3Adefault%3Akey_agent%3Aremote_default ',
    })).toEqual({
      provider_environment_id: 'provider-env',
      runtime_target_id: 'ssh:ssh%3Adevbox%3Adefault%3Akey_agent%3Aremote_default',
    });
    expect(normalizeDesktopProviderRuntimeLinkRequestTarget({
      provider_environment_id: 'provider-env',
      runtime_target_id: 'local:local',
    })).toEqual({
      provider_environment_id: 'provider-env',
      runtime_target_id: 'local:local',
    });
    expect(normalizeDesktopProviderRuntimeLinkRequestTarget({
      provider_environment_id: 'provider-env',
      runtime_target_id: 'provider-env',
    })).toBeNull();
    expect(normalizeDesktopProviderRuntimeLinkRequestTarget({
      provider_environment_id: 'provider-env',
    })).toBeNull();
  });
});
