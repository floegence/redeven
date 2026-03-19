import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DECK_STORAGE_KEY,
  DEFAULT_ENVAPP_STORAGE_NAMESPACE,
  DESKTOP_DECK_STORAGE_KEY,
  DESKTOP_ENVAPP_STORAGE_NAMESPACE,
  resolveEnvAppStorageBinding,
} from './uiPersistence';

describe('uiPersistence', () => {
  it('uses fixed desktop persistence keys when desktop storage is available', () => {
    expect(resolveEnvAppStorageBinding({
      envID: 'env_demo',
      desktopStateStorageAvailable: true,
    })).toEqual({
      namespace: DESKTOP_ENVAPP_STORAGE_NAMESPACE,
      deckStorageKey: DESKTOP_DECK_STORAGE_KEY,
    });
  });

  it('uses env-scoped keys in browser runtimes', () => {
    expect(resolveEnvAppStorageBinding({
      envID: 'env_demo',
      desktopStateStorageAvailable: false,
    })).toEqual({
      namespace: 'redeven-envapp:env_demo',
      deckStorageKey: 'deck:env_demo',
    });
  });

  it('falls back to shared browser defaults when no env id exists', () => {
    expect(resolveEnvAppStorageBinding({
      envID: '   ',
      desktopStateStorageAvailable: false,
    })).toEqual({
      namespace: DEFAULT_ENVAPP_STORAGE_NAMESPACE,
      deckStorageKey: DEFAULT_DECK_STORAGE_KEY,
    });
  });
});
