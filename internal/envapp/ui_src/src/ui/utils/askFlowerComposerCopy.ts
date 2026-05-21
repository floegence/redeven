import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import { getAskFlowerAttachmentSourcePath } from './askFlowerAttachmentMetadata';
import {
  buildMonitorProcessSnapshotText,
  formatMonitorProcessBytes,
  monitorProcessDisplayLabel,
} from './monitorProcessAskFlower';

export type AskFlowerLinkedContextTone =
  | 'file'
  | 'directory'
  | 'selection'
  | 'snapshot'
  | 'process'
  | 'terminal'
  | 'attachment';

export type AskFlowerLinkedContextAction =
  | Readonly<{ type: 'open_live_file_preview'; path: string }>
  | Readonly<{ type: 'open_directory_browser'; path: string }>
  | Readonly<{
      type: 'open_text_context_preview';
      title: string;
      subtitle: string;
      body: string;
      sourcePath?: string;
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
      subtitle: string;
      file: File;
      livePath?: string;
    }>;

export type AskFlowerLinkedContextChip = Readonly<{
  id: string;
  itemIndex: number | null;
  label: string;
  detail: string;
  title: string;
  tone: AskFlowerLinkedContextTone;
  primaryAction: AskFlowerLinkedContextAction;
  secondaryActions: readonly AskFlowerLinkedContextAction[];
}>;

export type AskFlowerComposerCopy = Readonly<{
  placeholder: string;
  question: string;
  contextEntries: AskFlowerLinkedContextChip[];
}>;

function basenameFromPath(path: string): string {
  const normalized = String(path ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized || 'Context';
}

function liveFileAction(path: string): AskFlowerLinkedContextAction {
  return { type: 'open_live_file_preview', path };
}

function directoryBrowserAction(path: string): AskFlowerLinkedContextAction {
  return { type: 'open_directory_browser', path };
}

function actionLiveFilePath(action: AskFlowerLinkedContextAction): string | null {
  return action.type === 'open_live_file_preview' ? action.path : null;
}

function chipReferencesLiveFilePath(chip: AskFlowerLinkedContextChip, path: string): boolean {
  const primaryPath = actionLiveFilePath(chip.primaryAction);
  if (primaryPath === path) return true;
  return chip.secondaryActions.some((action) => actionLiveFilePath(action) === path);
}

function withSecondaryAction(
  chip: AskFlowerLinkedContextChip,
  action: AskFlowerLinkedContextAction,
): AskFlowerLinkedContextChip {
  return {
    ...chip,
    secondaryActions: [...chip.secondaryActions, action],
  };
}

function buildContextEntries(intent: AskFlowerIntent): AskFlowerLinkedContextChip[] {
  const entries: AskFlowerLinkedContextChip[] = [];

  intent.contextItems.forEach((item, index) => {
    if (item.kind === 'file_path') {
      const label = basenameFromPath(item.path);
      entries.push({
        id: `context-${index}-${item.isDirectory ? 'directory' : 'file'}`,
        tone: item.isDirectory ? 'directory' : 'file',
        itemIndex: index,
        label,
        title: item.isDirectory ? `Browse folder ${item.path}` : `Open live file preview for ${item.path}`,
        detail: item.path,
        primaryAction: item.isDirectory ? directoryBrowserAction(item.path) : liveFileAction(item.path),
        secondaryActions: [],
      });
      return;
    }

    if (item.kind === 'file_selection') {
      const label = basenameFromPath(item.path);
      entries.push({
        id: `context-${index}-selection`,
        tone: 'selection',
        itemIndex: index,
        label: 'selected content',
        title: `Preview selected content from ${item.path}`,
        detail: label,
        primaryAction: {
          type: 'open_text_context_preview',
          title: 'Selected content',
          subtitle: label,
          body: item.selection,
          sourcePath: item.path,
        },
        secondaryActions: [liveFileAction(item.path)],
      });
      return;
    }

    if (item.kind === 'process_snapshot') {
      entries.push({
        id: `context-${index}-process-snapshot`,
        tone: 'process',
        itemIndex: index,
        label: monitorProcessDisplayLabel({ pid: item.pid, name: item.name }),
        title: `Preview monitoring snapshot for PID ${item.pid}`,
        detail: `${String(item.username ?? '').trim() || 'system'} · ${Number(item.cpuPercent ?? 0).toFixed(1)}% CPU · ${formatMonitorProcessBytes(item.memoryBytes)}`,
        primaryAction: {
          type: 'open_process_snapshot_preview',
          title: 'Process snapshot',
          subtitle: `${String(item.username ?? '').trim() || 'system'} · ${Number(item.cpuPercent ?? 0).toFixed(1)}% CPU · ${formatMonitorProcessBytes(item.memoryBytes)}`,
          body: buildMonitorProcessSnapshotText(item),
          pid: item.pid,
        },
        secondaryActions: [],
      });
      return;
    }

    if (item.kind === 'text_snapshot') {
      const label = String(item.title ?? '').trim() || 'snapshot';
      const detail = String(item.detail ?? '').trim() || 'Snapshot';
      entries.push({
        id: `context-${index}-snapshot`,
        tone: 'snapshot',
        itemIndex: index,
        label,
        title: `Preview ${label}`,
        detail,
        primaryAction: {
          type: 'open_text_context_preview',
          title: label,
          subtitle: detail,
          body: item.content,
        },
        secondaryActions: [],
      });
      return;
    }

    if (String(item.selection ?? '').trim()) {
      entries.push({
        id: `context-${index}-terminal-selection`,
        tone: 'terminal',
        itemIndex: index,
        label: 'selected output',
        title: 'Preview selected terminal output',
        detail: item.workingDir || 'Terminal',
        primaryAction: {
          type: 'open_text_context_preview',
          title: 'Selected terminal output',
          subtitle: item.workingDir || 'Terminal',
          body: item.selection,
          sourcePath: item.workingDir,
        },
        secondaryActions: [],
      });
    }
  });

  intent.pendingAttachments.forEach((file, index) => {
    const sourcePath = getAskFlowerAttachmentSourcePath(file);
    if (sourcePath) {
      const existingLiveFileIndex = entries.findIndex((entry) => chipReferencesLiveFilePath(entry, sourcePath));
      if (existingLiveFileIndex >= 0) {
        const existingEntry = entries[existingLiveFileIndex];
        entries[existingLiveFileIndex] = withSecondaryAction(existingEntry, {
          type: 'open_attachment_snapshot_preview',
          title: `${existingEntry.label} snapshot`,
          subtitle: sourcePath,
          file,
          livePath: sourcePath,
        });
        return;
      }
    }

    const label = String(file.name ?? '').trim() || `attachment-${index + 1}`;
    entries.push({
      id: `attachment-${index}`,
      tone: 'attachment',
      itemIndex: null,
      label,
      title: `Preview attachment ${label}`,
      detail: 'Queued attachment',
      primaryAction: {
        type: 'open_attachment_snapshot_preview',
        title: label,
        subtitle: 'Queued attachment',
        file,
      },
      secondaryActions: [],
    });
  });

  return entries;
}

function findEntryByTone(
  entries: AskFlowerLinkedContextChip[],
  tone: AskFlowerLinkedContextTone,
): AskFlowerLinkedContextChip | undefined {
  return entries.find((item) => item.tone === tone);
}

function findEntryByItem(
  entries: AskFlowerLinkedContextChip[],
  itemIndex: number,
  tone: AskFlowerLinkedContextTone,
): AskFlowerLinkedContextChip | undefined {
  return entries.find((item) => item.itemIndex === itemIndex && item.tone === tone);
}

export function buildAskFlowerComposerCopy(intent: AskFlowerIntent): AskFlowerComposerCopy {
  const contextEntries = buildContextEntries(intent);
  const firstContext = intent.contextItems[0];
  const fileEntries = contextEntries.filter((item) => item.tone === 'file' || item.tone === 'directory');
  const hasDirectories = fileEntries.some((item) => item.tone === 'directory');

  if (firstContext?.kind === 'file_selection') {
    const selectionEntry = findEntryByItem(contextEntries, 0, 'selection');
    if (selectionEntry) {
      return {
        placeholder: 'Ask about this selection, request a change, or describe what you need',
        question: 'What would you like to understand, change, or verify?',
        contextEntries,
      };
    }
  }

  if (firstContext?.kind === 'terminal_selection') {
    const selectionEntry = findEntryByItem(contextEntries, 0, 'terminal');
    if (selectionEntry) {
      return {
        placeholder: 'Ask about the output, request a command, or describe the next step',
        question: 'What would you like me to inspect or do next?',
        contextEntries,
      };
    }

    return {
      placeholder: 'Ask about the terminal context, request a command, or describe the next step',
      question: 'What would you like me to inspect or do next?',
      contextEntries,
    };
  }

  if (firstContext?.kind === 'process_snapshot') {
    const processEntry = findEntryByItem(contextEntries, 0, 'process');
    if (processEntry) {
      return {
        placeholder: 'Ask why this process is busy, whether it is expected, or what to do next',
        question: 'What would you like me to inspect or explain?',
        contextEntries,
      };
    }
  }

  if (firstContext?.kind === 'text_snapshot') {
    if (intent.source === 'git_browser') {
      return {
        placeholder: 'Ask about this Git context, request a change, or describe what you need',
        question: 'What should Flower inspect or help with?',
        contextEntries,
      };
    }

    return {
      placeholder: 'Ask about this context, request a change, or describe what you need',
      question: 'What would you like me to inspect or explain?',
      contextEntries,
    };
  }

  if (intent.source === 'file_preview') {
    const fileEntry = findEntryByTone(contextEntries, 'file');
    if (fileEntry) {
      return {
        placeholder: 'Ask about this file, request a change, or describe what you need',
        question: 'What should we focus on?',
        contextEntries,
      };
    }
  }

  if (intent.source === 'file_browser') {
    if (fileEntries.length === 1) {
      const isDirectory = fileEntries[0].tone === 'directory';
      return {
        placeholder: isDirectory
          ? 'Ask about this folder, the files inside it, or describe what you need'
          : 'Ask about this file, request a change, or describe what you need',
        question: isDirectory ? 'What would you like to explore inside it?' : 'What would you like me to help with?',
        contextEntries,
      };
    }

    if (fileEntries.length > 1) {
      return {
        placeholder: hasDirectories
          ? 'Ask about these files and folders, compare them, or describe what you need'
          : 'Ask about these files, compare them, or describe what you need',
        question: 'What would you like to explore, compare, or change?',
        contextEntries,
      };
    }
  }

  const firstFileEntry = fileEntries[0];
  if (firstFileEntry) {
    return {
      placeholder: 'Ask about this context, request a change, or describe what you need',
      question: 'What would you like help with?',
      contextEntries,
    };
  }

  const attachmentEntry = findEntryByTone(contextEntries, 'attachment');
  if (attachmentEntry) {
    return {
      placeholder: 'Ask about the attached context or describe what you need',
      question: 'What would you like me to focus on?',
      contextEntries,
    };
  }

  return {
    placeholder: 'Describe what you want to understand, change, or verify',
    question: 'What would you like to work on?',
    contextEntries,
  };
}
