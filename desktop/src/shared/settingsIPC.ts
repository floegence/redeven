export const SAVE_DESKTOP_SETTINGS_CHANNEL = 'redeven-desktop:save-settings';
export const CANCEL_DESKTOP_SETTINGS_CHANNEL = 'redeven-desktop:cancel-settings';

export type DesktopLocalUIPasswordMode = 'keep' | 'replace' | 'clear';

export function normalizeDesktopLocalUIPasswordMode(
  value: unknown,
  fallback: DesktopLocalUIPasswordMode = 'replace',
): DesktopLocalUIPasswordMode {
  return value === 'keep' || value === 'replace' || value === 'clear' ? value : fallback;
}

export type DesktopSettingsDraft = Readonly<{
  local_ui_bind: string;
  local_ui_password: string;
  local_ui_password_mode: DesktopLocalUIPasswordMode;
}>;

export type SaveDesktopSettingsResult = Readonly<
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    }
>;
