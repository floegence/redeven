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
    })).toBe('create:ssh_environment:new-ssh');
  });

  it('defaults the advanced section open only when existing SSH state needs to stay visible', () => {
    expect(defaultSSHConnectionDialogAdvancedOpen({
      mode: 'create',
      connection_kind: 'ssh_environment',
      environment_id: 'new-ssh',
      remote_install_dir: '',
      release_base_url: '',
    })).toBe(false);

    expect(defaultSSHConnectionDialogAdvancedOpen({
      mode: 'edit',
      connection_kind: 'ssh_environment',
      environment_id: 'saved-ssh',
      remote_install_dir: '',
      release_base_url: '',
    })).toBe(true);

    expect(defaultSSHConnectionDialogAdvancedOpen({
      mode: 'create',
      connection_kind: 'ssh_environment',
      environment_id: 'mirror-ssh',
      remote_install_dir: '',
      release_base_url: 'https://mirror.example.invalid/releases',
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
      },
    );

    expect(initialized).toEqual({
      open: false,
      initialized_for_state_key: 'create:ssh_environment:new-ssh',
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
    })).toEqual(userOpened);
  });

  it('reinitializes advanced visibility only when the dialog identity changes', () => {
    expect(syncSSHConnectionDialogAdvancedState(
      {
        open: true,
        initialized_for_state_key: 'create:ssh_environment:new-ssh',
      },
      {
        mode: 'edit',
        connection_kind: 'ssh_environment',
        environment_id: 'saved-ssh',
        remote_install_dir: '',
        release_base_url: '',
      },
    )).toEqual({
      open: true,
      initialized_for_state_key: 'edit:ssh_environment:saved-ssh',
    });
  });
});
