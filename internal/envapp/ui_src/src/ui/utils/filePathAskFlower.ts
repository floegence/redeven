import type { AskFlowerIntent } from '../pages/askFlowerIntent';
import { deriveAbsoluteWorkingDirFromItems, normalizeAbsolutePath } from './askFlowerPath';
import { createClientId } from './clientId';

export type AskFlowerPathContextTarget = Readonly<{
  path: string;
  isDirectory: boolean;
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
      return {
        path,
        isDirectory: item.isDirectory === true,
      };
    })
    .filter((item): item is AskFlowerPathContextTarget => !!item);
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

  return {
    intent: {
      id: createClientId('ask-flower'),
      source: 'file_browser',
      mode: 'append',
      suggestedWorkingDirAbs: suggestedWorkingDirAbs || undefined,
      contextItems: normalizedItems.map((item) => ({
        kind: 'file_path' as const,
        path: item.path,
        isDirectory: item.isDirectory,
      })),
      pendingAttachments: [...(params.pendingAttachments ?? [])],
      notes: [...(params.notes ?? [])],
    },
  };
}
