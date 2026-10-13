import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { runtimeDownloadProgressObserver, runtimeUploadProgressObserver } from './runtimeTransferProgress';

describe('Runtime transfer progress', () => {
  it.each([true, false])('observes real curl downloads with content length %s', async knownLength => {
    const publish = vi.fn();
    const observe = runtimeDownloadProgressObserver(publish);
    const server = createServer((_request, response) => {
      if (knownLength) response.setHeader('content-length', 4 * 65536);
      let sent = 0;
      const timer = setInterval(() => {
        response.write(Buffer.alloc(65536));
        if (++sent === 4) { clearInterval(timer); response.end(); }
      }, 100);
      response.once('close', () => clearInterval(timer));
    });
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address() as import('node:net').AddressInfo;
      const child = spawn('curl', ['-fL', '--progress-bar', `http://127.0.0.1:${address.port}`, '-o', process.platform === 'win32' ? 'NUL' : '/dev/null']);
      child.stderr.setEncoding('utf8'); child.stderr.on('data', observe);
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      expect(code).toBe(0);
      if (knownLength) expect(publish).toHaveBeenLastCalledWith({ transfer_kind: 'download', transfer_percent: 100 });
      else expect(publish).not.toHaveBeenCalled();
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });

  it('reads fragmented curl percentage frames and leaves unknown-length transfers indeterminate', () => {
    const publish = vi.fn();
    const observe = runtimeDownloadProgressObserver(publish);
    observe('\r-=O=-    #     #\r');
    observe('curl: (22) response failed at 50.0%\n');
    expect(publish).not.toHaveBeenCalled();
    observe('\r######## 12.');
    observe('5%\r################ 50.0%');
    observe('\r################ 50.0%\r################ 100.0%\n');
    expect(publish.mock.calls.map(([item]) => item.transfer_percent)).toEqual([12.5, 50, 100]);
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
