import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ProtocolNotConnectedError, RpcError } from '@floegence/floe-webapp-protocol';
import {
  StreamKind,
  TerminalLiveDecoder,
  TerminalLiveErrorCode,
  TerminalLiveServerError,
  decodeAttach,
  decodeActivate,
  decodeInput,
  decodeInputIntent,
  decodeResize,
  encodeActivated,
  encodeAttached,
  encodeControllerChanged,
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

  async close(): Promise<void> { this.push(null); }
  async reset(): Promise<void> { this.push(null); }

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

const semanticFrame = {
  width: 80,
  height: 24,
  bufferKind: 'normal',
  rows: Array.from({ length: 24 }, () => ({ cells: Array.from({ length: 80 }, () => ({ text: '', width: 1 })) })),
  cursor: { x: 0, y: 0, visible: true, shape: 'block', blinking: false },
  history: { revision: 1, totalRows: 24, screenStartOffset: 0 },
  graphics: { generation: 0, images: [], placements: [] },
};

const historyPayload = new TextEncoder().encode(JSON.stringify({
  v: 1,
  frame: {
    width: semanticFrame.width,
    height: semanticFrame.height,
    bufferKind: semanticFrame.bufferKind,
    cursor: semanticFrame.cursor,
    history: semanticFrame.history,
    graphics: semanticFrame.graphics,
    styles: [['default', 'default', false, false, false, false]],
    rows: semanticFrame.rows.map((row) => row.cells.map((cell) => [cell.text, cell.width, 0, null])),
  },
}));
const historyPayloadSHA256 = createHash('sha256').update(historyPayload).digest('hex');

function semanticHistoryChunk(transportGeneration = 1) {
  return {
    snapshotId: 'snapshot',
    chunkIndex: 0,
    chunkCount: 1,
    payloadBytes: historyPayload.byteLength,
    payloadSha256: historyPayloadSHA256,
    payload: Buffer.from(historyPayload).toString('base64'),
    revision: 1,
    transportGeneration,
    contentEpoch: 0,
    geometryGeneration: 1,
    cols: 80,
    rows: 24,
    anchor: 'anchor',
    firstAvailable: 'first',
    lastAvailable: 'last',
    screenStart: 'screen',
    offset: 0,
    totalRows: 24,
    screenStartOffset: 0,
    hasPrevious: false,
    hasNext: false,
  };
}

const createRpcMock = () => {
  let nameHandler: ((event: any) => void) | undefined;
  const terminal = {
    semanticHistory: vi.fn().mockImplementation(async (request) => (
      semanticHistoryChunk(request.transportGeneration)
    )),
    semanticClear: vi.fn().mockResolvedValue({ presentationSequence: 3, contentEpoch: 2 }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    createSession: vi.fn(),
    deleteSession: vi.fn().mockResolvedValue({ ok: true }),
    onNameUpdate: vi.fn((handler) => {
      nameHandler = handler;
      return () => { nameHandler = undefined; };
    }),
    onForegroundCommandUpdate: vi.fn(() => () => undefined),
    onOutputActivityUpdate: vi.fn(() => () => undefined),
    onExecutionContextUpdate: vi.fn(() => () => undefined),
    onWorkStateUpdate: vi.fn(() => () => undefined),
  };
  return {
    rpc: { terminal } as any,
    emitName: (event: any) => nameHandler?.(event),
  };
};

async function attach(bundle: ReturnType<typeof createRedevenTerminalLiveBundle>, stream: FakeStream) {
  const attaching = bundle.transport.attachWithPresentation('session-1', 80, 24);
  await waitUntil(() => stream.writes.length === 1);
  stream.push(encodeAttached({
    presentationSequence: 1n,
    geometryGeneration: 1n,
    controllerEpoch: 1n,
    cols: 80,
    rows: 24,
    isController: true,
  }));
  return await attaching;
}

describe('terminal semantic live transport', () => {
  it('uses only terminal/live_v1 for attach, input, and canonical resize settlement', async () => {
    const { rpc } = createRpcMock();
    const stream = new FakeStream();
    const openStream = vi.fn().mockResolvedValue(stream);
    const bundle = createRedevenTerminalLiveBundle(rpc, () => ({ openStream } as any), 'connection-1');
    const lifecycle: unknown[] = [];
    bundle.eventSource.onTerminalLiveAttachmentLifecycle('session-1', event => lifecycle.push(event));

    const attaching = bundle.transport.attachWithPresentation('session-1', 80, 24);
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
      presentationSequence: 1n,
      geometryGeneration: 1n,
      controllerEpoch: 1n,
      cols: 80,
      rows: 24,
      isController: true,
    }));
    await expect(attaching).resolves.toEqual({
      presentationSequence: 1,
      geometryGeneration: 1,
      runtimeAttachGeneration: 1,
      controllerEpoch: 1,
      cols: 80,
      rows: 24,
      isController: true,
    });

    await bundle.transport.sendInput('session-1', 'aa');
    const input = decodeInput(decodeSingleWrite(stream.writes[1]!));
    expect(input.sequence).toBe(1n);
    expect(new TextDecoder().decode(input.data)).toBe('aa');

    await bundle.transport.sendInputIntent('session-1', {
      kind: 'key',
      code: 'ArrowLeft',
      text: '',
      action: 'press',
      modifiers: {
        shift: true,
        control: true,
        alt: false,
        super: false,
        capsLock: false,
        numLock: true,
      },
    });
    expect(decodeInputIntent(decodeSingleWrite(stream.writes[2]!))).toEqual({
      sequence: 2n,
      code: 'ArrowLeft',
      text: '',
      action: 'press',
      modifiers: 35,
    });

    const resizing = bundle.transport.resizeWithEffectiveGeometry('session-1', 100, 30);
    await waitUntil(() => stream.writes.length === 4);
    const resize = decodeResize(decodeSingleWrite(stream.writes[3]!));
    stream.push(encodeResizeApplied({
      sequence: resize.sequence,
      geometryGeneration: 2n,
      presentationSequence: 4n,
      cols: 100,
      rows: 30,
    }));
    await expect(resizing).resolves.toEqual({
      runtimeAttachGeneration: 1,
      requested: { cols: 100, rows: 30 },
      effective: { generation: 2, presentationSequence: 4, cols: 100, rows: 30 },
    });
    expect(lifecycle).toEqual([{
      sessionId: 'session-1',
      runtimeAttachGeneration: 1,
      state: 'attached',
    }]);
  });

  it('activates an observer with its measured geometry before controller input', async () => {
    const { rpc } = createRpcMock();
    const stream = new FakeStream();
    const bundle = createRedevenTerminalLiveBundle(
      rpc,
      () => ({ openStream: vi.fn().mockResolvedValue(stream) } as any),
      'connection-1',
    );
    const controllers: unknown[] = [];
    bundle.eventSource.onTerminalController('session-1', event => controllers.push(event));

    const attaching = bundle.transport.attachWithPresentation('session-1', 46, 16);
    await waitUntil(() => stream.writes.length === 1);
    stream.push(encodeAttached({
      presentationSequence: 1n,
      geometryGeneration: 1n,
      controllerEpoch: 7n,
      cols: 46,
      rows: 16,
      isController: false,
    }));
    await expect(attaching).resolves.toEqual({
      presentationSequence: 1,
      geometryGeneration: 1,
      runtimeAttachGeneration: 1,
      controllerEpoch: 7,
      cols: 46,
      rows: 16,
      isController: false,
    });
    expect(controllers).toEqual([{
      sessionId: 'session-1',
      epoch: 7,
      isController: false,
    }]);

    const activating = bundle.transport.activate('session-1', 120, 40);
    await waitUntil(() => stream.writes.length === 2);
    const activation = decodeActivate(decodeSingleWrite(stream.writes[1]!));
    expect(activation).toEqual({
      sequence: 1n,
      controllerEpoch: 7n,
      cols: 120,
      rows: 40,
    });
    stream.push(encodeActivated({
      sequence: activation.sequence,
      controllerEpoch: 8n,
      geometryGeneration: 2n,
      presentationSequence: 3n,
      cols: 120,
      rows: 40,
    }));
    await expect(activating).resolves.toEqual({
      runtimeAttachGeneration: 1,
      requested: { cols: 120, rows: 40 },
      effective: { generation: 2, presentationSequence: 3, cols: 120, rows: 40 },
      controller: { epoch: 8, isController: true },
    });
    expect(controllers.at(-1)).toEqual({
      sessionId: 'session-1',
      epoch: 8,
      isController: true,
    });

    stream.push(encodeControllerChanged({ epoch: 9n, isController: false }));
    await waitUntil(() => controllers.length === 3);
    expect(controllers.at(-1)).toEqual({
      sessionId: 'session-1',
      epoch: 9,
      isController: false,
    });
  });

  it('binds semantic history and clear RPCs to the current connection generation', async () => {
    const { rpc } = createRpcMock();
    const stream = new FakeStream();
    const bundle = createRedevenTerminalLiveBundle(
      rpc,
      () => ({ openStream: vi.fn().mockResolvedValue(stream) } as any),
      'connection-1',
    );
    await attach(bundle, stream);

    await bundle.transport.semanticHistory('session-1', { direction: 'end', viewportRows: 24 });
    expect(rpc.terminal.semanticHistory).toHaveBeenCalledWith({
      sessionId: 'session-1',
      connectionId: 'connection-1',
      transportGeneration: 1,
      lane: 'viewport',
      direction: 'end',
      viewportRows: 24,
    });
    await expect(bundle.transport.clearSemanticContent?.('session-1')).resolves.toEqual({
      presentationSequence: 3,
      contentEpoch: 2,
    });
    expect(rpc.terminal.semanticClear).toHaveBeenCalledWith({
      sessionId: 'session-1',
      connectionId: 'connection-1',
      transportGeneration: 1,
    });
  });

  it('validates semantic history only at the lazy live-feature boundary', async () => {
    const { rpc } = createRpcMock();
    rpc.terminal.semanticHistory.mockResolvedValueOnce({ revision: 1, frame: null });
    const stream = new FakeStream();
    const bundle = createRedevenTerminalLiveBundle(
      rpc,
      () => ({ openStream: vi.fn().mockResolvedValue(stream) } as any),
      'connection-1',
    );
    await attach(bundle, stream);

    await expect(bundle.transport.semanticHistory('session-1', {
      direction: 'end',
      viewportRows: 24,
    })).rejects.toThrow();
  });

  it('forwards view-neutral metadata events without a terminal parser', () => {
    const { rpc, emitName } = createRpcMock();
    const bundle = createRedevenTerminalLiveBundle(rpc, () => null, 'connection-1');
    const names: unknown[] = [];
    bundle.eventSource.onTerminalNameUpdate?.('session-1', event => names.push(event));
    emitName({ sessionId: 'other', newName: 'ignored', workingDir: '/', localPathCapability: null });
    emitName({
      sessionId: 'session-1',
      newName: 'shell',
      workingDir: '/workspace',
      localPathCapability: { workingDir: '/workspace' },
    });
    expect(names).toEqual([expect.objectContaining({ sessionId: 'session-1', newName: 'shell' })]);
  });

  it('requires a connected client and classifies only explicit lifecycle exits', async () => {
    const { rpc } = createRpcMock();
    const bundle = createRedevenTerminalLiveBundle(rpc, () => null, 'connection-1');
    await expect(bundle.transport.attach('session-1', 80, 24)).rejects.toBeInstanceOf(ProtocolNotConnectedError);
    expect(isBestEffortTerminalDisconnectError(new ProtocolNotConnectedError())).toBe(true);
    expect(classifyTerminalAttachLifecycleExit(new TerminalLiveServerError(
      TerminalLiveErrorCode.SessionNotFound,
      'terminal session not found',
    ))).toBe('session_gone');
    expect(classifyTerminalAttachLifecycleExit(new RpcError({ typeId: 2007, code: 409 }))).toBeNull();
  });

  it('allocates a distinct live connection identity for every terminal view', () => {
    expect(createTerminalConnId()).not.toBe(createTerminalConnId());
  });
});
