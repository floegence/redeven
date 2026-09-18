import type { DesktopSettingsSurfaceSnapshot } from './desktopSettingsSurface';
import type { DesktopOperationFailurePresentation } from './desktopOperationFailure';

export const LOAD_DESKTOP_SETTINGS_CHANNEL = 'redeven-desktop:load-settings';
export const SAVE_DESKTOP_SETTINGS_CHANNEL = 'redeven-desktop:save-settings';
export const CANCEL_DESKTOP_SETTINGS_CHANNEL = 'redeven-desktop:cancel-settings';

export type LocalUIProtocol = 'http' | 'https';

export function parseLocalUIProtocol(value: unknown): LocalUIProtocol {
  if (value === undefined) return 'http';
  if (value !== 'http' && value !== 'https') throw new Error('Choose HTTP or HTTPS for this environment.');
  return value;
}

export type DesktopLocalUIPasswordMode = 'keep' | 'replace' | 'clear';

export function normalizeDesktopLocalUIPasswordMode(
  value: unknown,
  fallback: DesktopLocalUIPasswordMode = 'replace',
): DesktopLocalUIPasswordMode {
  return value === 'keep' || value === 'replace' || value === 'clear' ? value : fallback;
}

export type DesktopSettingsDraft = Readonly<{
  local_ui_bind: string;
  local_ui_protocol?: LocalUIProtocol;
  local_ui_password: string;
  local_ui_password_mode: DesktopLocalUIPasswordMode;
  auto_runtime_probe_enabled: boolean;
}>;

export type DesktopSettingsRequest = Readonly<{ environment_id: string }>;
export type SaveDesktopSettingsRequest = DesktopSettingsRequest & Readonly<{ draft: DesktopSettingsDraft }>;
export type DesktopSettingsResult = Readonly<
  | { ok: true; snapshot: DesktopSettingsSurfaceSnapshot }
  | { ok: false; error: string; code?: string; status_code?: number; failure?: DesktopOperationFailurePresentation }
>;
export type SaveDesktopSettingsResult = DesktopSettingsResult;

export function parseDesktopSettingsRequest(value: unknown): DesktopSettingsRequest {
  const id = (value as Partial<DesktopSettingsRequest> | null)?.environment_id;
  if (typeof id !== 'string' || !id.trim()) throw new Error('Choose an Environment to manage.');
  return { environment_id: id.trim() };
}
