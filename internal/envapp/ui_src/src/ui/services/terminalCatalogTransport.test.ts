import { describe, expect, it, vi } from 'vitest';

vi.mock('@floegence/floeterm-terminal-web', () => ({}));
vi.mock('@floegence/floe-webapp-protocol', () => ({
  ProtocolNotConnectedError: class extends Error {},
  RpcError: class extends Error {},
}));

import {
  createRedevenPagedHistoryFetcher,
  createRedevenTerminalCatalogTransport,
} from './terminalCatalogTransport';

describe('terminal catalog transport', () => {
  it('only uses directory RPCs and never allocates renderer operations', async () => {
    const rpc = {
      terminal: {
        listSessions: vi.fn().mockResolvedValue({ sessions: [{ id: 's1' }] }),
        createSession: vi.fn().mockResolvedValue({ session: { id: 's2' } }),
        deleteSession: vi.fn().mockResolvedValue(undefined),
      },
    } as any;
    const transport = createRedevenTerminalCatalogTransport(rpc);
    await expect(transport.listSessions?.()).resolves.toEqual([{ id: 's1' }]);
    await expect(transport.createSession?.('name', '/workspace')).resolves.toEqual({ id: 's2' });
    await transport.deleteSession?.('s2');
    expect(rpc.terminal.listSessions).toHaveBeenCalledTimes(1);
    expect(rpc.terminal.createSession).toHaveBeenCalledWith({ name: 'name', workingDir: '/workspace' });
    expect(rpc.terminal.deleteSession).toHaveBeenCalledWith({ sessionId: 's2' });
  });

  it('forwards paged history fences, cursors, byte limits, and cancellation', async () => {
    const history = vi.fn().mockResolvedValue({
      chunks: [],
      hasMore: false,
      firstSequence: 4,
      lastSequence: 8,
      coveredThroughSequence: 8,
      historyGeneration: 3,
      snapshotEndSequence: 8,
      firstRetainedSequence: 4,
      coveredBytes: 12,
      totalBytes: 12,
    });
    const fetchPage = createRedevenPagedHistoryFetcher({ terminal: { history } } as any, 's1');
    const controller = new AbortController();
    await expect(fetchPage({
      startSequence: 4,
      endSequence: 8,
      historyGeneration: 3,
      cursor: 'cursor-1',
      maxBytes: 1024,
      signal: controller.signal,
    })).resolves.toMatchObject({ coveredThroughSequence: 8, historyGeneration: 3 });
    expect(history).toHaveBeenCalledWith({
      sessionId: 's1',
      startSeq: 4,
      endSeq: 8,
      historyGeneration: 3,
      limitChunks: 2048,
      maxBytes: 1024,
    });
    controller.abort();
    await expect(fetchPage({ startSequence: 0, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
