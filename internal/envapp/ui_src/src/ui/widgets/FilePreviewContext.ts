import { createContext, useContext } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { FilePreviewController } from './createFilePreviewController';

export type FilePreviewContextValue = Readonly<{
  controller: FilePreviewController;
  openPreview: (item: FileItem) => Promise<void>;
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
