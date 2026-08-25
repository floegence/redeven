export const DESKTOP_UPDATE_GET_SNAPSHOT_CHANNEL = 'redeven-desktop:update-get-snapshot';
export const DESKTOP_UPDATE_PERFORM_ACTION_CHANNEL = 'redeven-desktop:update-perform-action';
export const DESKTOP_UPDATE_SNAPSHOT_UPDATED_CHANNEL = 'redeven-desktop:update-snapshot-updated';
export const DESKTOP_UPDATE_OPEN_REQUESTED_CHANNEL = 'redeven-desktop:update-open-requested';

export type DesktopUpdatePlatform = 'macos_sparkle' | 'linux_package' | 'unsupported';

export type DesktopUpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'blocked'
  | 'error';

export type DesktopUpdateCapability =
  | 'check'
  | 'open_update_ui'
  | 'automatic_checks'
  | 'download'
  | 'cancel_download'
  | 'install'
  | 'reveal_application'
  | 'open_applications_folder'
  | 'open_release_page';

export type DesktopUpdateSnapshot = Readonly<{
  platform: DesktopUpdatePlatform;
  state: DesktopUpdateState;
  current_version: string;
  available_version?: string;
  download_percent?: number;
  automatically_checks_for_updates: boolean;
  capabilities: readonly DesktopUpdateCapability[];
  message_key?: string;
  error_detail?: string;
}>;

export type DesktopUpdateAction =
  | Readonly<{ kind: 'check_for_updates' }>
  | Readonly<{ kind: 'open_update_ui' }>
  | Readonly<{ kind: 'set_automatic_checks'; enabled: boolean }>
  | Readonly<{ kind: 'download_update' }>
  | Readonly<{ kind: 'cancel_download' }>
  | Readonly<{ kind: 'install_update' }>
  | Readonly<{ kind: 'reveal_application' }>
  | Readonly<{ kind: 'open_applications_folder' }>
  | Readonly<{ kind: 'open_release_page' }>;

export type DesktopUpdateActionResponse = Readonly<{
  ok: boolean;
  snapshot: DesktopUpdateSnapshot;
  message?: string;
}>;

const UPDATE_STATES = new Set<DesktopUpdateState>([
  'idle',
  'checking',
  'available',
  'downloading',
  'ready',
  'installing',
  'blocked',
  'error',
]);

const UPDATE_PLATFORMS = new Set<DesktopUpdatePlatform>([
  'macos_sparkle',
  'linux_package',
  'unsupported',
]);

const UPDATE_CAPABILITIES = new Set<DesktopUpdateCapability>([
  'check',
  'open_update_ui',
  'automatic_checks',
  'download',
  'cancel_download',
  'install',
  'reveal_application',
  'open_applications_folder',
  'open_release_page',
]);

function compact(value: unknown): string {
  return String(value ?? '').trim();
}
function normalizePercent(value: unknown): number | undefined {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return undefined;
  }
  return Math.min(100, Math.max(0, number));
}

export function unsupportedDesktopUpdateSnapshot(currentVersion = ''): DesktopUpdateSnapshot {
  return {
    platform: 'unsupported',
    state: 'blocked',
    current_version: compact(currentVersion),
    automatically_checks_for_updates: false,
    capabilities: ['open_release_page'],
    message_key: 'desktopUpdate.unsupportedBuild',
  };
}

export function normalizeDesktopUpdateSnapshot(
  value: unknown,
  fallback: DesktopUpdateSnapshot = unsupportedDesktopUpdateSnapshot(),
): DesktopUpdateSnapshot {
  if (!value || typeof value !== 'object') {
    return fallback;
  }
  const candidate = value as Partial<DesktopUpdateSnapshot>;
  const platform = UPDATE_PLATFORMS.has(candidate.platform as DesktopUpdatePlatform)
    ? candidate.platform as DesktopUpdatePlatform
    : fallback.platform;
  const state = UPDATE_STATES.has(candidate.state as DesktopUpdateState)
    ? candidate.state as DesktopUpdateState
    : fallback.state;
  const capabilities = Array.isArray(candidate.capabilities)
    ? [...new Set(candidate.capabilities.filter((item): item is DesktopUpdateCapability => (
        UPDATE_CAPABILITIES.has(item as DesktopUpdateCapability)
      )))]
    : [...fallback.capabilities];
  const percent = normalizePercent(candidate.download_percent);
  const availableVersion = compact(candidate.available_version);
  const messageKey = compact(candidate.message_key);
  const errorDetail = compact(candidate.error_detail);
  return {
    platform,
    state,
    current_version: compact(candidate.current_version) || fallback.current_version,
    ...(availableVersion ? { available_version: availableVersion } : {}),
    ...(percent !== undefined ? { download_percent: percent } : {}),
    automatically_checks_for_updates: candidate.automatically_checks_for_updates === true,
    capabilities,
    ...(messageKey ? { message_key: messageKey } : {}),
    ...(errorDetail ? { error_detail: errorDetail } : {}),
  };
}

export function normalizeDesktopUpdateAction(value: unknown): DesktopUpdateAction | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<DesktopUpdateAction>;
  switch (candidate.kind) {
    case 'check_for_updates':
    case 'open_update_ui':
    case 'download_update':
    case 'cancel_download':
    case 'install_update':
    case 'reveal_application':
    case 'open_applications_folder':
    case 'open_release_page':
      return { kind: candidate.kind };
    case 'set_automatic_checks':
      return { kind: candidate.kind, enabled: candidate.enabled === true };
    default:
      return null;
  }
}
