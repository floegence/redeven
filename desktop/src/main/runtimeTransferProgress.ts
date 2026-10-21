import type { DesktopRuntimeTransferProgress } from '../shared/desktopComponentTaskProgress';

// Observe complete Runtime transfer records from the self-contained installer.
// Companion downloads and diagnostics must not reset the Runtime progress.
export function runtimeDownloadProgressObserver(
  publish: (progress: DesktopRuntimeTransferProgress) => void,
): (chunk: string) => void {
  let pending = '';
  let lastPercent = -1;
  return (chunk) => {
    pending += chunk;
    const frames = pending.split(/[\r\n]/u);
    pending = frames.pop() ?? '';
    for (const frame of frames) {
      const match = /^Downloading Redeven: (\d{1,3})%$/u.exec(frame);
      if (!match) continue;
      const percent = Number(match[1]);
      if (percent < 0 || percent > 100 || percent === lastPercent) continue;
      lastPercent = percent;
      publish({ transfer_kind: 'download', transfer_percent: percent });
    }
    if (pending.length > 512) pending = pending.slice(-512);
  };
}

export function runtimeUploadProgressObserver(
  publish: (progress: DesktopRuntimeTransferProgress) => void,
): (completedBytes: number, totalBytes: number) => void {
  let lastPublishedAt = 0;
  return (completedBytes, totalBytes) => {
    const now = Date.now();
    if (completedBytes !== 0 && completedBytes !== totalBytes && now - lastPublishedAt < 100) return;
    lastPublishedAt = now;
    publish({ transfer_kind: 'upload', completed_bytes: completedBytes, total_bytes: totalBytes });
  };
}
