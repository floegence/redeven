import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import { attachAskFlowerContextAction } from '../contextActions/askFlower';
import { deriveAbsoluteWorkingDirFromItems, normalizeAbsolutePath } from './askFlowerPath';
import { createClientId } from './clientId';

export type AskFlowerPathContextTarget = Readonly<{
  path: string;
  isDirectory: boolean;
  rootLabel?: string;
}>;

export type BuildFilePathAskFlowerIntentResult = Readonly<{
  intent: AskFlowerIntent | null;
  error?: string;
}>;

function normalizePathTargets(items: AskFlowerPathContextTarget[]): AskFlowerPathContextTarget[] {
  return items
    .map((item) => {
      const path = normalizeAbsolutePath(item.path);
      if (!path) return null;
      const rootLabel = String(item.rootLabel ?? '').trim();
      return {
        path,
        isDirectory: item.isDirectory === true,
        ...(rootLabel ? { rootLabel } : {}),
      };
    })
    .filter((item): item is AskFlowerPathContextTarget => item !== null);
}

export function buildFilePathAskFlowerIntent(params: {
  items: AskFlowerPathContextTarget[];
  fallbackWorkingDirAbs?: string;
  pendingAttachments?: File[];
  notes?: string[];
}): BuildFilePathAskFlowerIntentResult {
  const normalizedItems = normalizePathTargets(params.items);
  if (normalizedItems.length <= 0) {
    return {
      intent: null,
      error: 'Failed to resolve selected file paths.',
    };
  }

  const suggestedWorkingDirAbs = deriveAbsoluteWorkingDirFromItems(normalizedItems, params.fallbackWorkingDirAbs ?? '/');

  const intent: AskFlowerIntent = {
    id: createClientId('ask-flower'),
    source: 'file_browser',
    mode: 'append',
    suggestedWorkingDirAbs: suggestedWorkingDirAbs || undefined,
    contextItems: normalizedItems.map((item) => ({
      kind: 'file_path' as const,
      path: item.path,
      isDirectory: item.isDirectory,
      rootLabel: item.rootLabel,
    })),
    pendingAttachments: [...(params.pendingAttachments ?? [])],
    notes: [...(params.notes ?? [])],
  };

  return {
    intent: attachAskFlowerContextAction(intent),
  };
}
