import type { FileItem } from '@floegence/floe-webapp-core/file-browser';

import type { FlowerLinkedContextPathOpenRequest } from '../../../../../flower_ui/src';
import type { FilePreviewOpenOptions } from '../widgets/FilePreviewContext';
import { basenameFromAbsolutePath, normalizeAbsolutePath } from '../utils/askFlowerPath';
import { fileItemFromPath } from '../utils/filePreviewItem';

type LinkedContextNavigationOptions = Readonly<{
  openFilePreview: (item: FileItem, options?: FilePreviewOpenOptions) => Promise<void>;
  openFileBrowserAtPath: (
    path: string,
    options?: Readonly<{
      title?: string;
      openStrategy?: 'focus_latest_or_create' | 'create_new';
    }>,
  ) => Promise<void>;
  notifyInvalidFilePath: () => void;
  notifyInvalidDirectoryPath: () => void;
}>;

export type FlowerCanonicalReferenceNavigationTarget = Readonly<{
  kind: 'file' | 'directory';
  label: string;
  path: string;
}>;

export function createFlowerLinkedContextNavigation(options: LinkedContextNavigationOptions): Readonly<{
  openCanonicalReferenceTarget: (target: FlowerCanonicalReferenceNavigationTarget) => Promise<void>;
  openLinkedFilePreview: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
  openLinkedDirectoryBrowser: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
}> {
  const openFilePath = async (rawPath: string): Promise<void> => {
    const path = normalizeAbsolutePath(rawPath);
    if (!path) {
      options.notifyInvalidFilePath();
      return;
    }
    await options.openFilePreview(fileItemFromPath(path), {
      focus: true,
      reusePolicy: 'same_file_or_create',
    });
  };
  const openDirectoryPath = async (rawPath: string, title?: string): Promise<void> => {
    const path = normalizeAbsolutePath(rawPath);
    if (!path) {
      options.notifyInvalidDirectoryPath();
      return;
    }
    await options.openFileBrowserAtPath(path, {
      title: String(title ?? '').trim() || basenameFromAbsolutePath(path),
      openStrategy: 'focus_latest_or_create',
    });
  };

  return {
    openCanonicalReferenceTarget: async (target) => {
      if (target.kind === 'file') {
        await openFilePath(target.path);
        return;
      }
      await openDirectoryPath(target.path, target.label);
    },
    openLinkedFilePreview: async (request) => openFilePath(request.path),
    openLinkedDirectoryBrowser: async (request) => openDirectoryPath(request.path),
  };
}
