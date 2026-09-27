import type { ByteStream, Session } from '@floegence/flowersec-core';
import type { ClientMessage, DisconnectReason, ProjectionConnection, ServerMessage } from '@floegence/floebrowser/protocol';
import { MediaPacketReader, type MediaFrame } from '@floegence/floebrowser/media';
import { redevenV1StreamKinds } from '../protocol/redeven_v1/streamKinds';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const maxDOMMessage = 16 * 1024 * 1024;

class BrowserStreamReader {
  private pending: Uint8Array = new Uint8Array(0);
  constructor(private readonly stream: ByteStream) {}

  async line(limit: number): Promise<unknown> {
    const parts: Uint8Array[] = [];
    let length = 0;
    for (;;) {
      const newline = this.pending.indexOf(10);
      const part = newline < 0 ? this.pending : this.pending.subarray(0, newline);
      length += part.byteLength;
      if (length > limit) throw new Error('Browser frame exceeds its limit');
      if (part.byteLength) parts.push(part);
      if (newline >= 0) {
        const line = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) { line.set(part, offset); offset += part.byteLength; }
        this.pending = this.pending.subarray(newline + 1);
        return JSON.parse(decoder.decode(line));
      }
      const chunk = await this.stream.read();
      if (!chunk) throw new Error('Browser stream ended');
      // Keep SDK chunks until a complete frame, then copy once. Repeatedly
      // concatenating an incomplete DOM snapshot would cause quadratic work.
      this.pending = chunk;
    }
  }

  async bytes(): Promise<Uint8Array | null> {
    if (this.pending.byteLength) {
      const bytes = this.pending; this.pending = new Uint8Array(0); return bytes;
    }
    return this.stream.read();
  }
}

async function writeBrowserBytes(stream: ByteStream, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const written = await stream.write(bytes.subarray(offset));
    if (!Number.isSafeInteger(written) || written <= 0 || written > bytes.byteLength - offset) throw new Error('Invalid browser stream write');
    offset += written;
  }
}

export type BrowserCarrierOptions = Readonly<{
  session: Session;
  view: string;
  controlToken: (message: ClientMessage) => string;
  onClose: (reason?: DisconnectReason) => void;
  download?: ProjectionConnection['download'];
  upload?: ProjectionConnection['upload'];
}>;

/** Borrows one existing environment Session. No transport acquisition, retry,
 * website fetch, WebSocket or RTC endpoint is owned by a browser window. */
export function createBrowserCarrier(options: BrowserCarrierOptions): ProjectionConnection {
  const messages = new Set<(message: ServerMessage) => void | Promise<void>>();
  const frames = new Set<(frame: MediaFrame) => void | Promise<void>>();
  const disconnected = new Set<(reason?: DisconnectReason) => void>();
  const streams = new Set<ByteStream>();
  let closed = false;
  let reason: DisconnectReason | undefined;
  let pendingBytes = 0;
  let pendingCommands = 0;
  let input: ByteStream | undefined;
  let writing = Promise.resolve();
  let resolveInput: (stream: ByteStream) => void = () => undefined;
  let rejectInput: (error: Error) => void = () => undefined;
  const inputReady = new Promise<ByteStream>((resolve, reject) => { resolveInput = resolve; rejectInput = reject; });
  void inputReady.catch(() => undefined);

  const retire = async (stream: ByteStream): Promise<void> => {
    if (!streams.delete(stream)) return;
    await stream.reset().catch(() => undefined);
    await stream.close().catch(() => undefined);
  };

  const end = (failure?: DisconnectReason): void => {
    if (closed) return;
    closed = true; reason = failure;
    rejectInput(new Error('Browser carrier closed'));
    for (const stream of streams) void retire(stream);
    options.onClose(failure);
    for (const listener of disconnected) listener(failure);
    messages.clear(); frames.clear(); disconnected.clear();
  };
  const open = async (kind: string): Promise<{ stream: ByteStream; reader: BrowserStreamReader }> => {
    const stream = await options.session.openStream(kind);
    if (closed) { await stream.reset(); await stream.close(); throw new Error('Browser carrier closed'); }
    streams.add(stream);
    try {
      await writeBrowserBytes(stream, encoder.encode(`${JSON.stringify({ view: options.view })}\n`));
      const reader = new BrowserStreamReader(stream);
      const admission = await reader.line(4096);
      if (!admission || typeof admission !== 'object' || (admission as { ok?: unknown }).ok !== true) throw new Error('Browser stream admission rejected');
      return { stream, reader };
    } catch (error) {
      await retire(stream);
      throw error;
    }
  };
  const publish = async (message: unknown): Promise<void> => {
    if (!message || typeof message !== 'object' || typeof (message as { type?: unknown }).type !== 'string') throw new Error('Invalid browser message');
    if (!closed) for (const listener of messages) await listener(message as ServerMessage);
  };
  const readMessages = async (reader: BrowserStreamReader, limit: number): Promise<void> => {
    while (!closed) await publish(await reader.line(limit));
  };
  const readMedia = async (): Promise<void> => {
    const { stream, reader } = await open(redevenV1StreamKinds.browser.media);
    try {
      const packets = new MediaPacketReader();
      let consumed = 0n;
      let acknowledged = 0n;
      while (!closed) {
        const chunk = await reader.bytes();
        if (!chunk) { packets.finish(); throw new Error('Browser media stream ended'); }
        for (const frame of packets.push(chunk)) {
          if (closed) return;
          for (const listener of frames) await listener(frame);
        }
        consumed += BigInt(chunk.byteLength);
        if (consumed > acknowledged) {
          const acknowledgement = new Uint8Array(8);
          new DataView(acknowledgement.buffer).setBigUint64(0, consumed);
          await writeBrowserBytes(stream, acknowledgement);
          acknowledged = consumed;
        }
      }
    } finally {
      await retire(stream);
    }
  };
  // Admit DOM first, so the independent helper lanes see the same observation
  // generation. All three read loops then run independently.
  void (async () => {
    const dom = await open(redevenV1StreamKinds.browser.dom);
    void readMessages(dom.reader, maxDOMMessage).catch(() => end('source_unavailable'));
    const control = await open(redevenV1StreamKinds.browser.input);
    input = control.stream; resolveInput(input);
    void readMessages(control.reader, 4096).catch(() => end('source_unavailable'));
    // Media loss ends only this carrier lane; source and control remain usable.
    void readMedia().catch(() => undefined);
  })().catch(() => end('source_unavailable'));

  return {
    ...(options.download ? { download: options.download } : {}),
    ...(options.upload ? { upload: options.upload } : {}),
    send(message) {
      if (closed) return;
      const body = encoder.encode(`${JSON.stringify({ token: options.controlToken(message), message })}\n`);
      if (body.byteLength > 70 * 1024 || pendingCommands >= 64 || pendingBytes + body.byteLength > 256 * 1024) { end('source_unavailable'); return; }
      pendingCommands++; pendingBytes += body.byteLength;
      writing = writing.then(async () => {
        const stream = input ?? await inputReady;
        if (!closed) await writeBrowserBytes(stream, body);
      }).catch(() => end('source_unavailable')).finally(() => { pendingCommands--; pendingBytes -= body.byteLength; });
    },
    subscribe(listener) { if (!closed) messages.add(listener); return () => messages.delete(listener); },
    subscribeMedia(listener) { if (!closed) frames.add(listener); return () => frames.delete(listener); },
    onDisconnect(listener) {
      if (closed) listener(reason); else disconnected.add(listener);
      return () => disconnected.delete(listener);
    },
    close() { end(); },
  };
}

/** File bytes have their own bounded lane. HTTP request preparation intentionally
 * buffers bodies, so it is not used for source file selection. */
export function createBrowserUpload(options: Readonly<{
  session: Session;
  view: string;
  token: (target: string) => string;
  signal: AbortSignal;
}>): NonNullable<ProjectionConnection['upload']> {
  return async (request, file, requestedSignal) => {
    const signal = AbortSignal.any([options.signal, requestedSignal]);
    signal.throwIfAborted();
    const token = options.token(request.target);
    if (!token || file.size > request.maxBytes) throw new Error('Browser upload unavailable');
    const stream = await options.session.openStream(redevenV1StreamKinds.browser.upload, { signal });
    const abort = () => { void stream.reset().catch(() => undefined); };
    signal.addEventListener('abort', abort, { once: true });
    let complete = false;
    try {
      signal.throwIfAborted();
      const metadata = { view: options.view, token, chooser: request.id, name: file.name, size: file.size, relativePath: file.webkitRelativePath || '' };
      await writeBrowserBytes(stream, encoder.encode(`${JSON.stringify(metadata)}\n`));
      const reader = new BrowserStreamReader(stream);
      const admitted = await reader.line(4096) as { ok?: unknown };
      if (admitted?.ok !== true) throw new Error('Browser upload unavailable');
      const source = file.stream().getReader();
      try {
        for (;;) {
          signal.throwIfAborted();
          const next = await source.read();
          if (next.done) break;
          for (let offset = 0; offset < next.value.byteLength; offset += 32 * 1024) {
            signal.throwIfAborted();
            await writeBrowserBytes(stream, next.value.subarray(offset, offset + 32 * 1024));
          }
        }
      } finally { await source.cancel().catch(() => undefined); source.releaseLock(); }
      const result = await reader.line(4096) as { ok?: unknown; id?: unknown };
      if (result?.ok !== true || typeof result.id !== 'string' || !result.id || result.id.length > 256) throw new Error('Browser upload unavailable');
      signal.throwIfAborted();
      await stream.closeWrite();
      complete = true;
      return result.id;
    } finally {
      signal.removeEventListener('abort', abort);
      if (!complete) await stream.reset().catch(() => undefined);
      await stream.close().catch(() => undefined);
    }
  };
}
