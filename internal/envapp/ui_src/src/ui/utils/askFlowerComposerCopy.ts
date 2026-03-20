import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import { getAskFlowerAttachmentSourcePath } from './askFlowerAttachmentMetadata';

export type AskFlowerComposerEntry =
  | Readonly<{
      id: string;
      kind: 'file';
      itemIndex: number;
      label: string;
      title: string;
      detail: string;
      path: string;
      attachmentFile?: File;
    }>
  | Readonly<{
      id: string;
      kind: 'directory';
      itemIndex: number;
      label: string;
      title: string;
      detail: string;
      path: string;
    }>
  | Readonly<{
      id: string;
      kind: 'selection';
      itemIndex: number;
      label: string;
      title: string;
      detail: string;
      content: string;
      sourcePath: string;
    }>
  | Readonly<{
      id: string;
      kind: 'terminal_selection';
      itemIndex: number;
      label: string;
      title: string;
      detail: string;
      content: string;
      workingDir: string;
    }>
  | Readonly<{
      id: string;
      kind: 'attachment';
      itemIndex: number | null;
      label: string;
      title: string;
      detail: string;
      file: File;
    }>;

export type AskFlowerComposerCopy = Readonly<{
  placeholder: string;
  question: string;
  contextEntries: AskFlowerComposerEntry[];
}>;

function basenameFromPath(path: string): string {
  const normalized = String(path ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized || 'Context';
}

function buildContextEntries(intent: AskFlowerIntent): AskFlowerComposerEntry[] {
  const entries: AskFlowerComposerEntry[] = [];

  intent.contextItems.forEach((item, index) => {
    if (item.kind === 'file_path') {
      const label = basenameFromPath(item.path);
      entries.push({
        id: `context-${index}-${item.isDirectory ? 'directory' : 'file'}`,
        kind: item.isDirectory ? 'directory' : 'file',
        itemIndex: index,
        label,
        title: item.isDirectory ? `Open folder ${item.path}` : `Preview ${item.path}`,
        detail: item.path,
        path: item.path,
      });
      return;
    }

    if (item.kind === 'file_selection') {
      const label = basenameFromPath(item.path);
      entries.push({
        id: `context-${index}-selection`,
        kind: 'selection',
        itemIndex: index,
        label: 'selected content',
        title: `Preview selected content from ${item.path}`,
        detail: label,
        content: item.selection,
        sourcePath: item.path,
      });
      entries.push({
        id: `context-${index}-file`,
        kind: 'file',
        itemIndex: index,
        label,
        title: `Preview ${item.path}`,
        detail: item.path,
        path: item.path,
      });
      return;
    }

    if (String(item.selection ?? '').trim()) {
      entries.push({
        id: `context-${index}-terminal-selection`,
        kind: 'terminal_selection',
        itemIndex: index,
        label: 'selected output',
        title: 'Preview selected terminal output',
        detail: item.workingDir || 'Terminal',
        content: item.selection,
        workingDir: item.workingDir,
      });
    }
  });

  intent.pendingAttachments.forEach((file, index) => {
    const sourcePath = getAskFlowerAttachmentSourcePath(file);
    if (sourcePath) {
      const existingFileIndex = entries.findIndex((entry) => entry.kind === 'file' && entry.path === sourcePath);
      if (existingFileIndex >= 0) {
        const existingEntry = entries[existingFileIndex];
        if (existingEntry.kind !== 'file') return;
        entries[existingFileIndex] = {
          ...existingEntry,
          attachmentFile: file,
        };
        return;
      }
    }

    const label = String(file.name ?? '').trim() || `attachment-${index + 1}`;
    entries.push({
      id: `attachment-${index}`,
      kind: 'attachment',
      itemIndex: null,
      label,
      title: `Preview attachment ${label}`,
      detail: 'Queued attachment',
      file,
    });
  });

  return entries;
}

function findEntryByKind(entries: AskFlowerComposerEntry[], kind: AskFlowerComposerEntry['kind']): AskFlowerComposerEntry | undefined {
  return entries.find((item) => item.kind === kind);
}

function findEntryByItem(entries: AskFlowerComposerEntry[], itemIndex: number, kind: AskFlowerComposerEntry['kind']): AskFlowerComposerEntry | undefined {
  return entries.find((item) => item.itemIndex === itemIndex && item.kind === kind);
}

export function buildAskFlowerComposerCopy(intent: AskFlowerIntent): AskFlowerComposerCopy {
  const contextEntries = buildContextEntries(intent);
  const firstContext = intent.contextItems[0];
  const fileEntries = contextEntries.filter((item) => item.kind === 'file' || item.kind === 'directory');
  const hasDirectories = fileEntries.some((item) => item.kind === 'directory');

  if (firstContext?.kind === 'file_selection') {
    const selectionEntry = findEntryByItem(contextEntries, 0, 'selection');
    const fileEntry = findEntryByItem(contextEntries, 0, 'file');
    if (selectionEntry && fileEntry) {
      return {
        placeholder: 'Ask about this selection, request a change, or describe what you need',
        question: 'What would you like to understand, change, or verify?',
        contextEntries,
      };
    }
  }

  if (firstContext?.kind === 'terminal_selection') {
    const selectionEntry = findEntryByItem(contextEntries, 0, 'terminal_selection');
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

  if (intent.source === 'file_preview') {
    const fileEntry = findEntryByKind(contextEntries, 'file');
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
      const isDirectory = fileEntries[0].kind === 'directory';
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

  const attachmentEntry = findEntryByKind(contextEntries, 'attachment');
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
