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
      runtime_root: '',
      release_base_url: '',
    })).toBe('create:ssh_environment:new-ssh');

    expect(sshConnectionDialogStateKey({
      mode: 'create',
      connection_kind: 'ssh_container',
      gateway_id: '',
      runtime_root: '',
      release_base_url: '',
    })).toBe('create:ssh_container:new');
  });

  it('defaults the advanced section open only when existing SSH state needs to stay visible', () => {
    expect(defaultSSHConnectionDialogAdvancedOpen({
      mode: 'create',
      connection_kind: 'ssh_environment',
      environment_id: 'new-ssh',
      runtime_root: '',
      release_base_url: '',
    })).toBe(false);

    expect(defaultSSHConnectionDialogAdvancedOpen({
      mode: 'edit',
      connection_kind: 'ssh_environment',
      environment_id: 'saved-ssh',
      runtime_root: '',
      release_base_url: '',
    })).toBe(true);

    expect(defaultSSHConnectionDialogAdvancedOpen({
      mode: 'create',
      connection_kind: 'ssh_environment',
      environment_id: 'mirror-ssh',
      runtime_root: '',
      release_base_url: 'https://mirror.example.invalid/releases',
    })).toBe(true);

    expect(defaultSSHConnectionDialogAdvancedOpen({
      mode: 'create',
      connection_kind: 'ssh_host',
      gateway_id: 'gateway-1',
      runtime_root: '',
      release_base_url: '',
      connect_timeout_seconds: '',
    })).toBe(false);

    expect(defaultSSHConnectionDialogAdvancedOpen({
      mode: 'create',
      connection_kind: 'ssh_container',
      gateway_id: 'gateway-2',
      runtime_root: '',
      release_base_url: '',
      connect_timeout_seconds: 45,
    })).toBe(true);
  });

  it('keeps the advanced disclosure under user control after initialization', () => {
    const initialized = syncSSHConnectionDialogAdvancedState(
      { open: false, initialized_for_state_key: 'closed' },
      {
        mode: 'create',
        connection_kind: 'ssh_environment',
        environment_id: 'new-ssh',
        runtime_root: '',
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
      runtime_root: '',
      release_base_url: 'https://mirror.example.invalid/releases',
    })).toEqual(userOpened);

    const gatewayInitialized = syncSSHConnectionDialogAdvancedState(
      { open: false, initialized_for_state_key: 'closed' },
      {
        mode: 'create',
        connection_kind: 'ssh_host',
        gateway_id: '',
        runtime_root: '',
        release_base_url: '',
      },
    );

    expect(gatewayInitialized).toEqual({
      open: false,
      initialized_for_state_key: 'create:ssh_host:new',
    });
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
        runtime_root: '',
        release_base_url: '',
      },
    )).toEqual({
      open: true,
      initialized_for_state_key: 'edit:ssh_environment:saved-ssh',
    });
  });
});
