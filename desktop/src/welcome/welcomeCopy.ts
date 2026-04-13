import type { DesktopAccessMode } from '../shared/desktopSettingsSurface';
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

export function plainTextFromHelpHTML(html: string): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

export type AccessModeVisual = Readonly<{
  short_label: string;
  tone: 'neutral' | 'primary' | 'warning';
  description: string;
}>;

export function accessModeVisual(mode: DesktopAccessMode): AccessModeVisual {
  switch (mode) {
    case 'shared_local_network':
      return {
        short_label: 'LAN',
        tone: 'primary',
        description: 'Shared on your local network',
      };
    case 'custom_exposure':
      return {
        short_label: 'Custom',
        tone: 'warning',
        description: 'Custom bind and password',
      };
    default:
      return {
        short_label: 'Local',
        tone: 'neutral',
        description: 'Only this machine',
      };
  }
}

export type PasswordVisualTone = 'success' | 'warning' | 'neutral';

export function passwordStateVisualTone(tone: 'default' | 'warning' | 'success'): PasswordVisualTone {
  switch (tone) {
    case 'success':
      return 'success';
    case 'warning':
      return 'warning';
    default:
      return 'neutral';
  }
}

export type AddressDisplay = Readonly<{
  primary: string;
  primary_monospace: boolean;
  hint: string;
}>;

/**
 * Interpret a next-start address display string into a rendering-friendly shape.
 *
 * The shared model emits several value shapes:
 *   - `localhost:23998`            → pure address, monospace
 *   - `0.0.0.0:24000`              → pure address, monospace
 *   - `Auto-select on localhost`   → sentence, regular font
 *   - `Your device IP:24000`       → mixed sentence, split into port + hint
 */
export function describeNextStartAddress(value: string): AddressDisplay {
  const raw = String(value ?? '').trim();
  if (raw === '') {
    return { primary: '', primary_monospace: false, hint: '' };
  }
  if (raw === 'Auto-select on localhost') {
    return { primary: 'Auto port', primary_monospace: false, hint: 'on localhost' };
  }
  const deviceIPMatch = raw.match(/^Your device IP:(\d+)$/);
  if (deviceIPMatch) {
    return { primary: `Port ${deviceIPMatch[1]}`, primary_monospace: false, hint: 'on your LAN IP' };
  }
  if (/\s/.test(raw)) {
    return { primary: raw, primary_monospace: false, hint: '' };
  }
  return { primary: raw, primary_monospace: true, hint: '' };
}

export function describeRuntimeAddress(url: string): AddressDisplay {
  const raw = String(url ?? '').trim();
  if (raw === '') {
    return { primary: 'Not running', primary_monospace: false, hint: '' };
  }
  if (/\s/.test(raw)) {
    return { primary: raw, primary_monospace: false, hint: '' };
  }
  return { primary: raw, primary_monospace: true, hint: '' };
}
