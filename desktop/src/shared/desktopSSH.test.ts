import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  desktopSSHAuthority,
  desktopSSHEnvironmentID,
  desktopSSHRuntimeAffectingSettingsMatch,
  normalizeDesktopSSHAuthMode,
  normalizeDesktopSSHBootstrapStrategy,
  normalizeDesktopSSHEnvironmentDetails,
  normalizeDesktopSSHPort,
  normalizeDesktopSSHReleaseBaseURL,
  normalizeDesktopSSHRuntimeRoot,
} from './desktopSSH';

describe('desktopSSH', () => {
  it('normalizes SSH environment details and defaults the remote runtime root', () => {
    expect(normalizeDesktopSSHEnvironmentDetails({
      ssh_destination: '  devbox  ',
      ssh_port: normalizeDesktopSSHPort(''),
      auth_mode: '',
      runtime_root: '',
      bootstrap_strategy: '',
      release_base_url: '',
    })).toEqual(expect.objectContaining({
      ssh_destination: 'devbox',
      ssh_port: null,
      auth_mode: 'key_agent',
      runtime_root: DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
      bootstrap_strategy: DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
      release_base_url: '',
    }));
  });

  it('builds stable SSH authorities and environment ids', () => {
    expect(desktopSSHAuthority({
      ssh_destination: 'user@example.internal',
      ssh_port: 2222,
      auth_mode: 'key_agent',
    })).toBe('user@example.internal:2222');

    expect(desktopSSHEnvironmentID({
      ssh_destination: 'user@example.internal',
      ssh_port: 2222,
      auth_mode: 'password',
      runtime_root: '/opt/redeven',
      bootstrap_strategy: DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
      release_base_url: '',
    })).toBe('ssh:user%40example.internal:2222:password:%2Fopt%2Fredeven');
  });

  it('requires custom remote runtime roots to be absolute paths', () => {
    expect(() => normalizeDesktopSSHRuntimeRoot('relative/path')).toThrow(
      'Runtime root must be an absolute path or use the default remote .redeven.',
    );
  });

  it('normalizes bootstrap delivery and release base URL inputs', () => {
    expect(normalizeDesktopSSHBootstrapStrategy(' desktop_upload ')).toBe('desktop_upload');
    expect(normalizeDesktopSSHAuthMode(' password ')).toBe('password');
    expect(normalizeDesktopSSHAuthMode('')).toBe('key_agent');
    expect(normalizeDesktopSSHReleaseBaseURL('https://mirror.example.invalid/releases/')).toBe(
      'https://mirror.example.invalid/releases',
    );
  });

  it('treats release source, bootstrap strategy, and timeout as runtime-affecting settings', () => {
    const base = normalizeDesktopSSHEnvironmentDetails({
      ssh_destination: 'devbox',
      ssh_port: 2222,
      auth_mode: 'key_agent',
      runtime_root: 'remote_default',
      bootstrap_strategy: 'auto',
      release_base_url: '',
      connect_timeout_seconds: 10,
    });

    expect(desktopSSHRuntimeAffectingSettingsMatch(base, {
      ...base,
      release_base_url: '',
      bootstrap_strategy: 'auto',
      connect_timeout_seconds: 10,
    })).toBe(true);
    expect(desktopSSHRuntimeAffectingSettingsMatch(base, {
      ...base,
      release_base_url: 'https://mirror.example.invalid/releases',
    })).toBe(false);
    expect(desktopSSHRuntimeAffectingSettingsMatch(base, {
      ...base,
      bootstrap_strategy: 'desktop_upload',
    })).toBe(false);
    expect(desktopSSHRuntimeAffectingSettingsMatch(base, {
      ...base,
      connect_timeout_seconds: 30,
    })).toBe(false);
  });
});
