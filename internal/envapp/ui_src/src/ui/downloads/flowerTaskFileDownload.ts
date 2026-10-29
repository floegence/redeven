import { describeFilePreview, getExtDot, isTextFilePreview, mimeFromExtDot } from '../utils/filePreview';
import type { RuntimeDownloadSource } from './types';

export type FlowerTaskFileChunk = Readonly<{ bytes: string; next_offset: number; size: number; version: string }>;
export function flowerTaskFilePath(threadID: string, path: string, working: boolean, offset: number): string {
  return (
    '/_redeven_proxy/api/ai/threads/' +
    encodeURIComponent(threadID) +
    '/task-file-content?' +
    new URLSearchParams({ path, kind: working ? 'working' : 'delivered', offset: String(offset) })
  );
}
/** One validated, cancellable read path for downloads and in-dialog previews. */
async function* readFlowerTaskFileChunks(
  read: (offset: number) => Promise<FlowerTaskFileChunk>,
  signal: AbortSignal,
): AsyncGenerator<{ bytes: Uint8Array<ArrayBuffer>; size: number }> {
  let offset = 0,
    version: string | undefined,
    size: number | undefined;
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
      (version !== undefined && chunk.version !== version) ||
      (size !== undefined && chunk.size !== size)
    )
      throw new Error('File changed during download.');
    version = chunk.version;
    size = chunk.size;
    yield { bytes, size };
    offset = chunk.next_offset;
    if (offset === chunk.size) break;
  }
}

/** Discover the size from the first authorized chunk without buffering the file. */
export async function openFlowerTaskFile(
  read: (offset: number) => Promise<FlowerTaskFileChunk>,
  signal: AbortSignal,
): ReturnType<RuntimeDownloadSource['open']> {
  const iterator = readFlowerTaskFileChunks(read, signal);
  const first = await iterator.next();
  return {
    totalBytes: first.value?.size,
    chunks: (async function* () {
      try {
        if (!first.done) yield first.value.bytes;
        for await (const chunk of iterator) yield chunk.bytes;
      } finally { await iterator.return(undefined); }
    })(),
  };
}

/** Preview buffers are bounded; downloading retains the streaming path. */
export async function loadFlowerTaskFile(
  path: string,
  read: (offset: number) => Promise<FlowerTaskFileChunk>,
  signal: AbortSignal,
): Promise<Blob> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for await (const { bytes, size } of readFlowerTaskFileChunks(read, signal)) {
    if (size > 20 * 1024 * 1024) throw new Error('File exceeds the preview size limit.');
    chunks.push(bytes);
  }
  signal.throwIfAborted();
  const mime = mimeFromExtDot(getExtDot(path)) || (describeFilePreview(path).mode === 'markdown' ? 'text/markdown'
    : isTextFilePreview(describeFilePreview(path)) ? 'text/plain' : 'application/octet-stream');
  return new Blob(chunks, { type: mime });
}
