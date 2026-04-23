// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TerminalSessionsLifecycleSync } from './terminalSessionsLifecycleSync';

const protocolMocks = vi.hoisted(() => ({
  client: {} as Record<string, unknown> | null,
}));

const rpcMocks = vi.hoisted(() => ({
  onSessionsChanged: vi.fn(),
  unsubscribe: vi.fn(),
  handler: undefined as ((event: any) => void) | undefined,
}));

const notificationMocks = vi.hoisted(() => ({
  error: vi.fn(),
}));

const terminalSessionsMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  useNotification: () => notificationMocks,
}));

vi.mock('@floegence/floe-webapp-protocol', () => ({
  useProtocol: () => ({
    client: () => protocolMocks.client,
  }),
}));

vi.mock('../protocol/redeven_v1', () => ({
  useRedevenRpc: () => ({
    terminal: {
      onSessionsChanged: rpcMocks.onSessionsChanged,
    },
  }),
}));

vi.mock('./terminalSessions', () => ({
  refreshRedevenTerminalSessionsCoordinator: terminalSessionsMocks.refresh,
}));

async function flushLifecycleSync() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('TerminalSessionsLifecycleSync', () => {
  let host: HTMLDivElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    protocolMocks.client = { id: 'client-1' };
    rpcMocks.handler = undefined;
    rpcMocks.unsubscribe.mockReset();
    rpcMocks.onSessionsChanged.mockReset();
    rpcMocks.onSessionsChanged.mockImplementation((handler: (event: any) => void) => {
      rpcMocks.handler = handler;
      return rpcMocks.unsubscribe;
    });
    notificationMocks.error.mockReset();
    terminalSessionsMocks.refresh.mockReset();
    terminalSessionsMocks.refresh.mockResolvedValue(undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('refreshes terminal sessions on lifecycle notifications', async () => {
    const dispose = render(() => <TerminalSessionsLifecycleSync />, host);
    await flushLifecycleSync();

    expect(rpcMocks.onSessionsChanged).toHaveBeenCalledTimes(1);
    expect(terminalSessionsMocks.refresh).toHaveBeenCalledTimes(1);

    rpcMocks.handler?.({ reason: 'closing', sessionId: 'session-1', lifecycle: 'closing', hidden: true });
    await flushLifecycleSync();

    expect(terminalSessionsMocks.refresh).toHaveBeenCalledTimes(2);
    expect(notificationMocks.error).not.toHaveBeenCalled();

    dispose();
    expect(rpcMocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('notifies once when terminal cleanup fails after the tab is hidden', async () => {
    render(() => <TerminalSessionsLifecycleSync />, host);
    await flushLifecycleSync();

    rpcMocks.handler?.({
      reason: 'close_failed_hidden',
      sessionId: 'session-2',
      lifecycle: 'close_failed_hidden',
      hidden: true,
      failureCode: 'DELETE_FAILED',
      failureMessage: 'process still running',
    });
    rpcMocks.handler?.({
      reason: 'close_failed_hidden',
      sessionId: 'session-2',
      lifecycle: 'close_failed_hidden',
      hidden: true,
      failureCode: 'DELETE_FAILED',
      failureMessage: 'process still running',
    });
    await flushLifecycleSync();

    expect(notificationMocks.error).toHaveBeenCalledTimes(1);
    expect(notificationMocks.error).toHaveBeenCalledWith(
      'Terminal cleanup delayed',
      'The tab was removed, but cleanup is still blocked: process still running',
    );
    expect(terminalSessionsMocks.refresh).toHaveBeenCalledTimes(2);

    rpcMocks.handler?.({ reason: 'closing', sessionId: 'session-2', lifecycle: 'closing', hidden: true });
    rpcMocks.handler?.({
      reason: 'close_failed_hidden',
      sessionId: 'session-2',
      lifecycle: 'close_failed_hidden',
      hidden: true,
      failureCode: 'DELETE_FAILED',
      failureMessage: 'process still running',
    });
    await flushLifecycleSync();

    expect(notificationMocks.error).toHaveBeenCalledTimes(2);
  });
});
