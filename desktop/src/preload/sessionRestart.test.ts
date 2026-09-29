// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionRestartBridge } from '../shared/sessionRestartIPC';

const expose = vi.fn();
const invoke = vi.fn();
const on = vi.fn();
const send = vi.fn();
const sendSync = vi.fn();
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: expose },
  ipcRenderer: { invoke, on, send, sendSync } }));

function bridge(): SessionRestartBridge {
  return expose.mock.calls.find(([name]) => name === 'redevenDesktopSessionRestart')?.[1] as SessionRestartBridge;
}

describe('sessionRestart preload', () => {
  beforeEach(() => {
    vi.resetModules();
    expose.mockReset(); invoke.mockReset(); on.mockReset(); send.mockReset(); sendSync.mockReset();
    sendSync.mockReturnValue('document-one');
    invoke.mockResolvedValue(true);
  });

  it('captures one document generation and submits state only after preparation', async () => {
    const { bootstrapSessionRestartBridge } = await import('./sessionRestart');
    bootstrapSessionRestartBridge();
    const state = { v: 1 as const, json: '{}', files: [] };
    const prepare = vi.fn(async () => state);
    const cancel = vi.fn();
    bridge().register(prepare, cancel);
    expect(send).toHaveBeenCalledWith('redeven-desktop:session-restart-register', 'document-one');
    const handlePrepare = on.mock.calls.find(([channel]) => channel === 'redeven-desktop:session-restart-prepare')?.[1];
    await handlePrepare({}, 'ticket-one');
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('redeven-desktop:session-restart-submit',
      { generation: 'document-one', ticket: 'ticket-one', state }));
    expect(prepare).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    await bridge().read();
    await bridge().restored('ticket-one');
    expect(invoke).toHaveBeenCalledWith('redeven-desktop:session-restart-read', 'document-one');
    expect(invoke).toHaveBeenCalledWith('redeven-desktop:session-restart-restored',
      { generation: 'document-one', ticket: 'ticket-one' });
  });

  it('does not expose a restart bridge to a document without a current session', async () => {
    sendSync.mockReturnValue(null);
    const { bootstrapSessionRestartBridge } = await import('./sessionRestart');
    bootstrapSessionRestartBridge();
    expect(expose).not.toHaveBeenCalled();
  });
});
