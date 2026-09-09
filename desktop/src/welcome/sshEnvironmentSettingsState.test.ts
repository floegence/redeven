import { describe, expect, it } from 'vitest';
import { createDesktopI18n } from '../shared/i18n';
import {
  sshEnvironmentRootIsDefault,
  sshEnvironmentSettingsDirty,
  validateSSHEnvironmentSettings,
  type SSHConnectionDialogState,
} from './sshEnvironmentSettingsState';

const sshSettingsFixture: SSHConnectionDialogState = {
  mode: 'edit',
  connection_kind: 'ssh_environment',
  environment_id: 'ssh-fixture',
  label: 'gzcom',
  ssh_destination: 'gzcom',
  ssh_port: '',
  auth_mode: 'key_agent',
  ssh_password: '',
  ssh_password_mode: 'keep',
  ssh_password_configured: true,
  baseline_ssh_destination: 'gzcom',
  baseline_ssh_port: '',
  baseline_auth_mode: 'key_agent',
  runtime_root: '',
  bootstrap_strategy: 'auto',
  release_base_url: '',
  connect_timeout_seconds: '10',
  auto_runtime_probe_enabled: true,
};

describe('SSH environment settings state', () => {
  it('treats password removal, strategy and probe changes as edits while ignoring snapshot metadata', () => {
    expect(sshEnvironmentSettingsDirty(sshSettingsFixture, { ...sshSettingsFixture })).toBe(false);
    for (const change of [
      { ssh_password_mode: 'clear' as const },
      { bootstrap_strategy: 'remote_install' as const },
      { auto_runtime_probe_enabled: false },
      { label: 'Production' },
      { ssh_password: 'test-only' },
    ])
      expect(sshEnvironmentSettingsDirty(sshSettingsFixture, { ...sshSettingsFixture, ...change })).toBe(true);
    expect(
      sshEnvironmentSettingsDirty(sshSettingsFixture, { ...sshSettingsFixture, ssh_password_configured: false }),
    ).toBe(false);
  });
  it('recognizes every supported default directory spelling without rewriting custom paths', () => {
    for (const path of ['', '~/.redeven', '$HOME/.redeven', '${HOME}/.redeven', 'remote_default'])
      expect(sshEnvironmentRootIsDefault(path)).toBe(true);
    expect(sshEnvironmentRootIsDefault('/srv/redeven')).toBe(false);
    expect(sshEnvironmentRootIsDefault('relative/path')).toBe(false);
  });
  it('reports all invalid connection fields using the authoritative SSH normalizers', () => {
    const errors = validateSSHEnvironmentSettings(
      {
        ...sshSettingsFixture,
        label: '',
        ssh_destination: '-option',
        ssh_port: '65536',
        runtime_root: 'relative',
        release_base_url: 'file:///tmp/releases',
        connect_timeout_seconds: '0',
      },
      createDesktopI18n('en-US'),
    );
    expect(Object.keys(errors)).toEqual([
      'label',
      'ssh_destination',
      'ssh_port',
      'runtime_root',
      'release_base_url',
      'connect_timeout_seconds',
    ]);
  });
  it('accepts defaults, supported custom settings, and fractional positive timeouts', () => {
    expect(validateSSHEnvironmentSettings(sshSettingsFixture, createDesktopI18n('en-US'))).toEqual({});
    expect(
      validateSSHEnvironmentSettings(
        {
          ...sshSettingsFixture,
          runtime_root: '/srv/redeven',
          release_base_url: 'https://mirror.example.com/releases',
          connect_timeout_seconds: '1.5',
        },
        createDesktopI18n('zh-CN'),
      ),
    ).toEqual({});
  });
});
