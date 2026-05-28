import type { DesktopSettingsDraft } from './settingsIPC';
import type { DesktopTranslationKey } from './i18n/desktopI18n';

export type DesktopPageMode = 'environment_settings';
export type DesktopAccessMode = 'local_only' | 'shared_local_network' | 'custom_exposure';
export type DesktopSettingsSummaryTone = 'default' | 'warning' | 'success' | 'primary';
export type DesktopPasswordStateID =
  | 'not_required'
  | 'configured'
  | 'set_on_save'
  | 'replace_on_save'
  | 'clear_on_save'
  | 'required'
  | 'optional';
export type DesktopNextStartAddressKind = 'raw' | 'auto_loopback' | 'lan_ip_port';

export interface DesktopSettingsSummaryItem {
  id: 'visibility' | 'next_start_address' | 'password_state';
  label_key: DesktopTranslationKey;
  value_key?: DesktopTranslationKey;
  value: string;
  detail_key?: DesktopTranslationKey;
  tone?: DesktopSettingsSummaryTone;
}

export interface DesktopPageFieldModel {
  id: string;
  name: keyof DesktopSettingsDraft;
  label_key: DesktopTranslationKey;
  type?: 'text' | 'password' | 'url';
  autocomplete?: string;
  inputMode?: 'url';
  placeholder_key?: DesktopTranslationKey;
  help_key?: DesktopTranslationKey;
  helpId?: string;
  describedBy?: readonly string[];
  hidden?: boolean;
}

export interface DesktopAccessModeOption {
  value: DesktopAccessMode;
  label_key: DesktopTranslationKey;
  description_key: DesktopTranslationKey;
}

export type DesktopSettingsSurfaceSnapshot = Readonly<{
  mode: DesktopPageMode;
  environment_id: string;
  environment_label: string;
  environment_kind: 'local' | 'controlplane';
  window_title_key: DesktopTranslationKey;
  save_label_key: DesktopTranslationKey;
  access_mode: DesktopAccessMode;
  access_mode_label_key: DesktopTranslationKey;
  access_mode_options: readonly DesktopAccessModeOption[];
  next_start_address_display: string;
  next_start_address_kind: DesktopNextStartAddressKind;
  current_runtime_url: string;
  password_state_id: DesktopPasswordStateID;
  password_state_tone: 'default' | 'warning' | 'success';
  local_ui_password_configured: boolean;
  runtime_password_required: boolean;
  local_ui_password_can_clear: boolean;
  auto_runtime_probe_configurable: boolean;
  summary_items: readonly DesktopSettingsSummaryItem[];
  host_fields: readonly DesktopPageFieldModel[];
  draft: DesktopSettingsDraft;
}>;
