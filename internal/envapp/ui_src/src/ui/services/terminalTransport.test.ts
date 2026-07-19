import { describe, expect, it, vi } from 'vitest';
import { ProtocolNotConnectedError, RpcError } from '@floegence/floe-webapp-protocol';
import {
  StreamKind,
  TerminalLiveDecoder,
  TerminalLiveErrorCode,
  TerminalLiveServerError,
  decodeAttach,
  decodeInput,
  decodeResize,
  encodeAttached,
  encodeResizeApplied,
  type TerminalByteStream,
} from '@floegence/floeterm-terminal-web/live';

import {
  classifyTerminalAttachLifecycleExit,
  createTerminalConnId,
  createRedevenTerminalLiveBundle,
  isBestEffortTerminalDisconnectError,
} from './terminalTransport';

class FakeStream implements TerminalByteStream {
  readonly writes: Uint8Array[] = [];
  private readonly reads: Array<Uint8Array | null> = [];
  private readonly waiters: Array<(value: Uint8Array | null) => void> = [];

  async read(): Promise<Uint8Array | null> {
    if (this.reads.length > 0) return this.reads.shift() ?? null;
    return await new Promise(resolve => this.waiters.push(resolve));
  }

  async write(data: Uint8Array): Promise<void> {
    this.writes.push(data.slice());
  }

  async close(): Promise<void> {
    this.push(null);
  }

  async reset(): Promise<void> {
    this.push(null);
  }

  push(data: Uint8Array | null): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(data);
    else this.reads.push(data);
  }
}

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition was not reached');
};

const decodeSingleWrite = (data: Uint8Array) => {
  const frames = new TerminalLiveDecoder().push(data);
  expect(frames).toHaveLength(1);
  return frames[0]!;
};

const createRpcMock = () => {
  let nameHandler: ((event: { sessionId: string; newName: string; workingDir: string }) => void) | undefined;
  const terminal = {
    history: vi.fn().mockResolvedValue({
      chunks: [],
      nextStartSeq: 0,
      hasMore: false,
      firstSequence: 0,
      lastSequence: 0,
      coveredThroughSequence: 4,
      snapshotEndSequence: 4,
      firstRetainedSequence: 1,
      historyGeneration: 2,
      historyReset: false,
      historyTruncated: false,
      coveredBytes: 0,
      totalBytes: 0,
    }),
    clear: vi.fn().mockResolvedValue({ ok: true }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    createSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue({ ok: true }),
    getSessionStats: vi.fn().mockResolvedValue({ history: { totalBytes: 12 } }),
    onNameUpdate: vi.fn((handler) => {
      nameHandler = handler;
      return () => { nameHandler = undefined; };
    }),
  };
  return {
    rpc: { terminal } as any,
    emitName: (event: { sessionId: string; newName: string; workingDir: string }) => nameHandler?.(event),
  };
};

describe('terminal live transport', () => {
  it('uses only the terminal/live_v1 stream for attach, input, and resize', async () => {
    const { rpc } = createRpcMock();
    const stream = new FakeStream();
    const openStream = vi.fn().mockResolvedValue(stream);
    const bundle = createRedevenTerminalLiveBundle(rpc, () => ({ openStream } as any), 'connection-1');

    const attaching = bundle.transport.attachWithHistoryBoundary('session-1', 80, 24);
    await waitUntil(() => stream.writes.length === 1);
    expect(openStream).toHaveBeenCalledWith(StreamKind, undefined);
    expect(decodeAttach(decodeSingleWrite(stream.writes[0]!))).toEqual({
      sessionId: 'session-1',
      connectionId: 'connection-1',
      attachGeneration: 1n,
      cols: 80,
      rows: 24,
    });

    stream.push(encodeAttached({
      historyBoundarySequence: 4n,
      historyGeneration: 2n,
      historyStartSequence: 1n,
      geometryGeneration: 1n,
      cols: 80,
      rows: 24,
    }));
    await expect(attaching).resolves.toMatchObject({
      historyBoundarySequence: 4,
      historyGeneration: 2,
      historyStartSequence: 1,
      geometryGeneration: 1,
    });

    await bundle.transport.sendInput('session-1', 'aa');
    const input = decodeInput(decodeSingleWrite(stream.writes[1]!));
    expect(input.sequence).toBe(1n);
    expect(new TextDecoder().decode(input.data)).toBe('aa');

    const resizing = bundle.transport.resize('session-1', 100, 30);
    await waitUntil(() => stream.writes.length === 3);
    const resize = decodeResize(decodeSingleWrite(stream.writes[2]!));
    expect(resize).toEqual({ sequence: 1n, cols: 100, rows: 30 });
    stream.push(encodeResizeApplied({
      sequence: resize.sequence,
      geometryGeneration: 2n,
      outputSequenceBoundary: 4n,
      cols: 100,
      rows: 30,
    }));
    await resizing;
  });

  it('keeps history and name updates on the RPC control plane', async () => {
    const { rpc, emitName } = createRpcMock();
    const bundle = createRedevenTerminalLiveBundle(rpc, () => null, 'connection-1');
    const names: unknown[] = [];
    const unsubscribe = bundle.eventSource.onTerminalNameUpdate?.('session-1', event => names.push(event));

    const page = await bundle.transport.historyPage('session-1', 1, 4, {
      historyGeneration: 2,
      snapshotEndSequence: 4,
    });
    expect(rpc.terminal.history).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      startSeq: 1,
      endSeq: 4,
      historyGeneration: 2,
    }));
    expect(page).toMatchObject({ coveredThroughSequence: 4, historyGeneration: 2 });

    emitName({ sessionId: 'other', newName: 'ignored', workingDir: '/' });
    emitName({ sessionId: 'session-1', newName: 'shell', workingDir: '/workspace' });
    expect(names).toEqual([{
      sessionId: 'session-1',
      newName: 'shell',
      workingDir: '/workspace',
    }]);
    unsubscribe?.();
  });

  it('requires a connected Flowersec client instead of falling back to RPC live calls', async () => {
    const { rpc } = createRpcMock();
    const bundle = createRedevenTerminalLiveBundle(rpc, () => null, 'connection-1');
    await expect(bundle.transport.attach('session-1', 80, 24)).rejects.toBeInstanceOf(ProtocolNotConnectedError);
  });

  it('classifies explicit attach lifecycle exits', () => {
    expect(isBestEffortTerminalDisconnectError(new ProtocolNotConnectedError())).toBe(true);
    expect(classifyTerminalAttachLifecycleExit(new TerminalLiveServerError(
      TerminalLiveErrorCode.SessionNotFound,
      'terminal session not found',
    ))).toBe('session_gone');
    expect(classifyTerminalAttachLifecycleExit(new RpcError({ typeId: 2007, code: 404 }))).toBe('session_gone');
    expect(classifyTerminalAttachLifecycleExit(new RpcError({ typeId: 2007, code: 409 }))).toBeNull();
    expect(classifyTerminalAttachLifecycleExit(new RpcError({ typeId: 2007, code: 410 }))).toBeNull();
    expect(classifyTerminalAttachLifecycleExit(new RpcError({ typeId: 2007, code: 500 }))).toBeNull();
  });

  it('allocates a distinct live connection identity for every terminal view', () => {
    expect(createTerminalConnId()).not.toBe(createTerminalConnId());
  });
});
