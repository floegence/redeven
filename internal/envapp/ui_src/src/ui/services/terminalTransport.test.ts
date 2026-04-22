import { describe, expect, it, vi } from 'vitest';
import { ProtocolNotConnectedError, RpcError } from '@floegence/floe-webapp-protocol';

import {
  createRedevenTerminalTransport,
  isBestEffortTerminalDisconnectError,
} from './terminalTransport';

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
    const rpc = {
      terminal: {
        attach: vi.fn(),
        resize: vi.fn().mockRejectedValue(closedError),
        sendTextInput: vi.fn().mockRejectedValue(closedError),
        history: vi.fn(),
        clear: vi.fn(),
        listSessions: vi.fn(),
        createSession: vi.fn(),
        deleteSession: vi.fn(),
        getSessionStats: vi.fn(),
        onOutput: vi.fn(),
        onNameUpdate: vi.fn(),
      },
    } as any;
    const transport = createRedevenTerminalTransport(rpc, 'conn-1');

    await expect(transport.resize('session-1', 80, 24)).resolves.toBeUndefined();
    await expect(transport.sendInput('session-1', 'x')).resolves.toBeUndefined();
  });
});

