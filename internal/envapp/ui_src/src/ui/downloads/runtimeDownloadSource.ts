import type { Client } from '@floegence/flowersec-core';

import { openFileByteStream } from '../utils/fileStreamReader';
import type { DownloadCommand, RuntimeDownloadSource } from './types';

function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value) as Uint8Array<ArrayBuffer>;
}

export function createRuntimeDownloadSource(client: () => Client | null | undefined): RuntimeDownloadSource {
  return {
    async open(command: DownloadCommand, signal: AbortSignal) {
      if (command.source.kind === 'draft_text') {
        const bytes = encodeUtf8(command.source.text);
        return {
          totalBytes: bytes.byteLength,
          chunks: (async function* draftChunks() {
            if (signal.aborted) {
              throw new DOMException('Download canceled.', 'AbortError');
            }
            yield bytes;
          })(),
        };
      }

      const currentClient = client();
      if (!currentClient) {
        throw new Error('Waiting for connection.');
      }

      const stream = await openFileByteStream({
        client: currentClient,
        path: command.source.path,
        maxBytes: 0,
        signal,
      });
      const totalBytes = typeof stream.meta.content_len === 'number'
        ? stream.meta.content_len
        : typeof stream.meta.file_size === 'number'
          ? stream.meta.file_size
          : typeof command.source.size === 'number'
            ? Math.max(0, Math.floor(command.source.size))
            : undefined;
      const chunks = (async function* runtimeChunks() {
        for await (const part of stream.chunks) {
          yield part.bytes;
        }
      })();

      return {
        totalBytes,
        chunks,
      };
    },
  };
}
