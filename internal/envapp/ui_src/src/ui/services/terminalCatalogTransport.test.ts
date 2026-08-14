import { describe, expect, it, vi } from 'vitest';

import { createRedevenTerminalCatalogTransport } from './terminalCatalogTransport';

describe('terminal catalog transport', () => {
  it('uses only session metadata RPCs and exposes no renderer or history operations', async () => {
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

    expect(rpc.terminal.createSession).toHaveBeenCalledWith({ name: 'name', workingDir: '/workspace' });
    expect(rpc.terminal.deleteSession).toHaveBeenCalledWith({ sessionId: 's2' });
    expect(Object.keys(transport).sort()).toEqual(['createSession', 'deleteSession', 'listSessions']);
  });
});
