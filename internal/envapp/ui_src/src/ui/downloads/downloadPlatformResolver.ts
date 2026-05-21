import { resolveDownloadSink } from './downloadSinks';
import type { DownloadSink } from './types';

export function resolveDownloadPlatformSink(): DownloadSink {
  return resolveDownloadSink();
}
