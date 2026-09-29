// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ByteStream, Session } from '@floegence/flowersec-core';
import { encodeMediaFrame, type MediaFrame } from '@floegence/floebrowser/media';
import type { ClientMessage, ServerMessage } from '@floegence/floebrowser/protocol';
import { createBrowserCarrier, createBrowserUpload } from './browserTransport';
import { redevenV1StreamKinds } from '../protocol/redeven_v1/streamKinds';

const encoder = new TextEncoder();
class BrowserTestStream implements ByteStream {
  writeLimit = Number.POSITIVE_INFINITY;
  readonly terminalError = undefined;
  readonly writes: Uint8Array[] = [];
  readonly reset = vi.fn(async () => { this.push(null); });
  readonly close = vi.fn(async () => { this.push(null); });
  readonly closeWrite = vi.fn(async () => undefined);
  private queue: Array<Uint8Array | null>;
  private waiting: ((bytes: Uint8Array | null) => void) | undefined;
  constructor(readonly kind: string, admissionChunks: Uint8Array[] = [encoder.encode('{"ok":true}\n')]) {
    this.queue = [...admissionChunks];
  }
  async read(): Promise<Uint8Array | null> {
    if (this.queue.length) return this.queue.shift()!;
    return new Promise(resolve => { this.waiting = resolve; });
  }
  async write(bytes: Uint8Array): Promise<number> { const accepted = bytes.subarray(0, this.writeLimit); this.writes.push(accepted.slice()); return accepted.byteLength; }
  push(bytes: Uint8Array | null): void {
    if (this.waiting) { const waiting = this.waiting; this.waiting = undefined; waiting(bytes); }
    else this.queue.push(bytes);
  }
}

function fixture(admissionChunks?: Uint8Array[]) {
  const streams = Object.fromEntries(Object.values(redevenV1StreamKinds.browser).map(kind => [kind, new BrowserTestStream(kind, admissionChunks)]));
  const openStream = vi.fn(async (kind: string) => streams[kind]!);
  const closed = vi.fn();
  const carrier = createBrowserCarrier({ session: { openStream } as unknown as Session, view: 'view', controlToken: () => 'current-token', onClose: closed });
  return { carrier, openStream, closed, dom: streams[redevenV1StreamKinds.browser.dom]!, input: streams[redevenV1StreamKinds.browser.input]!, media: streams[redevenV1StreamKinds.browser.media]! };
}

const command: ClientMessage = { type: 'command', id: 1, tab: 'target', epoch: 'epoch', action: { kind: 'text', text: 'input' } };
const packet = () => encodeMediaFrame({ version: 1, target: 'target', view: 'media-view', stream: 'video', node: 1, track: 'video', codec: 'vp8', timestamp_us: 0, duration_us: 33333, keyframe: true, width: 16, height: 16, bytes: 3 }, new Uint8Array([1, 2, 3]));

describe('browser carrier', () => {
  it('reports transport loss without claiming that the native page closed', async () => {
    const state = fixture();
    await vi.waitFor(() => expect(state.openStream).toHaveBeenCalledTimes(3));
    state.dom.push(null);
    await vi.waitFor(() => expect(state.closed).toHaveBeenCalledOnce());
    expect(state.closed).toHaveBeenCalledWith(undefined, false);
  });

  it('accepts admission frames split across Flowersec chunks', async () => {
    const state = fixture([encoder.encode('{"ok'), encoder.encode('":true}\n')]);

    await vi.waitFor(() => expect(state.openStream).toHaveBeenCalledTimes(3));
    expect(state.closed).not.toHaveBeenCalled();
    state.carrier.close();
  });

  it('returns media credit only after child consumption while input remains independent', async () => {
    const state = fixture();
    let release!: () => void;
    const received = vi.fn(async () => new Promise<void>(resolve => { release = resolve; }));
    state.carrier.subscribeMedia!(received);
    await vi.waitFor(() => expect(state.openStream).toHaveBeenCalledTimes(3));
    state.media.push(packet());
    await vi.waitFor(() => expect(received).toHaveBeenCalledTimes(1));
    expect(state.media.writes).toHaveLength(1);
    state.carrier.send(command);
    await vi.waitFor(() => expect(state.input.writes).toHaveLength(2));
    release();
    await vi.waitFor(() => expect(state.media.writes).toHaveLength(2));
    state.carrier.close();
  });
  it('streams selected file bytes in bounded writes and handles partial stream writes', async () => {
    const stream = new BrowserTestStream(redevenV1StreamKinds.browser.upload);
    stream.writeLimit = 7000;
    stream.push(encoder.encode('{"ok":true,"id":"staged-file"}\n'));
    const openStream = vi.fn(async () => stream);
    const upload = createBrowserUpload({ session: { openStream } as unknown as Session, view: 'view', token: target => target === 'page' ? 'token' : '', signal: new AbortController().signal });
    const bytes = new Uint8Array(100000).fill(12);
    const file = new File([bytes], 'binary.bin');
    const result = await upload({ id: 'chooser', target: 'page', url: 'https://source.invalid/', multiple: false, directory: false, accept: '', maxBytes: 100000, maxFiles: 1 }, file, new AbortController().signal);
    expect(result).toBe('staged-file');
    expect(openStream).toHaveBeenCalledTimes(1);
    expect(stream.reset).not.toHaveBeenCalled();
    expect(stream.closeWrite).toHaveBeenCalledTimes(1);
    expect(stream.writes.every(bytes => bytes.byteLength <= 7000)).toBe(true);
    const output = Buffer.concat(stream.writes);
    const newline = output.indexOf(10);
    expect(JSON.parse(output.subarray(0, newline).toString())).toMatchObject({ view: 'view', token: 'token', chooser: 'chooser', name: 'binary.bin', size: 100000 });
    expect(output.subarray(newline + 1)).toEqual(Buffer.from(bytes));
  });

  it('borrows one session, keeps input independent, and acknowledges consumed chunks without delivering incomplete frames', async () => {
    const state = fixture();
    const messages: ServerMessage[] = [], frames: MediaFrame[] = [];
    state.carrier.subscribe(message => { messages.push(message); });
    state.carrier.subscribeMedia!(frame => { frames.push(frame); });
    await vi.waitFor(() => expect(state.openStream).toHaveBeenCalledTimes(3));
    expect(state.openStream.mock.calls.map(([kind]) => kind)).toEqual([redevenV1StreamKinds.browser.dom, redevenV1StreamKinds.browser.input, redevenV1StreamKinds.browser.media]);
    state.carrier.send(command);
    await vi.waitFor(() => expect(state.input.writes).toHaveLength(2));
    expect(JSON.parse(new TextDecoder().decode(state.input.writes[1]))).toEqual({ token: 'current-token', message: command });
    state.input.push(encoder.encode('{"type":"ack","id":1,"ok":false,"code":"not_allowed"}\n'));
    await vi.waitFor(() => expect(messages).toHaveLength(1));
    const media = packet();
    state.media.push(media.subarray(0, 7));
    await vi.waitFor(() => expect(state.media.writes).toHaveLength(2));
    expect(new DataView(state.media.writes[1]!.buffer).getBigUint64(0)).toBe(7n);
    expect(frames).toHaveLength(0);
    state.media.push(media.subarray(7));
    await vi.waitFor(() => expect(state.media.writes).toHaveLength(3));
    expect(frames).toHaveLength(1);
    expect(new DataView(state.media.writes[2]!.buffer).getBigUint64(0)).toBe(BigInt(media.byteLength));
    state.media.push(media.subarray(0, 7));
    await vi.waitFor(() => expect(state.media.writes).toHaveLength(4));
    expect(new DataView(state.media.writes[3]!.buffer).getBigUint64(0)).toBe(BigInt(media.byteLength + 7));
    expect(frames).toHaveLength(1);
    state.carrier.close();
    await vi.waitFor(() => expect(state.closed).toHaveBeenCalledTimes(1));
    expect(state.dom.reset).toHaveBeenCalledTimes(1);
    expect(state.input.reset).toHaveBeenCalledTimes(1);
  });

  it.each(['end', 'malformed'])('closes only media after %s and never reacquires the environment', async (failure) => {
    const { carrier, openStream, closed, media, input } = fixture();
    await vi.waitFor(() => expect(openStream).toHaveBeenCalledTimes(3));
    media.push(failure === 'end' ? null : new Uint8Array([255, 255, 255, 255]));
    await vi.waitFor(() => expect(media.close).toHaveBeenCalledTimes(1));
    expect(closed).not.toHaveBeenCalled();
    carrier.send(command);
    await vi.waitFor(() => expect(input.writes).toHaveLength(2));
    expect(openStream).toHaveBeenCalledTimes(3);
    carrier.close();
  });

  it('fences startup queue overflow and oversized DOM without replaying input', async () => {
    const first = fixture();
    for (let index = 0; index < 65; index++) first.carrier.send({ ...command, id: index });
    await vi.waitFor(() => expect(first.closed).toHaveBeenCalledTimes(1));
    expect(first.input.writes).toHaveLength(0);
    const second = fixture();
    await vi.waitFor(() => expect(second.openStream).toHaveBeenCalledTimes(3));
    second.dom.push(new Uint8Array(16 * 1024 * 1024 + 1).fill(32));
    await vi.waitFor(() => expect(second.closed).toHaveBeenCalledTimes(1));
    second.carrier.send(command);
    expect(second.input.writes).toHaveLength(1);
    expect(second.openStream).toHaveBeenCalledTimes(3);
  });
});
