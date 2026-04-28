import { describe, expect, it, vi } from 'vitest';
import { ProtocolNotConnectedError, RpcError } from '@floegence/floe-webapp-protocol';

import {
  createRedevenTerminalTransport,
  isBestEffortTerminalDisconnectError,
} from './terminalTransport';

function createRpcMock(overrides: Partial<Record<string, any>> = {}) {
  return {
    terminal: {
      attach: vi.fn(),
      resize: vi.fn().mockResolvedValue(undefined),
      sendTextInput: vi.fn().mockResolvedValue(undefined),
      history: vi.fn(),
      clear: vi.fn(),
      listSessions: vi.fn(),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
      getSessionStats: vi.fn(),
      onOutput: vi.fn(),
      onNameUpdate: vi.fn(),
      ...overrides,
    },
  } as any;
}

function nextTimer(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('terminalTransport', () => {
  it('classifies closed transport errors as best-effort terminal disconnects', () => {
    expect(isBestEffortTerminalDisconnectError(new ProtocolNotConnectedError())).toBe(true);
    expect(isBestEffortTerminalDisconnectError(new RpcError({
      typeId: 2005,
      code: -1,
      message: 'RPC notify transport error',
      cause: new Error('rpc client closed'),
    }))).toBe(true);
    expect(isBestEffortTerminalDisconnectError(new RpcError({
      typeId: 2005,
      code: 500,
      message: 'resize failed',
    }))).toBe(false);
  });

  it('suppresses resize and input notify errors after the RPC client closes', async () => {
    const closedError = new RpcError({
      typeId: 2005,
      code: -1,
      message: 'RPC notify transport error',
      cause: new Error('rpc client closed'),
    });
    const rpc = createRpcMock({
      resize: vi.fn().mockRejectedValue(closedError),
      sendTextInput: vi.fn().mockRejectedValue(closedError),
    });
    const transport = createRedevenTerminalTransport(rpc, 'conn-1');

    await expect(transport.resize('session-1', 80, 24)).resolves.toBeUndefined();
    await expect(transport.sendInput('session-1', 'x')).resolves.toBeUndefined();
  });

  it('coalesces same-frame terminal resize notifications to the latest dimensions', async () => {
    const rpc = createRpcMock();
    const transport = createRedevenTerminalTransport(rpc, 'conn-1');

    const first = transport.resize('session-1', 80, 24);
    const second = transport.resize('session-1', 101.8, 31.2);

    await Promise.all([first, second]);

    expect(rpc.terminal.resize).toHaveBeenCalledTimes(1);
    expect(rpc.terminal.resize).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      connId: 'conn-1',
      cols: 101,
      rows: 31,
    });

    await transport.resize('session-1', 101, 31);

    expect(rpc.terminal.resize).toHaveBeenCalledTimes(1);
  });

  it('serializes in-flight terminal resize notifications and keeps only the newest pending size', async () => {
    let releaseFirstResize!: () => void;
    const firstResize = new Promise<void>((resolve) => {
      releaseFirstResize = resolve;
    });
    const rpc = createRpcMock({
      resize: vi.fn()
        .mockImplementationOnce(() => firstResize)
        .mockResolvedValue(undefined),
    });
    const transport = createRedevenTerminalTransport(rpc, 'conn-1');

    const first = transport.resize('session-1', 80, 24);
    await nextTimer();

    expect(rpc.terminal.resize).toHaveBeenCalledTimes(1);

    const second = transport.resize('session-1', 90, 24);
    const third = transport.resize('session-1', 100, 30);
    await nextTimer();

    expect(rpc.terminal.resize).toHaveBeenCalledTimes(1);

    releaseFirstResize();
    await first;
    await Promise.all([second, third]);

    expect(rpc.terminal.resize).toHaveBeenCalledTimes(2);
    expect(rpc.terminal.resize).toHaveBeenLastCalledWith({
      sessionId: 'session-1',
      connId: 'conn-1',
      cols: 100,
      rows: 30,
    });
  });

  it('requests bounded terminal history pages with cursor metadata', async () => {
    const chunk = { sequence: 2, timestampMs: 10, data: new Uint8Array([1, 2, 3]) };
    const rpc = createRpcMock({
      history: vi.fn().mockResolvedValue({
        chunks: [chunk],
        nextStartSeq: 3,
        hasMore: true,
        firstSequence: 2,
        lastSequence: 2,
        coveredBytes: 3,
        totalBytes: 9,
      }),
    });
    const transport = createRedevenTerminalTransport(rpc, 'conn-1');

    const page = await transport.historyPage('session-1', 2, -1, {
      limitChunks: 10,
      maxBytes: 1024,
    });

    expect(rpc.terminal.history).toHaveBeenCalledWith({
      sessionId: 'session-1',
      startSeq: 2,
      endSeq: -1,
      limitChunks: 10,
      maxBytes: 1024,
    });
    expect(page).toEqual({
      chunks: [chunk],
      nextStartSeq: 3,
      hasMore: true,
      firstSequence: 2,
      lastSequence: 2,
      coveredBytes: 3,
      totalBytes: 9,
    });
  });

  it('drains legacy terminal history through bounded pages', async () => {
    const first = { sequence: 1, timestampMs: 10, data: new Uint8Array([1]) };
    const second = { sequence: 2, timestampMs: 20, data: new Uint8Array([2]) };
    const rpc = createRpcMock({
      history: vi.fn()
        .mockResolvedValueOnce({
          chunks: [first],
          nextStartSeq: 2,
          hasMore: true,
          firstSequence: 1,
          lastSequence: 1,
          coveredBytes: 1,
          totalBytes: 2,
        })
        .mockResolvedValueOnce({
          chunks: [second],
          nextStartSeq: 0,
          hasMore: false,
          firstSequence: 2,
          lastSequence: 2,
          coveredBytes: 1,
          totalBytes: 2,
        }),
    });
    const transport = createRedevenTerminalTransport(rpc, 'conn-1');

    await expect(transport.history('session-1', 0, -1)).resolves.toEqual([first, second]);
    expect(rpc.terminal.history).toHaveBeenNthCalledWith(1, expect.objectContaining({
      sessionId: 'session-1',
      startSeq: 0,
      endSeq: -1,
    }));
    expect(rpc.terminal.history).toHaveBeenNthCalledWith(2, expect.objectContaining({
      sessionId: 'session-1',
      startSeq: 2,
      endSeq: -1,
    }));
  });
});
