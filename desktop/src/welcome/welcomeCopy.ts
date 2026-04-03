import type { DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';

export function compactCloseActionLabel(
  label: DesktopWelcomeSnapshot['close_action_label'],
): string {
  return label;
}

export function compactOpenLocalEnvironmentLabel(isOpen: boolean): string {
  return isOpen ? 'Focus' : 'Open';
}

export function compactSettingsActionLabel(): string {
  return 'Settings';
}

export function compactSettingsFieldLabel(label: string): string {
  switch (label) {
    case 'Local UI bind address':
      return 'Bind address';
    case 'Local UI password':
      return 'Password';
    case 'Control plane URL':
      return 'Control plane';
    case 'Environment ID':
      return 'Env ID';
    case 'Environment token':
      return 'Env token';
    default:
      return label;
  }
}

export function isRedundantSettingsFieldLabel(label: string, sectionTitle?: string): boolean {
  const normalizedSectionTitle = String(sectionTitle ?? '').trim();
  if (normalizedSectionTitle === '') {
    return false;
  }
  return compactSettingsFieldLabel(label) === normalizedSectionTitle;
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

export function plainTextFromHelpHTML(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}
