import {
  DEFAULT_DESKTOP_SSH_RUNTIME_ROOT,
  normalizeDesktopSSHConnectTimeoutSeconds,
  normalizeDesktopSSHDestination,
  normalizeDesktopSSHPort,
  normalizeDesktopSSHReleaseBaseURL,
  normalizeDesktopSSHRuntimeRoot,
  type DesktopSSHAuthMode,
  type DesktopSSHBootstrapStrategy,
} from '../shared/desktopSSH';
import type { DesktopI18n, DesktopTranslationKey } from '../shared/i18n';

export type SSHConnectionDialogState = Readonly<{
  mode: 'create' | 'edit';
  connection_kind: 'ssh_environment';
  environment_id: string;
  label: string;
  ssh_destination: string;
  ssh_port: string;
  auth_mode: DesktopSSHAuthMode;
  ssh_password: string;
  ssh_password_mode: 'keep' | 'replace' | 'clear';
  ssh_password_configured: boolean;
  baseline_ssh_destination: string;
  baseline_ssh_port: string;
  baseline_auth_mode: DesktopSSHAuthMode;
  runtime_root: string;
  bootstrap_strategy: DesktopSSHBootstrapStrategy;
  release_base_url: string;
  connect_timeout_seconds: string;
  auto_runtime_probe_enabled: boolean;
}>;

const editableFields = [
  'label',
  'ssh_destination',
  'ssh_port',
  'auth_mode',
  'ssh_password',
  'ssh_password_mode',
  'runtime_root',
  'bootstrap_strategy',
  'release_base_url',
  'connect_timeout_seconds',
  'auto_runtime_probe_enabled',
] as const;

export function sshEnvironmentSettingsDirty(
  baseline: SSHConnectionDialogState,
  draft: SSHConnectionDialogState,
): boolean {
  return editableFields.some((field) => baseline[field] !== draft[field]);
}

export function sshEnvironmentRootIsDefault(root: string): boolean {
  try {
    return normalizeDesktopSSHRuntimeRoot(root) === DEFAULT_DESKTOP_SSH_RUNTIME_ROOT;
  } catch {
    return false;
  }
}

export function validateSSHEnvironmentSettings(
  state: SSHConnectionDialogState,
  i18n: DesktopI18n,
): Partial<Record<string, string>> {
  const errors: Partial<Record<string, string>> = {};
  if (!state.label.trim()) errors.label = i18n.t('connectionDialog.validationNameRequired');
  const checks: ReadonlyArray<readonly [string, () => unknown, DesktopTranslationKey]> = [
    ['ssh_destination', () => normalizeDesktopSSHDestination(state.ssh_destination), 'sshSettings.invalidDestination'],
    ['ssh_port', () => normalizeDesktopSSHPort(state.ssh_port), 'connectionDialog.validationPortRange'],
    ['runtime_root', () => normalizeDesktopSSHRuntimeRoot(state.runtime_root), 'sshSettings.invalidRoot'],
    [
      'release_base_url',
      () => normalizeDesktopSSHReleaseBaseURL(state.release_base_url),
      'sshSettings.invalidReleaseUrl',
    ],
    [
      'connect_timeout_seconds',
      () => normalizeDesktopSSHConnectTimeoutSeconds(state.connect_timeout_seconds),
      'sshSettings.invalidTimeout',
    ],
  ];
  for (const [field, check, key] of checks) {
    try {
      check();
    } catch {
      errors[field] = i18n.t(key);
    }
  }
  return errors;
}
