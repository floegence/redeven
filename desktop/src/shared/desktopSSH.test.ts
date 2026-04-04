import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
  desktopSSHAuthority,
  desktopSSHEnvironmentID,
  normalizeDesktopSSHEnvironmentDetails,
  normalizeDesktopSSHPort,
  normalizeDesktopSSHRemoteInstallDir,
} from './desktopSSH';

describe('desktopSSH', () => {
  it('normalizes SSH environment details and defaults the remote install directory', () => {
    expect(normalizeDesktopSSHEnvironmentDetails({
      ssh_destination: '  devbox  ',
      ssh_port: normalizeDesktopSSHPort(''),
      remote_install_dir: '',
    })).toEqual({
      ssh_destination: 'devbox',
      ssh_port: null,
      remote_install_dir: DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
    });
  });

  it('builds stable SSH authorities and environment ids', () => {
    expect(desktopSSHAuthority({
      ssh_destination: 'user@example.internal',
      ssh_port: 2222,
      remote_install_dir: DEFAULT_DESKTOP_SSH_REMOTE_INSTALL_DIR,
    })).toBe('user@example.internal:2222');

    expect(desktopSSHEnvironmentID({
      ssh_destination: 'user@example.internal',
      ssh_port: 2222,
      remote_install_dir: '/opt/redeven',
    })).toBe('ssh:user%40example.internal:2222:%2Fopt%2Fredeven');
  });

  it('requires custom remote install directories to be absolute paths', () => {
    expect(() => normalizeDesktopSSHRemoteInstallDir('relative/path')).toThrow(
      'Remote install directory must be an absolute path or use the default remote cache.',
    );
  });
});
