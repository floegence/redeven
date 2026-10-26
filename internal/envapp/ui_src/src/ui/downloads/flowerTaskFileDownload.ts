import { resolveDownloadSink } from './downloadSinks';
import type { PreparedDownloadSink } from './types';

export type FlowerTaskFileChunk = Readonly<{ bytes: string; next_offset: number; size: number; version: string }>;
export function flowerTaskFilePath(threadID: string, path: string, working: boolean, offset: number): string {
  return (
    '/_redeven_proxy/api/ai/threads/' +
    encodeURIComponent(threadID) +
    '/task-file-content?' +
    new URLSearchParams({ path, kind: working ? 'working' : 'delivered', offset: String(offset) })
  );
}
/** Reuses native/browser destinations; transfers bounded chunks without buffering the source. */
export async function downloadFlowerTaskFile(
  path: string,
  read: (offset: number) => Promise<FlowerTaskFileChunk>,
  signal: AbortSignal,
): Promise<void> {
  const name = path.split(/[\\/]/).pop() || 'download';
  const sink = resolveDownloadSink();
  let destination: PreparedDownloadSink | undefined;
  try {
    destination = await sink.prepare(
      {
        id: crypto.randomUUID(),
        command: { source: { kind: 'runtime_file', path, name }, entryKind: 'file', origin: 'file_preview' },
        platform: sink.kind,
        status: 'choosing_destination',
        createdAt: Date.now(),
        bytesRead: 0,
        cancelable: true,
      },
      signal,
    );
    let offset = 0,
      version: string | undefined;
    for (;;) {
      signal.throwIfAborted();
      const chunk = await read(offset);
      signal.throwIfAborted();
      const bytes = Uint8Array.from(atob(chunk.bytes), (c) => c.charCodeAt(0));
      if (
        !Number.isSafeInteger(chunk.size) ||
        chunk.size < 0 ||
        chunk.next_offset !== offset + bytes.length ||
        chunk.next_offset > chunk.size ||
        bytes.length > 256 * 1024 ||
        (bytes.length === 0 && offset !== chunk.size) ||
        !chunk.version ||
        (version !== undefined && chunk.version !== version)
      )
        throw new Error('File changed during download.');
      version = chunk.version;
      await destination.write(bytes);
      offset = chunk.next_offset;
      if (offset === chunk.size) break;
    }
    signal.throwIfAborted();
    await destination.complete();
  } catch (error) {
    await destination?.abort(
      signal.aborted || (error instanceof DOMException && error.name === 'AbortError') ? 'canceled' : 'failed',
    );
    throw error;
  }
}
