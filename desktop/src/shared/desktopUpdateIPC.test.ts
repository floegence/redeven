import { describe, expect, it } from 'vitest';

import {
  normalizeDesktopUpdateAction,
  normalizeDesktopUpdateSnapshot,
  unsupportedDesktopUpdateSnapshot,
} from './desktopUpdateIPC';

describe('desktopUpdateIPC', () => {
  it('normalizes trusted updater snapshots and clamps progress', () => {
    expect(normalizeDesktopUpdateSnapshot({
      platform: 'linux_package',
      state: 'downloading',
      current_version: '1.2.3',
      available_version: '1.3.0',
      download_percent: 120,
      automatically_checks_for_updates: true,
      capabilities: ['check', 'download', 'download', 'invalid'],
    })).toEqual({
      platform: 'linux_package',
      state: 'downloading',
      current_version: '1.2.3',
      available_version: '1.3.0',
      download_percent: 100,
      automatically_checks_for_updates: true,
      capabilities: ['check', 'download'],
    });
  });

  it('falls back closed for malformed snapshots', () => {
    expect(normalizeDesktopUpdateSnapshot(null, unsupportedDesktopUpdateSnapshot('1.0.0')))
      .toEqual(unsupportedDesktopUpdateSnapshot('1.0.0'));
  });

  it('accepts only known actions', () => {
    expect(normalizeDesktopUpdateAction({ kind: 'set_automatic_checks', enabled: 1 })).toEqual({
      kind: 'set_automatic_checks',
      enabled: false,
    });
    expect(normalizeDesktopUpdateAction({ kind: 'install_update' })).toEqual({ kind: 'install_update' });
    expect(normalizeDesktopUpdateAction({ kind: 'run_shell', command: 'rm' })).toBeNull();
  });
});
