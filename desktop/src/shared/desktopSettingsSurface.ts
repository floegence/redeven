import type { DesktopSettingsDraft } from './settingsIPC';

export type DesktopPageMode = 'advanced_settings';
export type DesktopAccessMode = 'private_device' | 'shared_local_network' | 'custom_exposure';
export type DesktopSettingsSummaryTone = 'default' | 'warning' | 'success' | 'primary';

export interface DesktopSettingsSummaryItem {
  id: 'access_mode' | 'bind_address' | 'password_state' | 'next_start';
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
  access_bind_display: string;
  password_state_label: string;
  password_state_tone: 'default' | 'warning' | 'success';
  bootstrap_pending: boolean;
  bootstrap_status_label: string;
  summary_items: readonly DesktopSettingsSummaryItem[];
  host_fields: readonly DesktopPageFieldModel[];
  bootstrap_fields: readonly DesktopPageFieldModel[];
  draft: DesktopSettingsDraft;
}>;
