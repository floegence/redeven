export interface MonacoPreviewRuntimeCompatModuleDescriptor {
  id: string;
  load: () => Promise<unknown>;
}

const MONACO_PREVIEW_RUNTIME_COMPAT_MODULES: readonly MonacoPreviewRuntimeCompatModuleDescriptor[] = [
  {
    id: 'edcore.main',
    load: () => import('monaco-editor/esm/vs/editor/edcore.main.js'),
  },
  {
    id: 'suggestMemory',
    load: () => import('monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestMemory.js'),
  },
  {
    id: 'codeLensCache',
    load: () => import('monaco-editor/esm/vs/editor/contrib/codelens/browser/codeLensCache.js'),
  },
  {
    id: 'inlayHintsContribution',
    load: () => import('monaco-editor/esm/vs/editor/contrib/inlayHints/browser/inlayHintsContribution.js'),
  },
  {
    id: 'treeViewsDndService',
    load: () => import('monaco-editor/esm/vs/editor/common/services/treeViewsDndService.js'),
  },
  {
    id: 'actionWidget',
    load: () => import('monaco-editor/esm/vs/platform/actionWidget/browser/actionWidget.js'),
  },
];

let pendingMonacoPreviewRuntimeCompat: Promise<void> | null = null;

export function ensureMonacoPreviewRuntimeCompat(): Promise<void> {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.resolve();
  }

  if (pendingMonacoPreviewRuntimeCompat) {
    return pendingMonacoPreviewRuntimeCompat;
  }

  pendingMonacoPreviewRuntimeCompat = Promise.all(
    MONACO_PREVIEW_RUNTIME_COMPAT_MODULES.map((module) => module.load()),
  )
    .then(() => undefined)
    .catch((error) => {
      pendingMonacoPreviewRuntimeCompat = null;
      throw error;
    });

  return pendingMonacoPreviewRuntimeCompat;
}
