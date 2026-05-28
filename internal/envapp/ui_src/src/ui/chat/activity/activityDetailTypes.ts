import type { TranslationParams } from '../../i18n/dictionaryTypes';
import type { EnvAppTranslationKey } from '../../i18n/locales';

export type ActivityDetailStatus = 'pending' | 'running' | 'success' | 'error' | 'waiting' | 'info';

export type ActivityDetailTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

export interface ActivityDetailLocalizedText {
  label?: string;
  labelKey?: EnvAppTranslationKey;
  labelParams?: TranslationParams;
  labelCount?: number;
}

export interface ActivityDetailChip {
  label?: string;
  labelKey?: EnvAppTranslationKey;
  labelParams?: TranslationParams;
  labelCount?: number;
  value?: string;
  valueKey?: EnvAppTranslationKey;
  valueParams?: TranslationParams;
  valueCount?: number;
  tone?: ActivityDetailTone;
}

export interface ActivityDetailPresentation {
  detailId: string;
  title?: string;
  titleKey?: EnvAppTranslationKey;
  titleParams?: TranslationParams;
  subtitle?: string;
  status: ActivityDetailStatus;
  toolName?: string;
  startedAtUnixMs?: number;
  endedAtUnixMs?: number;
  durationMs?: number;
  chips: ActivityDetailChip[];
  sections: ActivityDetailSection[];
  copyTargets: ActivityDetailCopyTarget[];
}

export type ActivityDetailSection =
  | TerminalDetailSection
  | TodoDetailSection
  | FileChangeDetailSection
  | FileContentSection
  | WebDetailSection
  | ErrorDetailSection
  | StructuredFieldsSection;

export interface TerminalDetailSection {
  kind: 'terminal';
  command?: string;
  cwd?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  truncated?: boolean;
  timeoutMs?: number;
}

export interface TodoDetailSection {
  kind: 'todo_delta';
  title?: string;
  titleKey?: EnvAppTranslationKey;
  items: Array<{
    id?: string;
    content?: string;
    contentKey?: EnvAppTranslationKey;
    beforeStatus?: TodoDetailStatus;
    afterStatus: TodoDetailStatus;
    note?: string;
  }>;
}

export type TodoDetailStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';

export interface FileChangeDetailSection {
  kind: 'file_change';
  files: Array<{
    path: string;
    operation: 'created' | 'updated' | 'deleted' | 'renamed' | 'read' | 'unknown';
    summary?: string;
    diffPreview?: string;
  }>;
}

export interface FileContentSection {
  kind: 'file_read_content';
  filePath: string;
  content: string;
  lineOffset?: number;
  lineCount?: number;
  totalLines?: number;
  truncated?: boolean;
}

export interface WebDetailSection {
  kind: 'web_results';
  query?: string;
  sources: Array<{
    title?: string;
    titleKey?: EnvAppTranslationKey;
    url?: string;
    snippet?: string;
  }>;
}

export interface ErrorDetailSection {
  kind: 'error';
  code?: string;
  message: string;
  retryable?: boolean;
  recoveryAction?: string;
}

export interface StructuredFieldsSection {
  kind: 'structured_fields';
  title?: string;
  titleKey?: EnvAppTranslationKey;
  groups: Array<{
    title?: string;
    titleKey?: EnvAppTranslationKey;
    fields: Array<{
      label?: string;
      labelKey?: EnvAppTranslationKey;
      value?: string;
      valueKey?: EnvAppTranslationKey;
      valueParams?: TranslationParams;
      valueCount?: number;
      tone?: ActivityDetailTone;
      secret?: boolean;
    }>;
  }>;
}

export interface ActivityDetailCopyTarget {
  id: string;
  label?: string;
  labelKey?: EnvAppTranslationKey;
  labelParams?: TranslationParams;
  text: string;
  textKey?: EnvAppTranslationKey;
  textParams?: TranslationParams;
  textPrefixSeparator?: string;
}

export type ActivityDetailLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; presentation: ActivityDetailPresentation }
  | { status: 'error'; message: string };
