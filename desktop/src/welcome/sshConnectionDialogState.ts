export type SSHConnectionDialogStateSnapshot = Readonly<{
  mode: 'create' | 'edit';
  connection_kind: 'external_local_ui' | 'ssh_environment' | 'ssh_host' | 'ssh_container' | 'gateway_ssh_environment' | 'gateway_ssh_container';
  environment_id?: string;
  gateway_id?: string;
  runtime_root?: string;
  release_base_url?: string;
  connect_timeout_seconds?: string | number | null;
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
  const identity = compact(state.environment_id) || compact(state.gateway_id) || 'new';
  return `${state.mode}:${state.connection_kind}:${identity}`;
}

type SSHAdvancedDisclosureSnapshot = Exclude<SSHConnectionDialogStateSnapshot, null> & Readonly<{
  connection_kind: 'ssh_environment' | 'ssh_host' | 'ssh_container';
}>;

function hasSSHAdvancedDisclosure(state: SSHConnectionDialogStateSnapshot): state is SSHAdvancedDisclosureSnapshot {
  return !!state
    && (
      state.connection_kind === 'ssh_environment'
      || state.connection_kind === 'ssh_host'
      || state.connection_kind === 'ssh_container'
      || state.connection_kind === 'gateway_ssh_environment'
      || state.connection_kind === 'gateway_ssh_container'
    );
}

export function defaultSSHConnectionDialogAdvancedOpen(state: SSHConnectionDialogStateSnapshot): boolean {
  if (!hasSSHAdvancedDisclosure(state)) {
    return false;
  }
  return state.mode === 'edit'
    || compact(state.runtime_root) !== ''
    || compact(state.release_base_url) !== ''
    || compact(state.connect_timeout_seconds) !== '';
}

export function syncSSHConnectionDialogAdvancedState(
  current: SSHConnectionDialogAdvancedState,
  state: SSHConnectionDialogStateSnapshot,
): SSHConnectionDialogAdvancedState {
  const stateKey = sshConnectionDialogStateKey(state);
  if (!hasSSHAdvancedDisclosure(state)) {
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
