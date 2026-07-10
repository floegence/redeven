import type { FlowerTurnLauncherIntent } from '../../../../../flower_ui/src';
import { attachAskFlowerContextAction, type EnvFlowerTurnLauncherIntent } from '../contextActions/askFlower';
import { deriveAbsoluteWorkingDirFromItems, normalizeAbsolutePath } from './askFlowerPath';
import { createClientId } from './clientId';

export type AskFlowerPathContextTarget = Readonly<{
  path: string;
  isDirectory: boolean;
  rootLabel?: string;
}>;

export type BuildFilePathFlowerTurnLauncherIntentResult = Readonly<{
  intent: FlowerTurnLauncherIntent | null;
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

export function buildFilePathFlowerTurnLauncherIntent(params: {
  items: AskFlowerPathContextTarget[];
  fallbackWorkingDirAbs?: string;
  notes?: string[];
}): BuildFilePathFlowerTurnLauncherIntentResult {
  const normalizedItems = normalizePathTargets(params.items);
  if (normalizedItems.length <= 0) {
    return {
      intent: null,
      error: 'Failed to resolve selected file paths.',
    };
  }

  const suggestedWorkingDirAbs = deriveAbsoluteWorkingDirFromItems(normalizedItems, params.fallbackWorkingDirAbs ?? '/');

  const intent: EnvFlowerTurnLauncherIntent = {
    id: createClientId('ask-flower'),
    source_surface: 'file_browser',
    suggested_working_dir: suggestedWorkingDirAbs || undefined,
    context_items: normalizedItems.map((item) => ({
      kind: 'file_path' as const,
      path: item.path,
      is_directory: item.isDirectory,
      root_label: item.rootLabel,
    })),
    pending_attachments: [],
    notes: [...(params.notes ?? [])],
  };

  return {
    intent: attachAskFlowerContextAction(intent),
  };
}
