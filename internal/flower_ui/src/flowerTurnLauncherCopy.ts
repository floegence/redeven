import type {
  FlowerTurnLauncherIntent,
} from './contracts/flowerSurfaceContracts';
import { compact, basenameFromPath, truncatePath, formatBytes, processLabel, processSnapshotText } from './chat/contextItemUtils';

export type FlowerTurnLauncherContextTone =
  | 'thread'
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
  context_entries: readonly FlowerTurnLauncherContextChip[];
}>;

export type FlowerTurnLauncherWindowChromeCopy = Readonly<{
  window_title: string;
  linked_context_label: string;
  remove_reference: (name: string) => string;
  working_dir_label: string;
  working_directory_unavailable: string;
  ready: string;
  close: string;
  sending: string;
  you_label: string;
  send_turn: string;
  add_attachments: string;
  select_model: string;
  models_failed: string;
  empty_message: string;
  launch_failed_title: string;
  launch_unknown_title: string;
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

export type FlowerTurnLauncherProjectionCopy = Readonly<{
  context: FlowerTurnLauncherContextCopy;
}>;

export type FlowerTurnLauncherWindowCopy = FlowerTurnLauncherWindowChromeCopy & FlowerTurnLauncherProjectionCopy;

export type FlowerTurnLauncherWindowCopyInput = Partial<FlowerTurnLauncherWindowChromeCopy> & Readonly<{
  context?: Partial<FlowerTurnLauncherContextCopy>;
}>;

export const DEFAULT_FLOWER_TURN_LAUNCHER_WINDOW_COPY: FlowerTurnLauncherWindowCopy = {
  window_title: 'Ask Flower',
  linked_context_label: 'Linked context',
  remove_reference: (name) => `Remove reference ${name}`,
  working_dir_label: 'Working dir',
  working_directory_unavailable: 'Working directory unavailable',
  ready: 'Ready',
  close: 'Close',
  sending: 'Sending',
  you_label: 'You',
  send_turn: 'Launch turn',
  add_attachments: 'Add attachments',
  select_model: 'Select model',
  models_failed: 'Could not load models. Try again.',
  empty_message: 'Enter a message before sending.',
  launch_failed_title: 'Flower could not start this turn.',
  launch_unknown_title: 'Delivery is still being confirmed. Retry to check the same request.',
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

};

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
  };
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

export function buildFlowerTurnLauncherCopy(
  intent: FlowerTurnLauncherIntent,
  copy?: FlowerTurnLauncherWindowCopyInput,
): FlowerTurnLauncherProjectedCopy {
  const projectionCopy = resolveProjectionCopy(copy);
  const contextEntries = buildContextEntries(intent, projectionCopy);
  return {
    context_entries: contextEntries,
  };
}

export { truncatePath as truncateFlowerTurnLauncherPath };
