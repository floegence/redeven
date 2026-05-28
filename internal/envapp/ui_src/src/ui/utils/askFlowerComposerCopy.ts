import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import { createI18nHelpers, type I18nHelpers } from '../i18n/createI18n';
import { getAskFlowerAttachmentSourcePath } from './askFlowerAttachmentMetadata';
import {
  buildMonitorProcessSnapshotText,
  formatMonitorProcessBytes,
  monitorProcessDisplayLabel,
} from './monitorProcessAskFlower';

export type AskFlowerComposerTranslate = I18nHelpers['t'];

export type AskFlowerComposerCopyOptions = Readonly<{
  t?: AskFlowerComposerTranslate;
}>;

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

const defaultAskFlowerComposerT = createI18nHelpers('en-US').t;

function composerT(options?: AskFlowerComposerCopyOptions): AskFlowerComposerTranslate {
  return options?.t ?? defaultAskFlowerComposerT;
}

function basenameFromPath(path: string, t: AskFlowerComposerTranslate): string {
  const normalized = String(path ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized || t('askFlowerComposer.contextFallback');
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

function buildContextEntries(intent: AskFlowerIntent, t: AskFlowerComposerTranslate): AskFlowerLinkedContextChip[] {
  const entries: AskFlowerLinkedContextChip[] = [];

  intent.contextItems.forEach((item, index) => {
    if (item.kind === 'file_path') {
      const label = basenameFromPath(item.path, t);
      entries.push({
        id: `context-${index}-${item.isDirectory ? 'directory' : 'file'}`,
        tone: item.isDirectory ? 'directory' : 'file',
        itemIndex: index,
        label,
        title: item.isDirectory
          ? t('askFlowerComposer.context.browseFolderTarget', { target: item.path })
          : t('askFlowerComposer.context.openLiveFilePreviewForTarget', { target: item.path }),
        detail: item.path,
        primaryAction: item.isDirectory ? directoryBrowserAction(item.path) : liveFileAction(item.path),
        secondaryActions: [],
      });
      return;
    }

    if (item.kind === 'file_selection') {
      const label = basenameFromPath(item.path, t);
      entries.push({
        id: `context-${index}-selection`,
        tone: 'selection',
        itemIndex: index,
        label: t('askFlowerComposer.context.selectedContent'),
        title: t('askFlowerComposer.context.previewSelectedContentFromTarget', { target: item.path }),
        detail: label,
        primaryAction: {
          type: 'open_text_context_preview',
          title: t('askFlowerComposer.context.selectedContentTitle'),
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
        title: t('askFlowerComposer.context.previewMonitoringSnapshotForPid', { pid: item.pid }),
        detail: `${String(item.username ?? '').trim() || 'system'} · ${Number(item.cpuPercent ?? 0).toFixed(1)}% CPU · ${formatMonitorProcessBytes(item.memoryBytes)}`,
        primaryAction: {
          type: 'open_process_snapshot_preview',
          title: t('askFlowerComposer.context.processSnapshot'),
          subtitle: `${String(item.username ?? '').trim() || 'system'} · ${Number(item.cpuPercent ?? 0).toFixed(1)}% CPU · ${formatMonitorProcessBytes(item.memoryBytes)}`,
          body: buildMonitorProcessSnapshotText(item),
          pid: item.pid,
        },
        secondaryActions: [],
      });
      return;
    }

    if (item.kind === 'text_snapshot') {
      const label = String(item.title ?? '').trim() || t('askFlowerComposer.context.snapshotFallback');
      const detail = String(item.detail ?? '').trim() || t('askFlowerComposer.context.snapshotDetailFallback');
      entries.push({
        id: `context-${index}-snapshot`,
        tone: 'snapshot',
        itemIndex: index,
        label,
        title: t('askFlowerComposer.context.previewTarget', { target: label }),
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
        label: t('askFlowerComposer.context.selectedOutput'),
        title: t('askFlowerComposer.context.previewSelectedTerminalOutput'),
        detail: item.workingDir || t('askFlowerComposer.terminalFallback'),
        primaryAction: {
          type: 'open_text_context_preview',
          title: t('askFlowerComposer.context.selectedTerminalOutputTitle'),
          subtitle: item.workingDir || t('askFlowerComposer.terminalFallback'),
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
          title: t('askFlowerComposer.context.attachmentSnapshotTitle', { target: existingEntry.label }),
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
      title: t('askFlowerComposer.context.previewAttachmentTarget', { target: label }),
      detail: t('askFlowerComposer.context.queuedAttachment'),
      primaryAction: {
        type: 'open_attachment_snapshot_preview',
        title: label,
        subtitle: t('askFlowerComposer.context.queuedAttachment'),
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

export function buildAskFlowerComposerCopy(
  intent: AskFlowerIntent,
  options?: AskFlowerComposerCopyOptions,
): AskFlowerComposerCopy {
  const t = composerT(options);
  const contextEntries = buildContextEntries(intent, t);
  const firstContext = intent.contextItems[0];
  const fileEntries = contextEntries.filter((item) => item.tone === 'file' || item.tone === 'directory');
  const hasDirectories = fileEntries.some((item) => item.tone === 'directory');

  if (firstContext?.kind === 'file_selection') {
    const selectionEntry = findEntryByItem(contextEntries, 0, 'selection');
    if (selectionEntry) {
      return {
        placeholder: t('askFlowerComposer.prompt.selectionPlaceholder'),
        question: t('askFlowerComposer.prompt.selectionQuestion'),
        contextEntries,
      };
    }
  }

  if (firstContext?.kind === 'terminal_selection') {
    const selectionEntry = findEntryByItem(contextEntries, 0, 'terminal');
    if (selectionEntry) {
      return {
        placeholder: t('askFlowerComposer.prompt.terminalOutputPlaceholder'),
        question: t('askFlowerComposer.prompt.terminalQuestion'),
        contextEntries,
      };
    }

    return {
      placeholder: t('askFlowerComposer.prompt.terminalContextPlaceholder'),
      question: t('askFlowerComposer.prompt.terminalQuestion'),
      contextEntries,
    };
  }

  if (firstContext?.kind === 'process_snapshot') {
    const processEntry = findEntryByItem(contextEntries, 0, 'process');
    if (processEntry) {
      return {
        placeholder: t('askFlowerComposer.prompt.processPlaceholder'),
        question: t('askFlowerComposer.prompt.inspectExplainQuestion'),
        contextEntries,
      };
    }
  }

  if (firstContext?.kind === 'text_snapshot') {
    if (intent.source === 'git_browser') {
      return {
        placeholder: t('askFlowerComposer.prompt.gitPlaceholder'),
        question: t('askFlowerComposer.prompt.gitQuestion'),
        contextEntries,
      };
    }

    return {
      placeholder: t('askFlowerComposer.prompt.contextPlaceholder'),
      question: t('askFlowerComposer.prompt.inspectExplainQuestion'),
      contextEntries,
    };
  }

  if (intent.source === 'file_preview') {
    const fileEntry = findEntryByTone(contextEntries, 'file');
    if (fileEntry) {
      return {
        placeholder: t('askFlowerComposer.prompt.filePlaceholder'),
        question: t('askFlowerComposer.prompt.focusQuestion'),
        contextEntries,
      };
    }
  }

  if (intent.source === 'file_browser') {
    if (fileEntries.length === 1) {
      const isDirectory = fileEntries[0].tone === 'directory';
      return {
        placeholder: isDirectory
          ? t('askFlowerComposer.prompt.folderPlaceholder')
          : t('askFlowerComposer.prompt.filePlaceholder'),
        question: isDirectory ? t('askFlowerComposer.prompt.folderQuestion') : t('askFlowerComposer.prompt.fileQuestion'),
        contextEntries,
      };
    }

    if (fileEntries.length > 1) {
      return {
        placeholder: hasDirectories
          ? t('askFlowerComposer.prompt.filesAndFoldersPlaceholder')
          : t('askFlowerComposer.prompt.filesPlaceholder'),
        question: t('askFlowerComposer.prompt.filesQuestion'),
        contextEntries,
      };
    }
  }

  const firstFileEntry = fileEntries[0];
  if (firstFileEntry) {
    return {
      placeholder: t('askFlowerComposer.prompt.contextPlaceholder'),
      question: t('askFlowerComposer.prompt.helpQuestion'),
      contextEntries,
    };
  }

  const attachmentEntry = findEntryByTone(contextEntries, 'attachment');
  if (attachmentEntry) {
    return {
      placeholder: t('askFlowerComposer.prompt.attachmentPlaceholder'),
      question: t('askFlowerComposer.prompt.attachmentQuestion'),
      contextEntries,
    };
  }

  return {
    placeholder: t('askFlowerComposer.prompt.defaultPlaceholder'),
    question: t('askFlowerComposer.prompt.defaultQuestion'),
    contextEntries,
  };
}
