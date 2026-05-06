import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import { attachAskFlowerContextAction } from '../contextActions/askFlower';
import { dirnameAbsolute, normalizeAbsolutePath } from './askFlowerPath';
import { createClientId } from './clientId';

const MAX_INLINE_SELECTION_CHARS = 10_000;

export type BuildFilePreviewAskFlowerIntentResult = Readonly<{
  intent: AskFlowerIntent | null;
  error?: string;
}>;

export function buildFilePreviewAskFlowerIntent(params: {
  item?: FileItem | null;
  selectionText?: string;
}): BuildFilePreviewAskFlowerIntentResult {
  const item = params.item;
  if (!item || item.type !== 'file') {
    return { intent: null };
  }

  const absolutePath = normalizeAbsolutePath(item.path);
  if (!absolutePath) {
    return {
      intent: null,
      error: 'Failed to resolve file path.',
    };
  }

  const selection = String(params.selectionText ?? '').trim();
  const notes: string[] = [];
  const pendingAttachments: File[] = [];
  let contextItems: AskFlowerIntent['contextItems'];

  if (selection) {
    if (selection.length > MAX_INLINE_SELECTION_CHARS) {
      const attachmentName = `${item.name || 'file'}-selection-${Date.now()}.txt`;
      pendingAttachments.push(new File([selection], attachmentName, { type: 'text/plain' }));
      notes.push(`Large selection was attached as "${attachmentName}".`);
      contextItems = [{ kind: 'file_path', path: absolutePath, isDirectory: false }];
    } else {
      contextItems = [{ kind: 'file_selection', path: absolutePath, selection, selectionChars: selection.length }];
    }
  } else {
    contextItems = [{ kind: 'file_path', path: absolutePath, isDirectory: false }];
  }

  const intent: AskFlowerIntent = {
    id: createClientId('ask-flower'),
    source: 'file_preview',
    mode: 'append',
    suggestedWorkingDirAbs: dirnameAbsolute(absolutePath),
    contextItems,
    pendingAttachments,
    notes,
  };

  return {
    intent: attachAskFlowerContextAction(intent),
  };
}
