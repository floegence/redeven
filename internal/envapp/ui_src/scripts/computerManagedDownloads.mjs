import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';

// The managed-profile owner writes native downloads under opaque GUID names.
// Share the semantic source's exact handles with FloeBrowser; the borrowed CDP
// connection has no Playwright Download objects and must not change browser policy.
export function observeManagedBrowserDownloads(source, page, directory) {
  if (!path.isAbsolute(directory)) throw new Error('BROWSER_DOWNLOAD_DIRECTORY_INVALID');
  let closed = false;
  const changed = () => {
    if (closed) return;
    const known = new Set(source.downloads().map(download => download.state.id));
    for (const record of page.downloads.values()) {
      if (known.has(record.id) || !/^[a-f0-9-]{36}$/u.test(record.id)) continue;
      source.reportDownload({
        get state() {
          return { id: record.id, filename: record.filename,
            status: record.state === 'in_progress' ? 'receiving' : record.state === 'completed' ? 'complete' : record.state === 'canceled' ? 'canceled' : 'failed',
            received: record.received_bytes ?? 0, ...(record.size_bytes === undefined ? {} : { size: record.size_bytes }) };
        },
        subscribe(listener) { page.listeners.add(listener); return () => page.listeners.delete(listener); },
        async open(signal) {
          signal.throwIfAborted();
          const filename = path.join(directory, record.id);
          if (closed || record.state !== 'completed' || record.path !== filename) throw new Error('BROWSER_DOWNLOAD_UNAVAILABLE');
          const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const stat = await file.stat();
            if (closed || !stat.isFile() || stat.size !== record.size_bytes) throw new Error('BROWSER_DOWNLOAD_UNAVAILABLE');
            signal.throwIfAborted();
            return file.createReadStream({ signal, highWaterMark: 16 * 1024 });
          } catch (error) { await file.close(); throw error; }
        },
        async cancel() {
          if (!closed && record.state === 'in_progress') await source.transport.send('Browser.cancelDownload', { guid: record.id });
        },
      });
    }
  };
  page.listeners.add(changed);
  changed();
  return () => { closed = true; page.listeners.delete(changed); };
}
