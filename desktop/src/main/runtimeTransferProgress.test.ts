import { describe, expect, it, vi } from 'vitest';
import { runtimeDownloadProgressObserver, runtimeUploadProgressObserver } from './runtimeTransferProgress';

describe('Runtime transfer progress', () => {
  it('reads only complete Runtime transfer events from the self-contained installer', () => {
    const publish = vi.fn();
    const observe = runtimeDownloadProgressObserver(publish);
    observe('Downloading ripgrep: 100%\n');
    observe('installer failed at 50%\n');
    observe('Downloading Redeven: 101%\n');
    observe('Downloading Redeven: -1%\n');
    observe('Downloading Redeven: 1');
    expect(publish).not.toHaveBeenCalled();
    observe('0%\nDownloading Rede');
    observe('ven: 50%\nDownloading Redeven: 50%\nDownloading Redeven: 100%\n');
    expect(publish.mock.calls.map(([item]) => item.transfer_percent)).toEqual([10, 50, 100]);
    expect(publish.mock.calls.every(([item]) => item.transfer_kind === 'download')).toBe(true);
  });

  it('limits upload event frequency while retaining the exact first and final byte counts', () => {
    vi.useFakeTimers();
    try {
      const publish = vi.fn();
      const observe = runtimeUploadProgressObserver(publish);
      observe(0, 1000);
      observe(100, 1000);
      vi.advanceTimersByTime(100);
      observe(300, 1000);
      observe(1000, 1000);
      expect(publish.mock.calls.map(([item]) => item.completed_bytes)).toEqual([0, 300, 1000]);
      expect(publish.mock.calls.every(([item]) => item.total_bytes === 1000)).toBe(true);
    } finally { vi.useRealTimers(); }
  });
});
