import type {
  FlowerTurnLauncherContextItem,
  FlowerTurnLauncherIntent,
} from './contracts/flowerSurfaceContracts';

export type FlowerTurnLauncherContextTone =
  | 'environment'
  | 'file'
  | 'directory'
  | 'selection'
  | 'snapshot'
  | 'process'
  | 'terminal'
  | 'attachment';

export type FlowerTurnLauncherContextAction =
  | Readonly<{ type: 'open_live_file_preview'; path: string; label: string }>
  | Readonly<{ type: 'open_directory_browser'; path: string; label: string }>
  | Readonly<{
      type: 'open_text_context_preview';
      title: string;
      subtitle: string;
      body: string;
      source_path?: string;
    }>
  | Readonly<{
      type: 'open_process_snapshot_preview';
      title: string;
      subtitle: string;
      body: string;
      pid: number;
    }>
  | Readonly<{
      type: 'open_attachment_snapshot_preview';
      title: string;
      label: string;
      subtitle: string;
      file: File;
      live_path?: string;
    }>;

export type FlowerTurnLauncherContextChip = Readonly<{
  id: string;
  item_index: number | null;
  label: string;
  detail: string;
  title: string;
  tone: FlowerTurnLauncherContextTone;
  primary_action: FlowerTurnLauncherContextAction | null;
  secondary_actions: readonly FlowerTurnLauncherContextAction[];
}>;

export type FlowerTurnLauncherProjectedCopy = Readonly<{
  placeholder: string;
  question: string;
  context_entries: readonly FlowerTurnLauncherContextChip[];
}>;

export type FlowerTurnLauncherWindowChromeCopy = Readonly<{
  window_title: string;
  linked_context_label: string;
  working_dir_label: string;
  working_directory_unavailable: string;
  ready: string;
  close: string;
  sending: string;
  you_label: string;
  reply_to_flower_label: string;
  send_turn: string;
  empty_message: string;
  launch_failed_title: string;
}>;

export type FlowerTurnLauncherContextCopy = Readonly<{
  environment_fallback: string;
  context_fallback: string;
  terminal_fallback: string;
  selected_content: string;
  selected_content_title: string;
  selected_output: string;
  selected_terminal_output_title: string;
  process_snapshot: string;
  snapshot_fallback: string;
  snapshot_detail_fallback: string;
  queued_attachment: string;
  browse_folder_target: string;
  open_live_file_preview_for_target: string;
  preview_selected_content_from_target: string;
  preview_monitoring_snapshot_for_pid: string;
  preview_target: string;
  preview_selected_terminal_output: string;
  attachment_snapshot_title: string;
  preview_attachment_target: string;
  preview_attached_snapshot_for_target: string;
}>;

export type FlowerTurnLauncherPromptCopy = Readonly<{
  environment_placeholder: string;
  environment_question: string;
  selection_placeholder: string;
  selection_question: string;
  terminal_output_placeholder: string;
  terminal_context_placeholder: string;
  terminal_question: string;
  process_placeholder: string;
  inspect_explain_question: string;
  git_placeholder: string;
  git_question: string;
  context_placeholder: string;
  file_placeholder: string;
  focus_question: string;
  folder_placeholder: string;
  folder_question: string;
  file_question: string;
  files_and_folders_placeholder: string;
  files_placeholder: string;
  files_question: string;
  help_question: string;
  attachment_placeholder: string;
  attachment_question: string;
  default_placeholder: string;
  default_question: string;
}>;

export type FlowerTurnLauncherProjectionCopy = Readonly<{
  context: FlowerTurnLauncherContextCopy;
  prompt: FlowerTurnLauncherPromptCopy;
}>;

export type FlowerTurnLauncherWindowCopy = FlowerTurnLauncherWindowChromeCopy & FlowerTurnLauncherProjectionCopy;

export type FlowerTurnLauncherWindowCopyInput = Partial<FlowerTurnLauncherWindowChromeCopy> & Readonly<{
  context?: Partial<FlowerTurnLauncherContextCopy>;
  prompt?: Partial<FlowerTurnLauncherPromptCopy>;
}>;

export const DEFAULT_FLOWER_TURN_LAUNCHER_WINDOW_COPY: FlowerTurnLauncherWindowCopy = {
  window_title: 'Ask Flower',
  linked_context_label: 'Linked context',
  working_dir_label: 'Working dir',
  working_directory_unavailable: 'Working directory unavailable',
  ready: 'Ready',
  close: 'Close',
  sending: 'Sending',
  you_label: 'You',
  reply_to_flower_label: 'Reply to Flower',
  send_turn: 'Launch turn',
  empty_message: 'Enter a question before sending.',
  launch_failed_title: 'Flower could not start this turn.',
  context: {
    environment_fallback: 'Environment',
    context_fallback: 'Context',
    terminal_fallback: 'Terminal',
    selected_content: 'selected content',
    selected_content_title: 'Selected content',
    selected_output: 'selected output',
    selected_terminal_output_title: 'Selected terminal output',
    process_snapshot: 'Process snapshot',
    snapshot_fallback: 'snapshot',
    snapshot_detail_fallback: 'Snapshot',
    queued_attachment: 'Queued attachment',
    browse_folder_target: 'Browse folder {target}',
    open_live_file_preview_for_target: 'Open live file preview for {target}',
    preview_selected_content_from_target: 'Preview selected content from {target}',
    preview_monitoring_snapshot_for_pid: 'Preview monitoring snapshot for PID {pid}',
    preview_target: 'Preview {target}',
    preview_selected_terminal_output: 'Preview selected terminal output',
    attachment_snapshot_title: '{target} snapshot',
    preview_attachment_target: 'Preview attachment {target}',
    preview_attached_snapshot_for_target: 'Preview attached snapshot for {target}',
  },
  prompt: {
    environment_placeholder: 'Ask Flower to inspect, explain, or change this environment...',
    environment_question: 'What would you like Flower to do in this environment?',
    selection_placeholder: 'Ask about this selection, request a change, or describe what you need',
    selection_question: 'What would you like to understand, change, or verify?',
    terminal_output_placeholder: 'Ask about the output, request a command, or describe the next step',
    terminal_context_placeholder: 'Ask about the terminal context, request a command, or describe the next step',
    terminal_question: 'What would you like me to inspect or do next?',
    process_placeholder: 'Ask why this process is busy, whether it is expected, or what to do next',
    inspect_explain_question: 'What would you like me to inspect or explain?',
    git_placeholder: 'Ask about this Git context, request a change, or describe what you need',
    git_question: 'What should Flower inspect or help with?',
    context_placeholder: 'Ask about this context, request a change, or describe what you need',
    file_placeholder: 'Ask about this file, request a change, or describe what you need',
    focus_question: 'What should we focus on?',
    folder_placeholder: 'Ask about this folder, the files inside it, or describe what you need',
    folder_question: 'What would you like to explore inside it?',
    file_question: 'What would you like me to help with?',
    files_and_folders_placeholder: 'Ask about these files and folders, compare them, or describe what you need',
    files_placeholder: 'Ask about these files, compare them, or describe what you need',
    files_question: 'What would you like to explore, compare, or change?',
    help_question: 'What would you like help with?',
    attachment_placeholder: 'Ask about the attached context or describe what you need',
    attachment_question: 'What would you like me to focus on?',
    default_placeholder: 'Describe what you want to understand, change, or verify',
    default_question: 'What would you like to work on?',
  },
};

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function basenameFromPath(path: string, fallback: string): string {
  const normalized = compact(path).replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized || fallback;
}

function truncatePath(path: string, maxSegments = 3): string {
  const normalized = compact(path).replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length <= maxSegments) return normalized;
  return `.../${segments.slice(-maxSegments).join('/')}`;
}

function formatCopy(template: string, values: Readonly<Record<string, unknown>> = {}): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key: string) => compact(values[key]));
}

function resolveProjectionCopy(copy?: FlowerTurnLauncherWindowCopyInput): FlowerTurnLauncherProjectionCopy {
  const defaults = DEFAULT_FLOWER_TURN_LAUNCHER_WINDOW_COPY;
  return {
    context: {
      environment_fallback: compact(copy?.context?.environment_fallback) || defaults.context.environment_fallback,
      context_fallback: compact(copy?.context?.context_fallback) || defaults.context.context_fallback,
      terminal_fallback: compact(copy?.context?.terminal_fallback) || defaults.context.terminal_fallback,
      selected_content: compact(copy?.context?.selected_content) || defaults.context.selected_content,
      selected_content_title: compact(copy?.context?.selected_content_title) || defaults.context.selected_content_title,
      selected_output: compact(copy?.context?.selected_output) || defaults.context.selected_output,
      selected_terminal_output_title: compact(copy?.context?.selected_terminal_output_title) || defaults.context.selected_terminal_output_title,
      process_snapshot: compact(copy?.context?.process_snapshot) || defaults.context.process_snapshot,
      snapshot_fallback: compact(copy?.context?.snapshot_fallback) || defaults.context.snapshot_fallback,
      snapshot_detail_fallback: compact(copy?.context?.snapshot_detail_fallback) || defaults.context.snapshot_detail_fallback,
      queued_attachment: compact(copy?.context?.queued_attachment) || defaults.context.queued_attachment,
      browse_folder_target: compact(copy?.context?.browse_folder_target) || defaults.context.browse_folder_target,
      open_live_file_preview_for_target: compact(copy?.context?.open_live_file_preview_for_target) || defaults.context.open_live_file_preview_for_target,
      preview_selected_content_from_target: compact(copy?.context?.preview_selected_content_from_target) || defaults.context.preview_selected_content_from_target,
      preview_monitoring_snapshot_for_pid: compact(copy?.context?.preview_monitoring_snapshot_for_pid) || defaults.context.preview_monitoring_snapshot_for_pid,
      preview_target: compact(copy?.context?.preview_target) || defaults.context.preview_target,
      preview_selected_terminal_output: compact(copy?.context?.preview_selected_terminal_output) || defaults.context.preview_selected_terminal_output,
      attachment_snapshot_title: compact(copy?.context?.attachment_snapshot_title) || defaults.context.attachment_snapshot_title,
      preview_attachment_target: compact(copy?.context?.preview_attachment_target) || defaults.context.preview_attachment_target,
      preview_attached_snapshot_for_target: compact(copy?.context?.preview_attached_snapshot_for_target) || defaults.context.preview_attached_snapshot_for_target,
    },
    prompt: {
      environment_placeholder: compact(copy?.prompt?.environment_placeholder) || defaults.prompt.environment_placeholder,
      environment_question: compact(copy?.prompt?.environment_question) || defaults.prompt.environment_question,
      selection_placeholder: compact(copy?.prompt?.selection_placeholder) || defaults.prompt.selection_placeholder,
      selection_question: compact(copy?.prompt?.selection_question) || defaults.prompt.selection_question,
      terminal_output_placeholder: compact(copy?.prompt?.terminal_output_placeholder) || defaults.prompt.terminal_output_placeholder,
      terminal_context_placeholder: compact(copy?.prompt?.terminal_context_placeholder) || defaults.prompt.terminal_context_placeholder,
      terminal_question: compact(copy?.prompt?.terminal_question) || defaults.prompt.terminal_question,
      process_placeholder: compact(copy?.prompt?.process_placeholder) || defaults.prompt.process_placeholder,
      inspect_explain_question: compact(copy?.prompt?.inspect_explain_question) || defaults.prompt.inspect_explain_question,
      git_placeholder: compact(copy?.prompt?.git_placeholder) || defaults.prompt.git_placeholder,
      git_question: compact(copy?.prompt?.git_question) || defaults.prompt.git_question,
      context_placeholder: compact(copy?.prompt?.context_placeholder) || defaults.prompt.context_placeholder,
      file_placeholder: compact(copy?.prompt?.file_placeholder) || defaults.prompt.file_placeholder,
      focus_question: compact(copy?.prompt?.focus_question) || defaults.prompt.focus_question,
      folder_placeholder: compact(copy?.prompt?.folder_placeholder) || defaults.prompt.folder_placeholder,
      folder_question: compact(copy?.prompt?.folder_question) || defaults.prompt.folder_question,
      file_question: compact(copy?.prompt?.file_question) || defaults.prompt.file_question,
      files_and_folders_placeholder: compact(copy?.prompt?.files_and_folders_placeholder) || defaults.prompt.files_and_folders_placeholder,
      files_placeholder: compact(copy?.prompt?.files_placeholder) || defaults.prompt.files_placeholder,
      files_question: compact(copy?.prompt?.files_question) || defaults.prompt.files_question,
      help_question: compact(copy?.prompt?.help_question) || defaults.prompt.help_question,
      attachment_placeholder: compact(copy?.prompt?.attachment_placeholder) || defaults.prompt.attachment_placeholder,
      attachment_question: compact(copy?.prompt?.attachment_question) || defaults.prompt.attachment_question,
      default_placeholder: compact(copy?.prompt?.default_placeholder) || defaults.prompt.default_placeholder,
      default_question: compact(copy?.prompt?.default_question) || defaults.prompt.default_question,
    },
  };
}

function formatBytes(bytes: number): string {
  const value = Number(bytes ?? 0);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  const rounded = index === 0 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[index]}`;
}

function processLabel(item: Extract<FlowerTurnLauncherContextItem, { kind: 'process_snapshot' }>): string {
  const pid = Math.trunc(Number(item.pid ?? 0));
  const name = compact(item.name) || `[${pid}]`;
  return `${name} (PID ${pid})`;
}

function processSnapshotText(item: Extract<FlowerTurnLauncherContextItem, { kind: 'process_snapshot' }>): string {
  const lines = [
    `PID: ${Math.trunc(Number(item.pid ?? 0))}`,
    `Name: ${compact(item.name) || `[${Math.trunc(Number(item.pid ?? 0))}]`}`,
    `User: ${compact(item.username) || 'system'}`,
    `CPU: ${Number(item.cpu_percent ?? 0).toFixed(1)}%`,
    `Memory: ${formatBytes(item.memory_bytes)} (${Math.max(0, Math.round(Number(item.memory_bytes ?? 0)))} bytes)`,
  ];
  if (compact(item.platform)) {
    lines.push(`Platform: ${compact(item.platform)}`);
  }
  const capturedAtMs = Number(item.captured_at_ms ?? 0);
  if (capturedAtMs > 0) {
    lines.push(`Captured at: ${new Date(capturedAtMs).toLocaleString()}`);
  }
  return lines.join('\n');
}

const attachmentSourcePathByFile = new WeakMap<File, string>();

export function setFlowerTurnLauncherAttachmentSourcePath(file: File, path: string): File {
  const normalizedPath = compact(path);
  if (normalizedPath) {
    attachmentSourcePathByFile.set(file, normalizedPath);
  }
  return file;
}

export function getFlowerTurnLauncherAttachmentSourcePath(file: File): string {
  return attachmentSourcePathByFile.get(file) ?? '';
}

function liveFileAction(path: string, label: string): FlowerTurnLauncherContextAction {
  return { type: 'open_live_file_preview', path, label };
}

function directoryBrowserAction(path: string, label: string): FlowerTurnLauncherContextAction {
  return { type: 'open_directory_browser', path, label };
}

function actionLiveFilePath(action: FlowerTurnLauncherContextAction): string | null {
  return action.type === 'open_live_file_preview' ? action.path : null;
}

function chipReferencesLiveFilePath(chip: FlowerTurnLauncherContextChip, path: string): boolean {
  if (chip.primary_action && actionLiveFilePath(chip.primary_action) === path) return true;
  return chip.secondary_actions.some((action) => actionLiveFilePath(action) === path);
}

function withSecondaryAction(
  chip: FlowerTurnLauncherContextChip,
  action: FlowerTurnLauncherContextAction,
): FlowerTurnLauncherContextChip {
  return {
    ...chip,
    secondary_actions: [...chip.secondary_actions, action],
  };
}

function fileSourcePath(file: File): string {
  const metadata = file as File & Readonly<{
    redevenSourcePath?: string;
    sourcePath?: string;
    path?: string;
  }>;
  return getFlowerTurnLauncherAttachmentSourcePath(file)
    || compact(metadata.redevenSourcePath)
    || compact(metadata.sourcePath)
    || compact(metadata.path);
}

function buildContextEntries(
  intent: FlowerTurnLauncherIntent,
  copy: FlowerTurnLauncherProjectionCopy,
): FlowerTurnLauncherContextChip[] {
  const entries: FlowerTurnLauncherContextChip[] = [];
  const contextCopy = copy.context;

  intent.context_items.forEach((item, index) => {
    if (item.kind === 'environment') {
      const label = compact(item.label) || contextCopy.environment_fallback;
      entries.push({
        id: `context-${index}-environment`,
        tone: 'environment',
        item_index: index,
        label,
        title: label,
        detail: compact(item.detail) || compact(item.target_id),
        primary_action: null,
        secondary_actions: [],
      });
      return;
    }

    if (item.kind === 'file_path') {
      const label = basenameFromPath(item.path, contextCopy.context_fallback);
      entries.push({
        id: `context-${index}-${item.is_directory ? 'directory' : 'file'}`,
        tone: item.is_directory ? 'directory' : 'file',
        item_index: index,
        label,
        title: item.is_directory
          ? formatCopy(contextCopy.browse_folder_target, { target: item.path })
          : formatCopy(contextCopy.open_live_file_preview_for_target, { target: item.path }),
        detail: item.path,
        primary_action: item.is_directory
          ? directoryBrowserAction(item.path, formatCopy(contextCopy.browse_folder_target, { target: label }))
          : liveFileAction(item.path, formatCopy(contextCopy.open_live_file_preview_for_target, { target: label })),
        secondary_actions: [],
      });
      return;
    }

    if (item.kind === 'file_selection') {
      const label = basenameFromPath(item.path, contextCopy.context_fallback);
      entries.push({
        id: `context-${index}-selection`,
        tone: 'selection',
        item_index: index,
        label: contextCopy.selected_content,
        title: formatCopy(contextCopy.preview_selected_content_from_target, { target: item.path }),
        detail: label,
        primary_action: {
          type: 'open_text_context_preview',
          title: contextCopy.selected_content_title,
          subtitle: label,
          body: item.selection,
          source_path: item.path,
        },
        secondary_actions: [liveFileAction(item.path, formatCopy(contextCopy.open_live_file_preview_for_target, { target: label }))],
      });
      return;
    }

    if (item.kind === 'terminal_selection') {
      const selection = compact(item.selection);
      entries.push({
        id: `context-${index}-terminal-selection`,
        tone: 'terminal',
        item_index: index,
        label: selection ? contextCopy.selected_output : contextCopy.terminal_fallback,
        title: selection ? contextCopy.preview_selected_terminal_output : contextCopy.terminal_fallback,
        detail: compact(item.working_dir) || contextCopy.terminal_fallback,
        primary_action: selection
          ? {
              type: 'open_text_context_preview',
              title: contextCopy.selected_terminal_output_title,
              subtitle: compact(item.working_dir) || contextCopy.terminal_fallback,
              body: item.selection,
              source_path: item.working_dir,
            }
          : null,
        secondary_actions: [],
      });
      return;
    }

    if (item.kind === 'process_snapshot') {
      const subtitle = `${compact(item.username) || 'system'} · ${Number(item.cpu_percent ?? 0).toFixed(1)}% CPU · ${formatBytes(item.memory_bytes)}`;
      entries.push({
        id: `context-${index}-process-snapshot`,
        tone: 'process',
        item_index: index,
        label: processLabel(item),
        title: formatCopy(contextCopy.preview_monitoring_snapshot_for_pid, { pid: Math.trunc(Number(item.pid ?? 0)) }),
        detail: subtitle,
        primary_action: {
          type: 'open_process_snapshot_preview',
          title: contextCopy.process_snapshot,
          subtitle,
          body: processSnapshotText(item),
          pid: Math.trunc(Number(item.pid ?? 0)),
        },
        secondary_actions: [],
      });
      return;
    }

    if (item.kind === 'text_snapshot') {
      const label = compact(item.title) || contextCopy.snapshot_fallback;
      const detail = compact(item.detail) || contextCopy.snapshot_detail_fallback;
      entries.push({
        id: `context-${index}-snapshot`,
        tone: 'snapshot',
        item_index: index,
        label,
        title: formatCopy(contextCopy.preview_target, { target: label }),
        detail,
        primary_action: {
          type: 'open_text_context_preview',
          title: label,
          subtitle: detail,
          body: item.content,
        },
        secondary_actions: [],
      });
      return;
    }

    const label = compact(item.name) || `attachment-${index + 1}`;
    entries.push({
      id: `context-${index}-attachment`,
      tone: 'attachment',
      item_index: index,
      label,
      title: formatCopy(contextCopy.preview_attachment_target, { target: label }),
      detail: compact(item.source_path) || compact(item.mime_type) || contextCopy.queued_attachment,
      primary_action: null,
      secondary_actions: [],
    });
  });

  (intent.pending_attachments ?? []).forEach((file, index) => {
    const sourcePath = fileSourcePath(file);
    if (sourcePath) {
      const existingLiveFileIndex = entries.findIndex((entry) => chipReferencesLiveFilePath(entry, sourcePath));
      if (existingLiveFileIndex >= 0) {
        entries[existingLiveFileIndex] = withSecondaryAction(entries[existingLiveFileIndex], {
          type: 'open_attachment_snapshot_preview',
          title: formatCopy(contextCopy.attachment_snapshot_title, { target: entries[existingLiveFileIndex].label }),
          label: formatCopy(contextCopy.preview_attached_snapshot_for_target, { target: entries[existingLiveFileIndex].label }),
          subtitle: sourcePath,
          file,
          live_path: sourcePath,
        });
        return;
      }
    }

    const label = compact(file.name) || `attachment-${index + 1}`;
    entries.push({
      id: `attachment-${index}`,
      tone: 'attachment',
      item_index: null,
      label,
      title: formatCopy(contextCopy.preview_attachment_target, { target: label }),
      detail: contextCopy.queued_attachment,
      primary_action: {
        type: 'open_attachment_snapshot_preview',
        title: label,
        label: formatCopy(contextCopy.preview_attachment_target, { target: label }),
        subtitle: contextCopy.queued_attachment,
        file,
      },
      secondary_actions: [],
    });
  });

  return entries;
}

function firstEntryByTone(
  entries: readonly FlowerTurnLauncherContextChip[],
  tone: FlowerTurnLauncherContextTone,
): FlowerTurnLauncherContextChip | undefined {
  return entries.find((entry) => entry.tone === tone);
}

function sourcePrompt(
  intent: FlowerTurnLauncherIntent,
  entries: readonly FlowerTurnLauncherContextChip[],
  copy: FlowerTurnLauncherProjectionCopy,
): Pick<FlowerTurnLauncherProjectedCopy, 'placeholder' | 'question'> {
  const promptCopy = copy.prompt;
  const firstContext = intent.context_items[0];
  if (firstContext?.kind === 'environment') {
    return {
      placeholder: promptCopy.environment_placeholder,
      question: promptCopy.environment_question,
    };
  }

  if (firstContext?.kind === 'file_selection') {
    return {
      placeholder: promptCopy.selection_placeholder,
      question: promptCopy.selection_question,
    };
  }

  if (firstContext?.kind === 'terminal_selection') {
    return {
      placeholder: compact(firstContext.selection) ? promptCopy.terminal_output_placeholder : promptCopy.terminal_context_placeholder,
      question: promptCopy.terminal_question,
    };
  }

  if (firstContext?.kind === 'process_snapshot') {
    return {
      placeholder: promptCopy.process_placeholder,
      question: promptCopy.inspect_explain_question,
    };
  }

  if (firstContext?.kind === 'text_snapshot') {
    if (intent.source_surface === 'git_browser') {
      return {
        placeholder: promptCopy.git_placeholder,
        question: promptCopy.git_question,
      };
    }
    return {
      placeholder: promptCopy.context_placeholder,
      question: promptCopy.inspect_explain_question,
    };
  }

  if (intent.source_surface === 'file_preview' && firstEntryByTone(entries, 'file')) {
    return {
      placeholder: promptCopy.file_placeholder,
      question: promptCopy.focus_question,
    };
  }

  if (intent.source_surface === 'file_browser') {
    const fileEntries = entries.filter((entry) => entry.tone === 'file' || entry.tone === 'directory');
    if (fileEntries.length === 1) {
      const directory = fileEntries[0].tone === 'directory';
      return {
        placeholder: directory ? promptCopy.folder_placeholder : promptCopy.file_placeholder,
        question: directory ? promptCopy.folder_question : promptCopy.file_question,
      };
    }
    if (fileEntries.length > 1) {
      const directoryCount = fileEntries.filter((entry) => entry.tone === 'directory').length;
      return {
        placeholder: directoryCount > 0 ? promptCopy.files_and_folders_placeholder : promptCopy.files_placeholder,
        question: promptCopy.files_question,
      };
    }
  }

  if (entries.some((entry) => entry.tone === 'file' || entry.tone === 'directory')) {
    return {
      placeholder: promptCopy.context_placeholder,
      question: promptCopy.help_question,
    };
  }

  if (firstEntryByTone(entries, 'attachment')) {
    return {
      placeholder: promptCopy.attachment_placeholder,
      question: promptCopy.attachment_question,
    };
  }

  return {
    placeholder: promptCopy.default_placeholder,
    question: promptCopy.default_question,
  };
}

export function buildFlowerTurnLauncherCopy(
  intent: FlowerTurnLauncherIntent,
  copy?: FlowerTurnLauncherWindowCopyInput,
): FlowerTurnLauncherProjectedCopy {
  const projectionCopy = resolveProjectionCopy(copy);
  const contextEntries = buildContextEntries(intent, projectionCopy);
  const prompt = sourcePrompt(intent, contextEntries, projectionCopy);
  return {
    placeholder: prompt.placeholder,
    question: prompt.question,
    context_entries: contextEntries,
  };
}

export { truncatePath as truncateFlowerTurnLauncherPath };
