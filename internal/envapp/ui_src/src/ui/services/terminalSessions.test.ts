import { describe, expect, it, vi } from 'vitest';

import { createRedevenTerminalSessionsCoordinator } from './terminalSessions';

const transport = (listSessions: () => Promise<any>) => ({
  attach: vi.fn().mockResolvedValue(undefined),
  resize: vi.fn().mockResolvedValue(undefined),
  sendInput: vi.fn().mockResolvedValue(undefined),
  history: vi.fn().mockResolvedValue([]),
  clear: vi.fn().mockResolvedValue(undefined),
  listSessions,
});

describe('Redeven terminal sessions coordinator', () => {
  it('fails closed on an equal-revision context conflict and accepts authoritative truth', async () => {
    const localContext = {
      location: { kind: 'local' as const, phase: 'ready' as const, label: '', authority: '', workingDirectory: '/workspace', source: 'shell_integration' as const },
      application: { kind: 'shell' as const, identity: '', displayName: '' },
      revision: 3,
      updatedAtMs: 30,
    };
    const remoteContext = {
      location: { kind: 'remote' as const, phase: 'ready' as const, label: 'root@host', authority: 'host', workingDirectory: '/root', source: 'osc7' as const },
      application: { kind: 'shell' as const, identity: '', displayName: '' },
      revision: 3,
      updatedAtMs: 31,
    };
    const authoritative = {
      id: 'session-1',
      name: 'Terminal 1',
      workingDir: '/workspace',
      createdAtMs: 1,
      lastActiveAtMs: 2,
      isActive: true,
      executionContext: remoteContext,
    };
    const listSessions = vi.fn().mockResolvedValue([authoritative]);
    const coordinator = createRedevenTerminalSessionsCoordinator({
      transport: transport(listSessions),
      pollMs: 0,
    });
    coordinator.upsertSession({ ...authoritative, executionContext: localContext });

    coordinator.updateSessionMeta('session-1', { executionContext: remoteContext });
    expect(coordinator.getSnapshot()[0]?.executionContext).toMatchObject({
      location: { kind: 'unknown', phase: 'unknown' },
      revision: 3,
    });

    await vi.waitFor(() => expect(listSessions).toHaveBeenCalledOnce());
    expect(coordinator.getSnapshot()[0]?.executionContext).toEqual(remoteContext);
    coordinator.dispose();
  });
});
