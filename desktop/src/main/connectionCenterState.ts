import {
  desktopPreferencesToDraft,
  type DesktopPreferences,
  type DesktopTargetKind,
  type DesktopTargetPreferences,
} from './desktopPreferences';
import { formatBlockedLaunchDiagnostics, type LaunchBlockedReport } from './launchReport';
import { parseLocalUIBind } from './localUIBind';
import type { StartupReport } from './startup';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';

export const DEFAULT_LOCAL_NETWORK_BIND = '0.0.0.0:24000';

export type DesktopSharePreset = 'this_device' | 'local_network' | 'custom';
export type DesktopLinkState = 'idle' | 'pending' | 'connected';
export type DesktopConnectionCenterEntryReason = 'app_launch' | 'switch_device' | 'connect_failed' | 'blocked';

export type DesktopConnectionCenterIssue = Readonly<{
  scope: 'this_device' | 'remote_device' | 'startup';
  code: string;
  title: string;
  message: string;
  diagnostics_copy: string;
  target_url: string;
}>;

export type DesktopRecentDeviceCard = Readonly<{
  local_ui_url: string;
  is_remembered_target: boolean;
  is_active_session: boolean;
}>;

export type DesktopConnectionCenterSnapshot = Readonly<{
  draft: DesktopSettingsDraft;
  entry_reason: DesktopConnectionCenterEntryReason;
  remembered_target_kind: DesktopTargetKind;
  active_session_target_kind: DesktopTargetKind | null;
  active_session_local_ui_url: string;
  cancel_label: 'Quit' | 'Back to current device';
  this_device_local_ui_url: string;
  this_device_share_preset: DesktopSharePreset;
  this_device_link_state: DesktopLinkState;
  recent_devices: readonly DesktopRecentDeviceCard[];
  issue: DesktopConnectionCenterIssue | null;
  advanced_section_open: boolean;
}>;

export type BuildDesktopConnectionCenterSnapshotArgs = Readonly<{
  preferences: DesktopPreferences;
  managedStartup?: StartupReport | null;
  externalStartup?: StartupReport | null;
  activeSessionTarget?: DesktopTargetPreferences | null;
  entryReason?: DesktopConnectionCenterEntryReason;
  issue?: DesktopConnectionCenterIssue | null;
  advancedSectionOpen?: boolean;
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
): DesktopConnectionCenterIssue {
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

export function buildBlockedLaunchIssue(report: LaunchBlockedReport): DesktopConnectionCenterIssue {
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
  activeSessionTarget: DesktopTargetPreferences | null,
): readonly DesktopRecentDeviceCard[] {
  const candidates: string[] = [];
  if (preferences.target.kind === 'external_local_ui' && preferences.target.external_local_ui_url) {
    candidates.push(preferences.target.external_local_ui_url);
  }
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
      is_remembered_target: preferences.target.kind === 'external_local_ui'
        && preferences.target.external_local_ui_url === cleanURL,
      is_active_session: activeSessionTarget?.kind === 'external_local_ui'
        && activeSessionTarget.external_local_ui_url === cleanURL,
    });
  }

  return recentDevices;
}

function activeSessionLocalUIURL(
  activeSessionTarget: DesktopTargetPreferences | null,
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

export function buildDesktopConnectionCenterSnapshot(
  args: BuildDesktopConnectionCenterSnapshotArgs,
): DesktopConnectionCenterSnapshot {
  const preferences = args.preferences;
  const managedStartup = args.managedStartup ?? null;
  const externalStartup = args.externalStartup ?? null;
  const activeSessionTarget = args.activeSessionTarget ?? null;
  const activeRuntimeRemoteEnabled = activeSessionTarget?.kind === 'managed_local'
    ? (typeof managedStartup?.remote_enabled === 'boolean' ? managedStartup.remote_enabled : null)
    : null;

  return {
    draft: desktopPreferencesToDraft(preferences),
    entry_reason: args.entryReason ?? 'app_launch',
    remembered_target_kind: preferences.target.kind,
    active_session_target_kind: activeSessionTarget?.kind ?? null,
    active_session_local_ui_url: activeSessionLocalUIURL(activeSessionTarget, managedStartup, externalStartup),
    cancel_label: activeSessionTarget ? 'Back to current device' : 'Quit',
    this_device_local_ui_url: managedStartup?.local_ui_url ?? '',
    this_device_share_preset: resolveDesktopSharePreset(preferences.local_ui_bind, preferences.local_ui_password),
    this_device_link_state: resolveDesktopLinkState(preferences, activeRuntimeRemoteEnabled),
    recent_devices: buildRecentDevices(preferences, activeSessionTarget),
    issue: args.issue ?? null,
    advanced_section_open: Boolean(args.advancedSectionOpen),
  };
}
