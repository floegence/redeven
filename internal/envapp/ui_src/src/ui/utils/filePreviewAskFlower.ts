import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { FlowerTurnLauncherIntent } from '../../../../../flower_ui/src';
import { attachAskFlowerContextAction, type EnvFlowerTurnLauncherContextItem, type EnvFlowerTurnLauncherIntent } from '../contextActions/askFlower';
import { dirnameAbsolute, normalizeAbsolutePath } from './askFlowerPath';
import { createClientId } from './clientId';

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

  const contextItems: EnvFlowerTurnLauncherContextItem[] = [{ kind: 'file_path', path: absolutePath, is_directory: false }];

  const intent: EnvFlowerTurnLauncherIntent = {
    id: createClientId('ask-flower'),
    source_surface: 'file_preview',
    suggested_working_dir: dirnameAbsolute(absolutePath),
    context_items: contextItems,
    pending_attachments: [],
    notes: [],
  };

  return {
    intent: attachAskFlowerContextAction(intent),
  };
}
