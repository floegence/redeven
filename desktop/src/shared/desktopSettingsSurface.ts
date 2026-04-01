import type { DesktopSettingsDraft } from './settingsIPC';

export type DesktopPageMode = 'advanced_settings';
export type DesktopStatusTone = 'local';

export interface DesktopSummaryItem {
  label: string;
  value: string;
  body: string;
  valueId?: string;
  bodyId?: string;
}

export interface DesktopPageAlertModel {
  kicker: string;
  title: string;
  body: string;
  bodyId?: string;
  tone?: 'info' | 'default';
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

export interface DesktopPageCardModel {
  id: string;
  kicker: string;
  title: string;
  descriptionHTML: string;
  badge?: string;
  stateNote?: Readonly<{
    id: string;
    text: string;
  }>;
  fields: readonly DesktopPageFieldModel[];
}

export interface DesktopPageSectionModel {
  id: string;
  title: string;
  cards: readonly DesktopPageCardModel[];
}

export type DesktopSettingsSurfaceSnapshot = Readonly<{
  mode: DesktopPageMode;
  window_title: string;
  lead: string;
  status_label: string;
  status_tone: DesktopStatusTone;
  save_label: string;
  summary_items: readonly DesktopSummaryItem[];
  alert: DesktopPageAlertModel;
  sections: readonly DesktopPageSectionModel[];
  draft: DesktopSettingsDraft;
}>;
