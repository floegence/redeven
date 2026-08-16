import { beforeEach, describe, expect, it } from 'vitest';

import {
  activatePendingPluginSessionCredential,
  activatePluginSessionCredential,
  applyPluginSessionCredential,
  clearPluginSessionCredential,
  readPluginSessionCredential,
  replacePendingPluginSessionCredential,
  stagePluginSessionCredential,
} from './pluginSessionCredential';

describe('plugin session credential binding', () => {
  beforeEach(() => clearPluginSessionCredential());

  it('publishes only the credential for the channel that completed its handshake', () => {
    stagePluginSessionCredential('channel-a', 'credential-a');
    stagePluginSessionCredential('channel-b', 'credential-b');

    expect(readPluginSessionCredential()).toBe('');
    expect(activatePluginSessionCredential('channel-a')).toBe(true);
    expect(readPluginSessionCredential()).toBe('credential-a');
    expect(activatePluginSessionCredential('channel-b')).toBe(false);

    const headers = new Headers();
    applyPluginSessionCredential(headers);
    expect(headers.get('X-Redeven-Plugin-Session')).toBe('credential-a');
  });

  it('does not publish incomplete or unknown channel credentials', () => {
    stagePluginSessionCredential('', 'credential-a');
    stagePluginSessionCredential('channel-a', '');

    expect(activatePluginSessionCredential('channel-a')).toBe(false);
    expect(readPluginSessionCredential()).toBe('');
  });

  it('clears active and pending credentials together', () => {
    stagePluginSessionCredential('channel-a', 'credential-a');
    clearPluginSessionCredential();

    expect(activatePluginSessionCredential('channel-a')).toBe(false);
    expect(readPluginSessionCredential()).toBe('');
  });

  it('replaces stale pending credentials when a newer artifact is issued', () => {
    stagePluginSessionCredential('channel-old', 'credential-old');
    replacePendingPluginSessionCredential('channel-new', 'credential-new');

    expect(activatePluginSessionCredential('channel-old')).toBe(false);
    expect(activatePendingPluginSessionCredential()).toBe(true);
    expect(readPluginSessionCredential()).toBe('credential-new');
  });
});
