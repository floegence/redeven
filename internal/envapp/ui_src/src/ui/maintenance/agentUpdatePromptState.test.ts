// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  agentUpdatePromptStorageKey,
  clearAgentUpdateSkippedVersionIfMatched,
  formatLocalDateStamp,
  markAgentUpdatePromptShown,
  markAgentUpdateVersionSkipped,
  readAgentUpdatePromptMemory,
  shouldShowAgentUpdatePrompt,
} from './agentUpdatePromptState';

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

describe('agentUpdatePromptState', () => {
  beforeEach(() => {
    const storage = createStorageMock();
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  });

  it('stores prompt memory per env id', () => {
    markAgentUpdatePromptShown('env_a', 'v1.2.3', '2026-03-15', 1000);
    markAgentUpdateVersionSkipped('env_b', 'v9.9.9', 2000);

    expect(agentUpdatePromptStorageKey('env_a')).toBe('redeven_envapp_update_prompt_v1:env_a');
    expect(readAgentUpdatePromptMemory('env_a')).toEqual({
      shown_on_date: '2026-03-15',
      shown_target_version: 'v1.2.3',
      updated_at_ms: 1000,
    });
    expect(readAgentUpdatePromptMemory('env_b')).toEqual({
      skipped_version: 'v9.9.9',
      updated_at_ms: 2000,
    });
  });

  it('suppresses prompting when access gate is closed, user is non-admin, agent is offline, stale or disconnected', () => {
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

    expect(shouldShowAgentUpdatePrompt({ ...base, accessGateVisible: true })).toBe(false);
    expect(shouldShowAgentUpdatePrompt({ ...base, upgradePolicy: 'manual' })).toBe(false);
    expect(shouldShowAgentUpdatePrompt({ ...base, canAdmin: false })).toBe(false);
    expect(shouldShowAgentUpdatePrompt({ ...base, protocolStatus: 'disconnected' })).toBe(false);
    expect(shouldShowAgentUpdatePrompt({ ...base, envStatus: 'offline' })).toBe(false);
    expect(shouldShowAgentUpdatePrompt({ ...base, latestStale: true })).toBe(false);
    expect(shouldShowAgentUpdatePrompt(base)).toBe(true);
  });

  it('suppresses prompting after shown today or skipped, and re-allows when target version changes', () => {
    const today = formatLocalDateStamp(new Date('2026-03-15T10:00:00'));
    markAgentUpdatePromptShown('env_test', 'v1.1.0', today, 1111);

    expect(
      shouldShowAgentUpdatePrompt({
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
        promptMemory: readAgentUpdatePromptMemory('env_test'),
        today,
      }),
    ).toBe(false);

    expect(
      shouldShowAgentUpdatePrompt({
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
        promptMemory: readAgentUpdatePromptMemory('env_test'),
        today,
      }),
    ).toBe(true);

    markAgentUpdateVersionSkipped('env_test', 'v1.2.0', 2222);
    expect(
      shouldShowAgentUpdatePrompt({
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
        promptMemory: readAgentUpdatePromptMemory('env_test'),
        today,
      }),
    ).toBe(false);

    expect(clearAgentUpdateSkippedVersionIfMatched('env_test', 'v1.2.0', 3333)).toEqual({
      shown_on_date: today,
      shown_target_version: 'v1.1.0',
      skipped_version: undefined,
      updated_at_ms: 3333,
    });
  });
});
