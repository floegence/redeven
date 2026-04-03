import type { DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';

export function compactSessionAvailabilityLabel(): string {
  return 'Active';
}

export function compactCloseActionLabel(
  label: DesktopWelcomeSnapshot['close_action_label'],
): string {
  return label === 'Back to current environment' ? 'Back' : label;
}

export function compactOpenLocalEnvironmentLabel(isCurrent: boolean): string {
  return isCurrent ? 'Resume' : 'Open';
}

export function compactSettingsActionLabel(): string {
  return 'Settings';
}

export function compactAddConnectionLabel(): string {
  return 'Add';
}

export function compactSaveActionLabel(): string {
  return 'Save';
}

export function compactClearRequestLabel(): string {
  return 'Clear request';
}

export function compactPasswordStateTagLabel(label: string): string {
  switch (label) {
    case 'No password required':
      return 'No password';
    case 'Password configured':
      return 'Password set';
    case 'Password will be configured on save':
      return 'Set on save';
    case 'Password will be replaced on save':
      return 'Update on save';
    case 'Password will be removed on save':
      return 'Clear on save';
    case 'Password required before the next open of Local Environment':
      return 'Password needed';
    case 'Password optional':
      return 'Optional';
    default:
      return label;
  }
}

export function compactBootstrapStatusTagLabel(label: string): string {
  switch (label) {
    case 'Registration queued for next start':
      return 'Queued';
    case 'No bootstrap request queued':
      return 'No request';
    default:
      return label;
  }
}
