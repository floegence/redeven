import { describe, expect, it, vi } from 'vitest';

import { createRedevenTerminalCatalogTransport } from './terminalCatalogTransport';

describe('terminal catalog transport', () => {
  it('uses only session metadata RPCs and exposes no renderer or history operations', async () => {
    const onSessionsListed = vi.fn();
    const onSessionCreated = vi.fn();
    const rpc = {
      terminal: {
        listSessions: vi.fn().mockResolvedValue({ sessions: [{ id: 's1', groupId: 'default' }] }),
        createSession: vi.fn().mockResolvedValue({ session: { id: 's2', groupId: 'projects' } }),
        deleteSession: vi.fn().mockResolvedValue(undefined),
      },
    } as any;
    const fence = { requestSequence: 7, membershipRevision: 11, lifecycleRevision: 3 };
    const transport = createRedevenTerminalCatalogTransport(rpc, {
      beginListSessions: () => fence,
      onSessionsListed,
      onSessionCreated,
    });

    await expect(transport.listSessions?.()).resolves.toEqual([{ id: 's1' }]);
    await expect(transport.createSession?.('name', '/workspace')).resolves.toEqual({ id: 's2' });
    await transport.deleteSession?.('s2');

    expect(rpc.terminal.createSession).toHaveBeenCalledWith({ name: 'name', workingDir: '/workspace' });
    expect(rpc.terminal.deleteSession).toHaveBeenCalledWith({ sessionId: 's2' });
    expect(onSessionsListed).toHaveBeenCalledWith([{ id: 's1', groupId: 'default' }], fence);
    expect(onSessionCreated).toHaveBeenCalledWith({ id: 's2', groupId: 'projects' });
    expect(Object.keys(transport).sort()).toEqual(['createSession', 'deleteSession', 'listSessions']);
  });
});
