import { createContext, useContext } from 'solid-js';

import type { DownloadManager } from './types';

export const DownloadContext = createContext<DownloadManager>();

export function useDownloadManager(): DownloadManager {
  const ctx = useContext(DownloadContext);
  if (!ctx) {
    throw new Error('DownloadContext is missing');
  }
  return ctx;
}
