import { createContext, useContext } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { FilePreviewController } from './createFilePreviewController';

export type FilePreviewReusePolicy =
  | 'single_surface'
  | 'same_file_or_create'
  | 'focus_latest_or_create'
  | 'create_new';

export type FilePreviewOpenOptions = Readonly<{
  reusePolicy?: FilePreviewReusePolicy;
  focus?: boolean;
  ensureVisible?: boolean;
}>;

export type FilePreviewContextValue = Readonly<{
  controller: FilePreviewController;
  openPreview: (item: FileItem, options?: FilePreviewOpenOptions) => Promise<void>;
  closePreview: () => void;
}>;

export const FilePreviewContext = createContext<FilePreviewContextValue>();

export function useFilePreviewContext(): FilePreviewContextValue {
  const ctx = useContext(FilePreviewContext);
  if (!ctx) {
    throw new Error('FilePreviewContext is missing');
  }
  return ctx;
}
