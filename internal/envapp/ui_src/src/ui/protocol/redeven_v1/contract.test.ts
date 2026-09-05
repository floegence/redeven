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

  it('decodes whole-environment memory from the existing system monitor RPC', async () => {
    const call = vi.fn(async (
      _typeId: number,
      _payload: unknown,
      decodeResponse: (payload: unknown) => unknown,
    ) => decodeResponse({
      cpu_usage: 17.5,
      cpu_cores: 8,
      memory_total_bytes: 17_179_869_184,
      memory_used_bytes: 9_663_676_416,
      network_bytes_received: 1,
      network_bytes_sent: 2,
      network_speed_received: 3,
      network_speed_sent: 4,
      platform: 'linux',
      processes: [],
      timestamp_ms: 1234,
    }));
    const rpc = createRedevenV1Rpc({ call, onNotify: vi.fn() } as any);

    await expect(rpc.monitor.getSysMonitor()).resolves.toMatchObject({
      cpuUsage: 17.5,
      memoryTotalBytes: 17_179_869_184,
      memoryUsedBytes: 9_663_676_416,
      timestampMs: 1234,
    });
    expect(redevenV1TypeIds.monitor.sysMonitor).toBe(3001);
    expect(call).toHaveBeenCalledWith(3001, {}, expect.any(Function), undefined);
  });

  it('accepts the complete runtime service snapshot returned by sys ping', async () => {
    const call = vi.fn(async (
      _typeId: number,
      _payload: unknown,
      decodeResponse: (payload: unknown) => unknown,
    ) => decodeResponse({
      server_time_ms: 42,
      process_started_at_ms: 41,
      version: 'v1.4.2',
      runtime_service: {
        runtime_version: 'v1.4.2',
        protocol_version: 'redeven-runtime-v2',
        remote_enabled: false,
        compatibility: 'compatible',
        open_readiness: { state: 'openable' },
        ai_readiness: {
          state: 'degraded',
          reason_code: 'host_thread_settings_missing',
          issue_count: 2,
        },
        active_workload: {
          terminal_count: 1,
          session_count: 1,
          task_count: 0,
          port_forward_count: 0,
        },
        capabilities: {
          desktop_model_source: { supported: true, bind_method: 'runtime_control_v2' },
          provider_link: { supported: false },
          runtime_gateway: { supported: true, bind_method: 'runtime_control_v2' },
        },
        bindings: {
          desktop_model_source: { state: 'bound' },
          provider_link: { state: 'unsupported', remote_enabled: false },
        },
      },
    }));
    const rpc = createRedevenV1Rpc({ call, onNotify: vi.fn() } as any);

    await expect(rpc.sys.ping()).resolves.toMatchObject({
      processStartedAtMs: 41,
      runtimeService: {
        aiReadiness: {
          state: 'degraded',
          reasonCode: 'host_thread_settings_missing',
          issueCount: 2,
        },
        capabilities: {
          runtimeGateway: { supported: true, bindMethod: 'runtime_control_v2' },
        },
      },
    });
    expect(call).toHaveBeenCalledWith(4001, {}, expect.any(Function), undefined);
  });

  it('keeps terminal metadata notifications on unique consecutive type IDs', () => {
    const notifyHandlers = new Map<number, (payload: unknown) => void>();
    const onNotify = vi.fn((
      typeId: number,
      decodePayload: (payload: unknown) => unknown,
      handler: (payload: unknown) => void,
    ) => {
      notifyHandlers.set(typeId, (payload) => handler(decodePayload(payload)));
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
    const groupHandler = vi.fn();

    rpc.terminal.onForegroundCommandUpdate(foregroundHandler);
    rpc.terminal.onOutputActivityUpdate(outputHandler);
    rpc.terminal.onExecutionContextUpdate(contextHandler);
    rpc.terminal.onWorkStateUpdate(workHandler);
    rpc.terminal.onGroupCatalogChanged(groupHandler);

    expect(redevenV1TypeIds.terminal.foregroundCommandUpdate).toBe(2013);
    expect(redevenV1TypeIds.terminal.outputActivityUpdate).toBe(2014);
    expect(redevenV1TypeIds.terminal.executionContextUpdate).toBe(2015);
    expect(redevenV1TypeIds.terminal.workStateUpdate).toBe(2016);
    expect(redevenV1TypeIds.terminal.groupList).toBe(2017);
    expect(redevenV1TypeIds.terminal.groupCatalogChanged).toBe(2022);
    expect(redevenV1TypeIds.terminal.groupReorder).toBe(2023);
    expect(notifyHandlers.has(2013)).toBe(true);
    expect(notifyHandlers.has(2014)).toBe(true);
    expect(notifyHandlers.has(2015)).toBe(true);
    expect(notifyHandlers.has(2016)).toBe(true);
    expect(notifyHandlers.has(2022)).toBe(true);

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
    notifyHandlers.get(2022)?.({
      reason: 'session_moved',
      group_id: 'group-services',
      session_id: 'session-1',
      revision: 7,
    });
    expect(groupHandler).toHaveBeenCalledWith({
      reason: 'session_moved',
      groupId: 'group-services',
      sessionId: 'session-1',
      revision: 7,
    });
  });

  it('isolates a malformed output activity notification without poisoning the subscription', () => {
    const sensitiveSessionId = 'session-sensitive-output-notify';
    let outputNotify: ((payload: unknown) => void) | undefined;
    const rpc = createRedevenV1Rpc({
      call: vi.fn(),
      onNotify: (
        typeId: number,
        decodePayload: (payload: unknown) => unknown,
        handler: (payload: unknown) => void,
      ) => {
        if (typeId === 2014) {
          outputNotify = (payload) => handler(decodePayload(payload));
        }
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
      onNotify: (
        candidateTypeId: number,
        decodePayload: (candidate: unknown) => unknown,
        handler: (candidate: unknown) => void,
      ) => {
        if (candidateTypeId === typeId) {
          notify = (candidate) => handler(decodePayload(candidate));
        }
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
