import type { DesktopSettingsDraft } from './settingsIPC';

export type DesktopPageMode = 'local_environment_settings';
export type DesktopAccessMode = 'local_only' | 'shared_local_network' | 'custom_exposure';
export type DesktopSettingsSummaryTone = 'default' | 'warning' | 'success' | 'primary';

export interface DesktopSettingsSummaryItem {
  id: 'visibility' | 'next_start_address' | 'password_state';
  label: string;
  value: string;
  detail?: string;
  tone?: DesktopSettingsSummaryTone;
}

export interface DesktopPageFieldModel {
  id: string;
  name: keyof DesktopSettingsDraft;
  label: string;
  type?: 'text' | 'password' | 'url';
  autocomplete?: string;
  inputMode?: 'url';
  placeholder?: string;
  helpHTML?: string;
  helpId?: string;
  describedBy?: readonly string[];
  hidden?: boolean;
}

export interface DesktopAccessModeOption {
  value: DesktopAccessMode;
  label: string;
  description: string;
}

export type DesktopSettingsSurfaceSnapshot = Readonly<{
  mode: DesktopPageMode;
  window_title: string;
  save_label: string;
  access_mode: DesktopAccessMode;
  access_mode_label: string;
  access_mode_options: readonly DesktopAccessModeOption[];
  next_start_address_display: string;
  current_runtime_url: string;
  password_state_label: string;
  password_state_tone: 'default' | 'warning' | 'success';
  local_ui_password_configured: boolean;
  runtime_password_required: boolean;
  local_ui_password_can_clear: boolean;
  summary_items: readonly DesktopSettingsSummaryItem[];
  host_fields: readonly DesktopPageFieldModel[];
  draft: DesktopSettingsDraft;
}>;
