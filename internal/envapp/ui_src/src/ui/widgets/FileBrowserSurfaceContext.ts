import { createContext, useContext } from 'solid-js';
import type { FileBrowserSurfaceController, FileBrowserSurfaceOpenParams } from './createFileBrowserSurfaceController';

export type FileBrowserSurfaceContextValue = Readonly<{
  controller: FileBrowserSurfaceController;
  openBrowser: (params: FileBrowserSurfaceOpenParams) => Promise<void>;
  closeBrowser: () => void;
}>;

export const FileBrowserSurfaceContext = createContext<FileBrowserSurfaceContextValue>();

export function useFileBrowserSurfaceContext(): FileBrowserSurfaceContextValue {
  const ctx = useContext(FileBrowserSurfaceContext);
  if (!ctx) {
    throw new Error('FileBrowserSurfaceContext is missing');
  }
  return ctx;
}
