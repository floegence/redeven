export const SAVE_DESKTOP_SETTINGS_CHANNEL = 'redeven-desktop:save-settings';
export const CANCEL_DESKTOP_SETTINGS_CHANNEL = 'redeven-desktop:cancel-settings';

export type DesktopSettingsDraft = Readonly<{
  local_ui_bind: string;
  local_ui_password: string;
  controlplane_url: string;
  env_id: string;
  env_token: string;
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
