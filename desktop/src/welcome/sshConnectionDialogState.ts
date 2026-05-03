export type SSHConnectionDialogStateSnapshot = Readonly<{
  mode: 'create' | 'edit';
  connection_kind: 'external_local_ui' | 'ssh_environment';
  environment_id: string;
  remote_install_dir?: string;
  release_base_url?: string;
}> | null;

export type SSHConnectionDialogAdvancedState = Readonly<{
  open: boolean;
  initialized_for_state_key: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function sshConnectionDialogStateKey(state: SSHConnectionDialogStateSnapshot): string {
  if (!state) {
    return 'closed';
  }
  return `${state.mode}:${state.connection_kind}:${state.environment_id}`;
}

export function defaultSSHConnectionDialogAdvancedOpen(state: SSHConnectionDialogStateSnapshot): boolean {
  return Boolean(
    state
    && state.connection_kind === 'ssh_environment'
    && (
      state.mode === 'edit'
      || compact(state.remote_install_dir) !== ''
      || compact(state.release_base_url) !== ''
    ),
  );
}

export function syncSSHConnectionDialogAdvancedState(
  current: SSHConnectionDialogAdvancedState,
  state: SSHConnectionDialogStateSnapshot,
): SSHConnectionDialogAdvancedState {
  const stateKey = sshConnectionDialogStateKey(state);
  if (!state || state.connection_kind !== 'ssh_environment') {
    return {
      open: false,
      initialized_for_state_key: stateKey,
    };
  }
  if (current.initialized_for_state_key === stateKey) {
    return current;
  }
  return {
    open: defaultSSHConnectionDialogAdvancedOpen(state),
    initialized_for_state_key: stateKey,
  };
}
