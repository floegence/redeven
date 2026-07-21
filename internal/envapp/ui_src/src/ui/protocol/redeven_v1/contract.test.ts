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

  it('keeps foreground command on 2013 and subscribes output activity on unique type 2014', () => {
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

    rpc.terminal.onForegroundCommandUpdate(foregroundHandler);
    rpc.terminal.onOutputActivityUpdate(outputHandler);

    expect(redevenV1TypeIds.terminal.foregroundCommandUpdate).toBe(2013);
    expect(redevenV1TypeIds.terminal.outputActivityUpdate).toBe(2014);
    expect(notifyHandlers.has(2013)).toBe(true);
    expect(notifyHandlers.has(2014)).toBe(true);

    notifyHandlers.get(2014)?.({
      session_id: 'session-1',
      output_activity: { phase: 'streaming', revision: 3, updated_at_ms: 4 },
    });
    expect(outputHandler).toHaveBeenCalledWith({
      sessionId: 'session-1',
      outputActivity: { phase: 'streaming', revision: 3, updatedAtMs: 4 },
    });
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
});
