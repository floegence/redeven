// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  runtimeUpdatePromptStorageKey,
  clearRuntimeUpdateSkippedVersionIfMatched,
  formatLocalDateStamp,
  markRuntimeUpdatePromptShown,
  markRuntimeUpdateVersionSkipped,
  readRuntimeUpdatePromptMemory,
  shouldShowRuntimeUpdatePrompt,
} from './runtimeUpdatePromptState';

function createStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? String(store.get(key)) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

describe('runtimeUpdatePromptState', () => {
  beforeEach(() => {
    const storage = createStorageMock();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  });

  it('stores prompt memory per env id', () => {
    markRuntimeUpdatePromptShown('env_a', 'v1.2.3', '2026-03-15', 1000);
    markRuntimeUpdateVersionSkipped('env_b', 'v9.9.9', 2000);

    expect(runtimeUpdatePromptStorageKey('env_a')).toBe('redeven_envapp_update_prompt_v1:env_a');
    expect(readRuntimeUpdatePromptMemory('env_a')).toEqual({
      shown_on_date: '2026-03-15',
      shown_target_version: 'v1.2.3',
      updated_at_ms: 1000,
    });
    expect(readRuntimeUpdatePromptMemory('env_b')).toEqual({
      skipped_version: 'v9.9.9',
      updated_at_ms: 2000,
    });
  });

  it('suppresses prompting when access gate is closed, user is non-admin, the runtime is offline, stale or disconnected', () => {
    const base = {
      accessGateVisible: false,
      isLocalMode: false,
      upgradePolicy: 'self_upgrade',
      protocolStatus: 'connected',
      canAdmin: true,
      envStatus: 'online',
      maintaining: false,
      currentVersion: 'v1.0.0',
      preferredTargetVersion: 'v1.1.0',
      latestStale: false,
      promptMemory: {},
      today: '2026-03-15',
    } as const;

    expect(shouldShowRuntimeUpdatePrompt({ ...base, accessGateVisible: true })).toBe(false);
    expect(shouldShowRuntimeUpdatePrompt({ ...base, upgradePolicy: 'manual' })).toBe(false);
    expect(shouldShowRuntimeUpdatePrompt({ ...base, canAdmin: false })).toBe(false);
    expect(shouldShowRuntimeUpdatePrompt({ ...base, protocolStatus: 'disconnected' })).toBe(false);
    expect(shouldShowRuntimeUpdatePrompt({ ...base, envStatus: 'offline' })).toBe(false);
    expect(shouldShowRuntimeUpdatePrompt({ ...base, latestStale: true })).toBe(false);
    expect(shouldShowRuntimeUpdatePrompt(base)).toBe(true);
  });

  it('suppresses prompting after shown today or skipped, and re-allows when target version changes', () => {
    const today = formatLocalDateStamp(new Date('2026-03-15T10:00:00'));
    markRuntimeUpdatePromptShown('env_test', 'v1.1.0', today, 1111);

    expect(
      shouldShowRuntimeUpdatePrompt({
        accessGateVisible: false,
        isLocalMode: false,
        upgradePolicy: 'self_upgrade',
        protocolStatus: 'connected',
        canAdmin: true,
        envStatus: 'online',
        maintaining: false,
        currentVersion: 'v1.0.0',
        preferredTargetVersion: 'v1.1.0',
        latestStale: false,
        promptMemory: readRuntimeUpdatePromptMemory('env_test'),
        today,
      }),
    ).toBe(false);

    expect(
      shouldShowRuntimeUpdatePrompt({
        accessGateVisible: false,
        isLocalMode: false,
        upgradePolicy: 'self_upgrade',
        protocolStatus: 'connected',
        canAdmin: true,
        envStatus: 'online',
        maintaining: false,
        currentVersion: 'v1.0.0',
        preferredTargetVersion: 'v1.2.0',
        latestStale: false,
        promptMemory: readRuntimeUpdatePromptMemory('env_test'),
        today,
      }),
    ).toBe(true);

    markRuntimeUpdateVersionSkipped('env_test', 'v1.2.0', 2222);
    expect(
      shouldShowRuntimeUpdatePrompt({
        accessGateVisible: false,
        isLocalMode: false,
        upgradePolicy: 'self_upgrade',
        protocolStatus: 'connected',
        canAdmin: true,
        envStatus: 'online',
        maintaining: false,
        currentVersion: 'v1.0.0',
        preferredTargetVersion: 'v1.2.0',
        latestStale: false,
        promptMemory: readRuntimeUpdatePromptMemory('env_test'),
        today,
      }),
    ).toBe(false);

    expect(clearRuntimeUpdateSkippedVersionIfMatched('env_test', 'v1.2.0', 3333)).toEqual({
      shown_on_date: today,
      shown_target_version: 'v1.1.0',
      skipped_version: undefined,
      updated_at_ms: 3333,
    });
  });
});
