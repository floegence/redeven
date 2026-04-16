import { describe, expect, it } from 'vitest';

import {
  defaultSSHConnectionDialogAdvancedOpen,
  sshConnectionDialogStateKey,
  syncSSHConnectionDialogAdvancedState,
} from './sshConnectionDialogState';

describe('sshConnectionDialogState', () => {
  it('derives a stable initialization key from dialog identity rather than live field edits', () => {
    expect(sshConnectionDialogStateKey({
      mode: 'create',
      connection_kind: 'ssh_environment',
      environment_id: 'new-ssh',
      remote_install_dir: '',
      release_base_url: '',
      environment_instance_id: 'envinst_demo001',
    })).toBe('create:ssh_environment:new-ssh:envinst_demo001');
  });

  it('defaults the advanced section open only when existing SSH state needs to stay visible', () => {
    expect(defaultSSHConnectionDialogAdvancedOpen({
      mode: 'create',
      connection_kind: 'ssh_environment',
      environment_id: 'new-ssh',
      remote_install_dir: '',
      release_base_url: '',
      environment_instance_id: 'envinst_demo001',
    })).toBe(false);

    expect(defaultSSHConnectionDialogAdvancedOpen({
      mode: 'edit',
      connection_kind: 'ssh_environment',
      environment_id: 'saved-ssh',
      remote_install_dir: '',
      release_base_url: '',
      environment_instance_id: 'envinst_demo001',
    })).toBe(true);

    expect(defaultSSHConnectionDialogAdvancedOpen({
      mode: 'create',
      connection_kind: 'ssh_environment',
      environment_id: 'mirror-ssh',
      remote_install_dir: '',
      release_base_url: 'https://mirror.example.invalid/releases',
      environment_instance_id: 'envinst_demo001',
    })).toBe(true);
  });

  it('keeps the advanced disclosure under user control after initialization', () => {
    const initialized = syncSSHConnectionDialogAdvancedState(
      { open: false, initialized_for_state_key: 'closed' },
      {
        mode: 'create',
        connection_kind: 'ssh_environment',
        environment_id: 'new-ssh',
        remote_install_dir: '',
        release_base_url: '',
        environment_instance_id: 'envinst_demo001',
      },
    );

    expect(initialized).toEqual({
      open: false,
      initialized_for_state_key: 'create:ssh_environment:new-ssh:envinst_demo001',
    });

    const userOpened = {
      ...initialized,
      open: true,
    };
    expect(syncSSHConnectionDialogAdvancedState(userOpened, {
      mode: 'create',
      connection_kind: 'ssh_environment',
      environment_id: 'new-ssh',
      remote_install_dir: '',
      release_base_url: 'https://mirror.example.invalid/releases',
      environment_instance_id: 'envinst_demo001',
    })).toEqual(userOpened);
  });

  it('reinitializes advanced visibility only when the dialog identity changes', () => {
    expect(syncSSHConnectionDialogAdvancedState(
      {
        open: true,
        initialized_for_state_key: 'create:ssh_environment:new-ssh:envinst_demo001',
      },
      {
        mode: 'edit',
        connection_kind: 'ssh_environment',
        environment_id: 'saved-ssh',
        remote_install_dir: '',
        release_base_url: '',
        environment_instance_id: 'envinst_demo002',
      },
    )).toEqual({
      open: true,
      initialized_for_state_key: 'edit:ssh_environment:saved-ssh',
    });
  });
});
