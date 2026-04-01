import { formatBlockedLaunchDiagnostics, type LaunchBlockedReport } from './launchReport';
import { parseLocalUIBind } from './localUIBind';
import type { DesktopPreferences } from './desktopPreferences';
import type { DesktopSessionTarget } from './desktopTarget';
import type { StartupReport } from './startup';
import {
  type DesktopLinkState,
  type DesktopRecentDeviceCard,
  type DesktopSharePreset,
  type DesktopWelcomeEntryReason,
  type DesktopWelcomeIssue,
  type DesktopWelcomeSnapshot,
} from '../shared/desktopLauncherIPC';

export const DEFAULT_LOCAL_NETWORK_BIND = '0.0.0.0:24000';

export type BuildDesktopWelcomeSnapshotArgs = Readonly<{
  preferences: DesktopPreferences;
  managedStartup?: StartupReport | null;
  externalStartup?: StartupReport | null;
  activeSessionTarget?: DesktopSessionTarget | null;
  entryReason?: DesktopWelcomeEntryReason;
  issue?: DesktopWelcomeIssue | null;
}>;

function isThisDevicePreset(bindRaw: string, passwordRaw: string): boolean {
  const password = String(passwordRaw ?? '').trim();
  if (password !== '') {
    return false;
  }
  try {
    const bind = parseLocalUIBind(bindRaw);
    return bind.loopback && bind.port === 0;
  } catch {
    return false;
  }
}

function isLocalNetworkPreset(bindRaw: string, passwordRaw: string): boolean {
  const password = String(passwordRaw ?? '').trim();
  if (password === '') {
    return false;
  }
  try {
    const bind = parseLocalUIBind(bindRaw);
    return !bind.loopback && bind.port === 24000;
  } catch {
    return false;
  }
}

export function resolveDesktopSharePreset(bindRaw: string, passwordRaw: string): DesktopSharePreset {
  if (isThisDevicePreset(bindRaw, passwordRaw)) {
    return 'this_device';
  }
  if (isLocalNetworkPreset(bindRaw, passwordRaw)) {
    return 'local_network';
  }
  return 'custom';
}

export function resolveDesktopLinkState(
  preferences: DesktopPreferences,
  activeRuntimeRemoteEnabled: boolean | null,
): DesktopLinkState {
  if (preferences.pending_bootstrap) {
    return 'pending';
  }
  if (activeRuntimeRemoteEnabled === true) {
    return 'connected';
  }
  return 'idle';
}

function diagnosticsLines(lines: readonly string[]): string {
  return lines.filter((value) => String(value ?? '').trim() !== '').join('\n');
}

export function buildRemoteConnectionIssue(
  targetURL: string,
  code: string,
  message: string,
): DesktopWelcomeIssue {
  return {
    scope: 'remote_device',
    code,
    title: code === 'external_target_invalid' ? 'Check the Redeven URL' : 'Unable to open that device',
    message,
    diagnostics_copy: diagnosticsLines([
      'status: blocked',
      `code: ${code}`,
      `message: ${message}`,
      `target url: ${targetURL}`,
    ]),
    target_url: targetURL,
  };
}

export function buildBlockedLaunchIssue(report: LaunchBlockedReport): DesktopWelcomeIssue {
  if (report.code === 'state_dir_locked') {
    if (report.lock_owner?.local_ui_enabled === true) {
      return {
        scope: 'this_device',
        code: report.code,
        title: 'Redeven is already starting elsewhere',
        message: 'Another Redeven runtime instance is using the default state directory and appears to provide Local UI. Retry in a moment so Desktop can attach to it.',
        diagnostics_copy: formatBlockedLaunchDiagnostics(report),
        target_url: '',
      };
    }
    return {
      scope: 'this_device',
      code: report.code,
      title: 'Redeven is already running',
      message: 'Another Redeven runtime instance is using the default state directory without an attachable Local UI. Stop that runtime or restart it in a Local UI mode, then try again.',
      diagnostics_copy: formatBlockedLaunchDiagnostics(report),
      target_url: '',
    };
  }

  return {
    scope: 'this_device',
    code: report.code,
    title: 'This device needs attention',
    message: report.message,
    diagnostics_copy: formatBlockedLaunchDiagnostics(report),
    target_url: '',
  };
}

function buildRecentDevices(
  preferences: DesktopPreferences,
  activeSessionTarget: DesktopSessionTarget | null,
): readonly DesktopRecentDeviceCard[] {
  const candidates: string[] = [];
  if (activeSessionTarget?.kind === 'external_local_ui' && activeSessionTarget.external_local_ui_url) {
    candidates.push(activeSessionTarget.external_local_ui_url);
  }
  candidates.push(...preferences.recent_external_local_ui_urls);

  const seen = new Set<string>();
  const recentDevices: DesktopRecentDeviceCard[] = [];
  for (const localUIURL of candidates) {
    const cleanURL = String(localUIURL ?? '').trim();
    if (!cleanURL || seen.has(cleanURL)) {
      continue;
    }
    seen.add(cleanURL);
    recentDevices.push({
      local_ui_url: cleanURL,
      is_active_session: activeSessionTarget?.kind === 'external_local_ui'
        && activeSessionTarget.external_local_ui_url === cleanURL,
    });
  }

  return recentDevices;
}

function activeSessionLocalUIURL(
  activeSessionTarget: DesktopSessionTarget | null,
  managedStartup: StartupReport | null,
  externalStartup: StartupReport | null,
): string {
  if (!activeSessionTarget) {
    return '';
  }
  if (activeSessionTarget.kind === 'external_local_ui') {
    return externalStartup?.local_ui_url ?? activeSessionTarget.external_local_ui_url;
  }
  return managedStartup?.local_ui_url ?? '';
}

function currentSessionLabel(activeSessionTarget: DesktopSessionTarget | null): string {
  if (!activeSessionTarget) {
    return 'No device opened';
  }
  return activeSessionTarget.kind === 'managed_local' ? 'This device is open' : 'Another device is open';
}

function currentSessionDescription(
  activeSessionTarget: DesktopSessionTarget | null,
  managedStartup: StartupReport | null,
  externalStartup: StartupReport | null,
): string {
  if (!activeSessionTarget) {
    return 'Choose a machine to open in this Desktop session.';
  }
  if (activeSessionTarget.kind === 'managed_local') {
    return managedStartup?.local_ui_url
      ? `Current session: ${managedStartup.local_ui_url}`
      : 'Desktop is currently attached to This Device.';
  }
  return externalStartup?.local_ui_url
    ? `Current session: ${externalStartup.local_ui_url}`
    : 'Desktop is currently attached to another Redeven device.';
}

function thisDeviceShareLabel(snapshot: DesktopSharePreset): string {
  switch (snapshot) {
    case 'local_network':
      return 'Shared on your local network';
    case 'custom':
      return 'Custom exposure';
    default:
      return 'Private to this device';
  }
}

function thisDeviceShareDescription(
  snapshot: DesktopSharePreset,
  managedStartup: StartupReport | null,
): string {
  switch (snapshot) {
    case 'local_network':
      return managedStartup?.local_ui_url
        ? `This device can be opened from another trusted machine through ${managedStartup.local_ui_url}.`
        : `Desktop will expose This Device on ${DEFAULT_LOCAL_NETWORK_BIND} with an access password.`;
    case 'custom':
      return 'This device uses a custom Local UI bind or password configuration.';
    default:
      return 'Desktop keeps This Device on a loopback-only Local UI bind until you choose to share it.';
  }
}

function thisDeviceLinkLabel(linkState: DesktopLinkState): string {
  switch (linkState) {
    case 'pending':
      return 'Queued for next start';
    case 'connected':
      return 'Remote control connected';
    default:
      return 'No queued request';
  }
}

function thisDeviceLinkDescription(linkState: DesktopLinkState): string {
  switch (linkState) {
    case 'pending':
      return 'Desktop already has a saved one-shot Redeven link request for the next successful This Device start.';
    case 'connected':
      return 'This device is currently running with a valid remote control channel.';
    default:
      return 'Add a one-shot Redeven link request only when you need the next This Device start to register itself remotely.';
  }
}

function suggestedRemoteURL(
  issue: DesktopWelcomeIssue | null,
  activeSessionTarget: DesktopSessionTarget | null,
  recentDevices: readonly DesktopRecentDeviceCard[],
): string {
  if (issue?.scope === 'remote_device' && issue.target_url) {
    return issue.target_url;
  }
  if (activeSessionTarget?.kind === 'external_local_ui' && activeSessionTarget.external_local_ui_url) {
    return activeSessionTarget.external_local_ui_url;
  }
  return recentDevices[0]?.local_ui_url ?? '';
}

export function buildDesktopWelcomeSnapshot(
  args: BuildDesktopWelcomeSnapshotArgs,
): DesktopWelcomeSnapshot {
  const preferences = args.preferences;
  const managedStartup = args.managedStartup ?? null;
  const externalStartup = args.externalStartup ?? null;
  const activeSessionTarget = args.activeSessionTarget ?? null;
  const activeRuntimeRemoteEnabled = activeSessionTarget?.kind === 'managed_local'
    ? (typeof managedStartup?.remote_enabled === 'boolean' ? managedStartup.remote_enabled : null)
    : null;
  const recentDevices = buildRecentDevices(preferences, activeSessionTarget);
  const sharePreset = resolveDesktopSharePreset(preferences.local_ui_bind, preferences.local_ui_password);
  const linkState = resolveDesktopLinkState(preferences, activeRuntimeRemoteEnabled);
  const issue = args.issue ?? null;

  return {
    entry_reason: args.entryReason ?? 'app_launch',
    current_session_target_kind: activeSessionTarget?.kind ?? null,
    current_session_local_ui_url: activeSessionLocalUIURL(activeSessionTarget, managedStartup, externalStartup),
    current_session_label: currentSessionLabel(activeSessionTarget),
    current_session_description: currentSessionDescription(activeSessionTarget, managedStartup, externalStartup),
    close_action_label: activeSessionTarget ? 'Back to current device' : 'Quit',
    this_device_local_ui_url: managedStartup?.local_ui_url ?? '',
    this_device_share_preset: sharePreset,
    this_device_share_label: thisDeviceShareLabel(sharePreset),
    this_device_share_description: thisDeviceShareDescription(sharePreset, managedStartup),
    this_device_link_state: linkState,
    this_device_link_label: thisDeviceLinkLabel(linkState),
    this_device_link_description: thisDeviceLinkDescription(linkState),
    recent_devices: recentDevices,
    suggested_remote_url: suggestedRemoteURL(issue, activeSessionTarget, recentDevices),
    issue,
  };
}
