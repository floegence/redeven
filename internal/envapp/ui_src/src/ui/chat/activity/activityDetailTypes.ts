export type ActivityDetailStatus = 'pending' | 'running' | 'success' | 'error' | 'waiting' | 'info';

export type ActivityDetailTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

export interface ActivityDetailChip {
  label: string;
  value?: string;
  tone?: ActivityDetailTone;
}

export interface ActivityDetailPresentation {
  detailId: string;
  title: string;
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
  title: string;
  items: Array<{
    id?: string;
    content: string;
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
    title: string;
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
  title: string;
  groups: Array<{
    title: string;
    fields: Array<{
      label: string;
      value: string;
      tone?: ActivityDetailTone;
      secret?: boolean;
    }>;
  }>;
}

export interface ActivityDetailCopyTarget {
  id: string;
  label: string;
  text: string;
}

export type ActivityDetailLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; presentation: ActivityDetailPresentation }
  | { status: 'error'; message: string };
