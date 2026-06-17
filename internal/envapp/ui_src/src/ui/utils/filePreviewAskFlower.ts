import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { FlowerTurnLauncherIntent } from '../../../../../flower_ui/src';
import { attachAskFlowerContextAction, type EnvFlowerTurnLauncherContextItem, type EnvFlowerTurnLauncherIntent } from '../contextActions/askFlower';
import { dirnameAbsolute, normalizeAbsolutePath } from './askFlowerPath';
import { createClientId } from './clientId';

const MAX_INLINE_SELECTION_CHARS = 10_000;

export type BuildFilePreviewFlowerTurnLauncherIntentResult = Readonly<{
  intent: FlowerTurnLauncherIntent | null;
  error?: string;
}>;

export function buildFilePreviewFlowerTurnLauncherIntent(params: {
  item?: FileItem | null;
  selectionText?: string;
}): BuildFilePreviewFlowerTurnLauncherIntentResult {
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
  let contextItems: EnvFlowerTurnLauncherContextItem[];

  if (selection) {
    if (selection.length > MAX_INLINE_SELECTION_CHARS) {
      const attachmentName = `${item.name || 'file'}-selection-${Date.now()}.txt`;
      pendingAttachments.push(new File([selection], attachmentName, { type: 'text/plain' }));
      notes.push(`Large selection was attached as "${attachmentName}".`);
      contextItems = [{ kind: 'file_path', path: absolutePath, is_directory: false }];
    } else {
      contextItems = [{ kind: 'file_selection', path: absolutePath, selection, selection_chars: selection.length }];
    }
  } else {
    contextItems = [{ kind: 'file_path', path: absolutePath, is_directory: false }];
  }

  const intent: EnvFlowerTurnLauncherIntent = {
    id: createClientId('ask-flower'),
    source_surface: 'file_preview',
    suggested_working_dir: dirnameAbsolute(absolutePath),
    context_items: contextItems,
    pending_attachments: pendingAttachments,
    notes,
  };

  return {
    intent: attachAskFlowerContextAction(intent),
  };
}
