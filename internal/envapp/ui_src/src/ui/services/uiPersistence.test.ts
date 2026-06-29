import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ENVAPP_STORAGE_NAMESPACE,
  DEFAULT_WORKBENCH_INSTANCE_STATE_KEY,
  DEFAULT_WORKBENCH_LOCAL_PREFERENCES_KEY,
  DESKTOP_ENVAPP_STORAGE_NAMESPACE,
  DESKTOP_WORKBENCH_INSTANCE_STATE_KEY,
  DESKTOP_WORKBENCH_LOCAL_PREFERENCES_KEY,
  resolveEnvAppStorageBinding,
} from './uiPersistence';

describe('uiPersistence', () => {
  it('uses fixed desktop persistence keys when desktop storage is available', () => {
    expect(resolveEnvAppStorageBinding({
      envID: 'env_demo',
      desktopStateStorageAvailable: true,
    })).toEqual({
      namespace: DESKTOP_ENVAPP_STORAGE_NAMESPACE,
      workbenchLocalPreferencesKey: DESKTOP_WORKBENCH_LOCAL_PREFERENCES_KEY,
      workbenchInstanceStateKey: DESKTOP_WORKBENCH_INSTANCE_STATE_KEY,
    });
  });

  it('uses env-scoped local-only Workbench keys in browser runtimes', () => {
    expect(resolveEnvAppStorageBinding({
      envID: 'env_demo',
      desktopStateStorageAvailable: false,
    })).toEqual({
      namespace: 'redeven-envapp:env_demo',
      workbenchLocalPreferencesKey: 'workbench:local_preferences:env_demo',
      workbenchInstanceStateKey: 'workbench:instance_state:env_demo',
    });
  });

  it('falls back to shared browser defaults when no env id exists', () => {
    expect(resolveEnvAppStorageBinding({
      envID: '   ',
      desktopStateStorageAvailable: false,
    })).toEqual({
      namespace: DEFAULT_ENVAPP_STORAGE_NAMESPACE,
      workbenchLocalPreferencesKey: DEFAULT_WORKBENCH_LOCAL_PREFERENCES_KEY,
      workbenchInstanceStateKey: DEFAULT_WORKBENCH_INSTANCE_STATE_KEY,
    });
  });
});
