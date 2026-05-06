import { describe, expect, it } from 'vitest';

import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import {
  testDesktopPreferences,
  testLocalEnvironment,
  testProviderEnvironment,
} from '../testSupport/desktopTestHelpers';
import {
  environmentLibraryEntryRecord,
  splitPinnedEnvironmentEntryIDs,
} from './environmentLibraryProjection';

describe('environmentLibraryProjection', () => {
  it('builds an entry record keyed by stable environment id', () => {
    const local = testLocalEnvironment({
      label: 'Local',
    });
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        provider_environments: [providerEnvironment],
      }),
    });

    expect(environmentLibraryEntryRecord(snapshot.environments)).toEqual(Object.fromEntries(
      snapshot.environments.map((environment) => [environment.id, environment] as const),
    ));
  });

  it('splits visible entry ids into pinned and regular groups without losing order', () => {
    const local = testLocalEnvironment({
      label: 'Local',
      pinned: true,
    });
    const providerEnvironment = testProviderEnvironment('https://cp.example.invalid', 'env_demo', {
      label: 'Demo Local Serve',
      pinned: false,
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
        provider_environments: [providerEnvironment],
      }),
    });
    const entryIDs = snapshot.environments.map((environment) => environment.id);
    const entriesByID = environmentLibraryEntryRecord(snapshot.environments);

    expect(splitPinnedEnvironmentEntryIDs(entryIDs, entriesByID)).toEqual({
      pinned_entry_ids: [local.id],
      regular_entry_ids: [providerEnvironment.id],
    });
  });

  it('ignores ids that are no longer present in the projected entry record', () => {
    const local = testLocalEnvironment({
      label: 'Local',
      pinned: true,
    });
    const snapshot = buildDesktopWelcomeSnapshot({
      preferences: testDesktopPreferences({
        local_environment: local,
      }),
    });
    const entriesByID = environmentLibraryEntryRecord(snapshot.environments);

    expect(splitPinnedEnvironmentEntryIDs(
      ['missing_environment', local.id],
      entriesByID,
    )).toEqual({
      pinned_entry_ids: [local.id],
      regular_entry_ids: [],
    });
  });
});
