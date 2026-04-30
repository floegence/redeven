import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
  DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
  desktopSSHAuthority,
  desktopSSHEnvironmentID,
  normalizeDesktopSSHEnvironmentInstanceID,
  normalizeDesktopSSHAuthMode,
  normalizeDesktopSSHBootstrapStrategy,
  normalizeDesktopSSHEnvironmentDetails,
  normalizeDesktopSSHPort,
  normalizeDesktopSSHReleaseBaseURL,
  normalizeDesktopSSHRemoteInstallDir,
} from './desktopSSH';

describe('desktopSSH', () => {
  it('normalizes SSH environment details and defaults the remote install directory', () => {
    expect(normalizeDesktopSSHEnvironmentDetails({
      ssh_destination: '  devbox  ',
      ssh_port: normalizeDesktopSSHPort(''),
      auth_mode: '',
      remote_install_dir: '',
      bootstrap_strategy: '',
      release_base_url: '',
      environment_instance_id: '',
    })).toEqual(expect.objectContaining({
      ssh_destination: 'devbox',
      ssh_port: null,
      auth_mode: 'key_agent',
      remote_install_dir: DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
      bootstrap_strategy: DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
      release_base_url: '',
    }));
  });

  it('builds stable SSH authorities and environment ids', () => {
    expect(desktopSSHAuthority({
      ssh_destination: 'user@example.internal',
      ssh_port: 2222,
      auth_mode: 'key_agent',
      remote_install_dir: DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
      bootstrap_strategy: DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
      release_base_url: '',
    })).toBe('user@example.internal:2222');

    expect(desktopSSHEnvironmentID({
      ssh_destination: 'user@example.internal',
      ssh_port: 2222,
      auth_mode: 'password',
      remote_install_dir: '/opt/redeven',
      bootstrap_strategy: DEFAULT_DESKTOP_SSH_BOOTSTRAP_STRATEGY,
      release_base_url: '',
      environment_instance_id: 'envinst_demo001',
    })).toBe('ssh:user%40example.internal:2222:password:%2Fopt%2Fredeven:envinst_demo001');
  });

  it('requires custom remote install directories to be absolute paths', () => {
    expect(() => normalizeDesktopSSHRemoteInstallDir('relative/path')).toThrow(
      'Remote install directory must be an absolute path or use the default remote cache.',
    );
  });

  it('normalizes bootstrap delivery and release base URL inputs', () => {
    expect(normalizeDesktopSSHBootstrapStrategy(' desktop_upload ')).toBe('desktop_upload');
    expect(normalizeDesktopSSHAuthMode(' password ')).toBe('password');
    expect(normalizeDesktopSSHAuthMode('')).toBe('key_agent');
    expect(normalizeDesktopSSHReleaseBaseURL('https://mirror.example.invalid/releases/')).toBe(
      'https://mirror.example.invalid/releases',
    );
    expect(normalizeDesktopSSHEnvironmentInstanceID(' EnvInst_Demo001 ')).toBe('envinst_demo001');
  });
});
