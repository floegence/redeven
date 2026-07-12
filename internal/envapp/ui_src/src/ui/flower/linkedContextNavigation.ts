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

export function createFlowerLinkedContextNavigation(options: LinkedContextNavigationOptions): Readonly<{
  openLinkedFilePreview: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
  openLinkedDirectoryBrowser: (request: FlowerLinkedContextPathOpenRequest) => Promise<void>;
}> {
  return {
    openLinkedFilePreview: async (request) => {
      const path = normalizeAbsolutePath(request.path);
      if (!path) {
        options.notifyInvalidFilePath();
        return;
      }
      await options.openFilePreview(fileItemFromPath(path), {
        focus: true,
        reusePolicy: 'same_file_or_create',
      });
    },
    openLinkedDirectoryBrowser: async (request) => {
      const path = normalizeAbsolutePath(request.path);
      if (!path) {
        options.notifyInvalidDirectoryPath();
        return;
      }
      await options.openFileBrowserAtPath(path, {
        title: basenameFromAbsolutePath(path),
        openStrategy: 'focus_latest_or_create',
      });
    },
  };
}
