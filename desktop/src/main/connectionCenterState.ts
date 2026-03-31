import {
  desktopPreferencesToDraft,
  type DesktopPreferences,
  type DesktopTargetKind,
} from './desktopPreferences';
import { parseLocalUIBind } from './localUIBind';
import type { StartupReport } from './startup';
import type { DesktopSettingsDraft } from '../shared/settingsIPC';

export const DEFAULT_LOCAL_NETWORK_BIND = '0.0.0.0:24000';

export type DesktopSharePreset = 'this_device' | 'local_network' | 'custom';
export type DesktopLinkState = 'idle' | 'pending' | 'connected';

export type DesktopConnectionCenterSnapshot = Readonly<{
  draft: DesktopSettingsDraft;
  current_target_kind: DesktopTargetKind;
  current_local_ui_url: string;
  active_runtime_remote_enabled: boolean | null;
  share_preset: DesktopSharePreset;
  link_state: DesktopLinkState;
  recent_external_local_ui_urls: readonly string[];
}>;

export type BuildDesktopConnectionCenterSnapshotArgs = Readonly<{
  preferences: DesktopPreferences;
  managedStartup?: StartupReport | null;
  externalStartup?: StartupReport | null;
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

export function buildDesktopConnectionCenterSnapshot(
  args: BuildDesktopConnectionCenterSnapshotArgs,
): DesktopConnectionCenterSnapshot {
  const preferences = args.preferences;
  const activeStartup = preferences.target.kind === 'external_local_ui'
    ? args.externalStartup ?? null
    : args.managedStartup ?? null;
  const activeRuntimeRemoteEnabled = preferences.target.kind === 'managed_local'
    ? (typeof args.managedStartup?.remote_enabled === 'boolean' ? args.managedStartup.remote_enabled : null)
    : null;

  return {
    draft: desktopPreferencesToDraft(preferences),
    current_target_kind: preferences.target.kind,
    current_local_ui_url: activeStartup?.local_ui_url ?? '',
    active_runtime_remote_enabled: activeRuntimeRemoteEnabled,
    share_preset: resolveDesktopSharePreset(preferences.local_ui_bind, preferences.local_ui_password),
    link_state: resolveDesktopLinkState(preferences, activeRuntimeRemoteEnabled),
    recent_external_local_ui_urls: preferences.recent_external_local_ui_urls,
  };
}
