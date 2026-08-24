import { beforeEach, describe, expect, it } from 'vitest';

import {
  activatePluginSessionCredential,
  applyPendingPluginSessionCredential,
  applyPluginSessionCredential,
  clearPluginSessionCredential,
  readPluginSessionCredential,
  replacePendingPluginSessionCredential,
} from './pluginSessionCredential';

describe('plugin session credential binding', () => {
  beforeEach(() => clearPluginSessionCredential());

  it('publishes only the credential for the channel that completed its handshake', () => {
    const first = replacePendingPluginSessionCredential('channel-a', 'credential-a');
    const second = replacePendingPluginSessionCredential('channel-b', 'credential-b');

    expect(readPluginSessionCredential()).toBe('');
    expect(first && activatePluginSessionCredential(first)).toBe(false);
    expect(second && activatePluginSessionCredential(second)).toBe(true);
    expect(readPluginSessionCredential()).toBe('credential-b');

    const headers = new Headers();
    applyPluginSessionCredential(headers);
    expect(headers.get('X-Redeven-Plugin-Session')).toBe('credential-b');
  });

  it('does not publish incomplete or unknown channel credentials', () => {
    expect(replacePendingPluginSessionCredential('', 'credential-a')).toBeUndefined();
    expect(replacePendingPluginSessionCredential('channel-a', '')).toBeUndefined();

    expect(readPluginSessionCredential()).toBe('');
  });

  it('clears active and pending credentials together', () => {
    const binding = replacePendingPluginSessionCredential('channel-a', 'credential-a');
    clearPluginSessionCredential();

    expect(binding && activatePluginSessionCredential(binding)).toBe(false);
    expect(readPluginSessionCredential()).toBe('');
  });

  it('replaces stale pending credentials when a newer artifact is issued', () => {
    const oldBinding = replacePendingPluginSessionCredential('channel-old', 'credential-old');
    const newBinding = replacePendingPluginSessionCredential('channel-new', 'credential-new');

    expect(oldBinding && activatePluginSessionCredential(oldBinding)).toBe(false);
    expect(newBinding && activatePluginSessionCredential(newBinding)).toBe(true);
    expect(readPluginSessionCredential()).toBe('credential-new');
  });

  it('uses a staged credential only for its exact readiness request', () => {
    const oldBinding = replacePendingPluginSessionCredential('channel-old', 'credential-old');
    const newBinding = replacePendingPluginSessionCredential('channel-new', 'credential-new');
    const oldHeaders = new Headers();
    const newHeaders = new Headers();

    expect(oldBinding && applyPendingPluginSessionCredential(oldHeaders, oldBinding)).toBe(false);
    expect(newBinding && applyPendingPluginSessionCredential(newHeaders, newBinding)).toBe(true);
    expect(oldHeaders.has('X-Redeven-Plugin-Session')).toBe(false);
    expect(newHeaders.get('X-Redeven-Plugin-Session')).toBe('credential-new');
  });
});
