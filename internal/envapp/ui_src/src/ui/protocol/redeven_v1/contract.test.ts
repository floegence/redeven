import { afterEach, describe, expect, it, vi } from 'vitest';

import { createRedevenV1Rpc } from './contract';
import { redevenV1TypeIds } from './typeIds';
import {
  getDebugConsoleClientEventRingSnapshot,
  resetDebugConsoleCaptureForTests,
} from '../../services/debugConsoleCapture';

afterEach(() => resetDebugConsoleCaptureForTests());

describe('Redeven v1 terminal notifications', () => {
  it('keeps every RPC type ID globally unique', () => {
    const typeIds = Object.values(redevenV1TypeIds).flatMap((group) => Object.values(group));
    expect(new Set(typeIds).size).toBe(typeIds.length);
  });

  it('keeps terminal metadata notifications on unique consecutive type IDs', () => {
    const notifyHandlers = new Map<number, (payload: unknown) => void>();
    const onNotify = vi.fn((typeId: number, handler: (payload: unknown) => void) => {
      notifyHandlers.set(typeId, handler);
      return () => notifyHandlers.delete(typeId);
    });
    const rpc = createRedevenV1Rpc({
      call: vi.fn(),
      onNotify,
    } as any);
    const foregroundHandler = vi.fn();
    const outputHandler = vi.fn();
    const contextHandler = vi.fn();
    const workHandler = vi.fn();

    rpc.terminal.onForegroundCommandUpdate(foregroundHandler);
    rpc.terminal.onOutputActivityUpdate(outputHandler);
    rpc.terminal.onExecutionContextUpdate(contextHandler);
    rpc.terminal.onWorkStateUpdate(workHandler);

    expect(redevenV1TypeIds.terminal.foregroundCommandUpdate).toBe(2013);
    expect(redevenV1TypeIds.terminal.outputActivityUpdate).toBe(2014);
    expect(redevenV1TypeIds.terminal.executionContextUpdate).toBe(2015);
    expect(redevenV1TypeIds.terminal.workStateUpdate).toBe(2016);
    expect(notifyHandlers.has(2013)).toBe(true);
    expect(notifyHandlers.has(2014)).toBe(true);
    expect(notifyHandlers.has(2015)).toBe(true);
    expect(notifyHandlers.has(2016)).toBe(true);

    notifyHandlers.get(2014)?.({
      session_id: 'session-1',
      output_activity: { phase: 'streaming', revision: 3, updated_at_ms: 4 },
    });
    expect(outputHandler).toHaveBeenCalledWith({
      sessionId: 'session-1',
      outputActivity: { phase: 'streaming', revision: 3, updatedAtMs: 4 },
    });

    notifyHandlers.get(2015)?.({
      session_id: 'session-1',
      execution_context: {
        location: { kind: 'remote', phase: 'ready', label: 'root@host', authority: 'host', working_directory: '/root', source: 'osc7' },
        application: { kind: 'shell', identity: '', display_name: '' },
        revision: 5,
        updated_at_ms: 6,
      },
    });
    notifyHandlers.get(2016)?.({
      session_id: 'session-1',
      work_state: { phase: 'working', source: 'semantic', context_revision: 5, foreground_command_revision: 3, revision: 6, updated_at_ms: 7 },
    });
    expect(contextHandler).toHaveBeenCalledTimes(1);
    expect(workHandler).toHaveBeenCalledTimes(1);
  });

  it('isolates a malformed output activity notification without poisoning the subscription', () => {
    const sensitiveSessionId = 'session-sensitive-output-notify';
    let outputNotify: ((payload: unknown) => void) | undefined;
    const rpc = createRedevenV1Rpc({
      call: vi.fn(),
      onNotify: (typeId: number, handler: (payload: unknown) => void) => {
        if (typeId === 2014) outputNotify = handler;
        return () => undefined;
      },
    } as any);
    const handler = vi.fn();
    rpc.terminal.onOutputActivityUpdate(handler);

    expect(() => outputNotify?.({
      session_id: sensitiveSessionId,
      output_activity: { phase: 'done', revision: 999, updated_at_ms: 5 },
    })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
    const [diagnostic] = getDebugConsoleClientEventRingSnapshot().events;
    expect(diagnostic).toMatchObject({
      scope: 'terminal_catalog',
      kind: 'notify_rejected',
      detail: {
        type_id: 2014,
        error_code: 'malformed_output_activity_notify',
        delivered: false,
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain(sensitiveSessionId);

    outputNotify?.({
      session_id: 'session-1',
      output_activity: { phase: 'settled', revision: 4, updated_at_ms: 6 },
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      typeId: 2015,
      subscribe: 'onExecutionContextUpdate' as const,
      errorCode: 'malformed_execution_context_notify',
      payload: {
        session_id: 'session-sensitive-context-notify',
        execution_context: {
          location: { kind: 'remote', phase: 'ready', label: 'secret', authority: 'secret', working_directory: '/secret', source: 'invalid' },
          application: { kind: 'shell', identity: '', display_name: '' },
          revision: 999,
          updated_at_ms: 5,
        },
      },
    },
    {
      typeId: 2016,
      subscribe: 'onWorkStateUpdate' as const,
      errorCode: 'malformed_work_state_notify',
      payload: {
        session_id: 'session-sensitive-work-notify',
        work_state: { phase: 'working', source: '', context_revision: 1, foreground_command_revision: 1, revision: 999, updated_at_ms: 5 },
      },
    },
  ])('keeps rejected $typeId diagnostics content-free', ({ typeId, subscribe, errorCode, payload }) => {
    let notify: ((payload: unknown) => void) | undefined;
    const rpc = createRedevenV1Rpc({
      call: vi.fn(),
      onNotify: (candidateTypeId: number, handler: (candidate: unknown) => void) => {
        if (candidateTypeId === typeId) notify = handler;
        return () => undefined;
      },
    } as any);
    const handler = vi.fn();
    rpc.terminal[subscribe](handler);

    expect(() => notify?.(payload)).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
    const [diagnostic] = getDebugConsoleClientEventRingSnapshot().events;
    expect(diagnostic).toMatchObject({
      scope: 'terminal_catalog',
      kind: 'notify_rejected',
      detail: { type_id: typeId, error_code: errorCode, delivered: false },
    });
    expect(JSON.stringify(diagnostic)).not.toContain('sensitive');
    expect(JSON.stringify(diagnostic)).not.toContain('secret');
  });
});
