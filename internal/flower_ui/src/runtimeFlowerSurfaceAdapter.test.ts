import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerRouterDecision,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerThreadReadStatus,
} from './contracts/flowerSurfaceContracts';
import {
  createRuntimeFlowerSurfaceAdapter,
  type FlowerRuntimeTransport,
  type RuntimeFlowerSurfaceAdapterOptions,
} from './runtimeFlowerSurfaceAdapter';

function readStatus(): FlowerThreadReadStatus {
  return {
    is_unread: false,
    snapshot: {
      activity_revision: 42,
      last_message_at_unix_ms: 3200,
      activity_signature: 'status:success\u001factivity:42\u001flast_message:3200',
      waiting_prompt_id: '',
    },
    read_state: {
      last_seen_activity_revision: 42,
      last_read_message_at_unix_ms: 3200,
      last_seen_activity_signature: 'status:success\u001factivity:42\u001flast_message:3200',
      last_seen_waiting_prompt_id: '',
    },
  };
}

function settingsSnapshot(): FlowerSettingsSnapshot {
  return {
    config: {
      schema_version: 1,
      current_model_id: 'default/gpt-5',
      permission_type: 'approval_required',
      terminal_exec_policy: {
        default_timeout_ms: 30_000,
        max_timeout_ms: 120_000,
      },
      providers: [],
    },
    provider_secrets: [],
  };
}

function routerDecision(): FlowerRouterDecision {
  return {
    decision_id: 'decision_1',
    decision_revision: 1,
    route: 'flower',
    reason_code: 'test',
    selected_handler: null,
    available_handlers: [],
    unavailable_handlers: [],
    handler_selection: {
      can_switch: false,
      requires_user_visible_confirmation: false,
    },
    decision_scope: {
      thread_kind: 'chat',
      client_surface: 'flower',
    },
    runtime_presence: {
      schema_version: 1,
      runtime_id: 'runtime_1',
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: 'Runtime',
      state: 'online',
      endpoint: { visibility: 'local' },
      capabilities: [],
      last_seen_at_unix_ms: 1,
    },
    allowed_actions: [],
    ui_chips: [],
    created_at_unix_ms: 1,
  };
}

function adapterOptions(
  transportOverrides: Partial<FlowerRuntimeTransport> = {},
  optionOverrides: Partial<RuntimeFlowerSurfaceAdapterOptions> = {},
): RuntimeFlowerSurfaceAdapterOptions {
  const transport: FlowerRuntimeTransport = {
    listThreads: vi.fn(async () => ({ threads: [] })),
    loadThread: vi.fn(async () => {
      throw new Error('loadThread should not be called.');
    }),
    listThreadLiveEvents: vi.fn(async () => ({ events: [] })),
    loadSubagentDetail: vi.fn(async () => ({ detail: undefined })),
    markThreadRead: vi.fn(async () => ({ read_status: readStatus() })),
    patchThread: vi.fn(async () => ({ thread: undefined })),
    forkThread: vi.fn(async () => ({ thread: undefined })),
    submitApproval: vi.fn(async () => undefined),
    ...transportOverrides,
  };
  return {
    runtime: {
      runtime_id: 'runtime_1',
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: 'Runtime',
      subtitle: 'Local',
    },
    transport,
    mapperOptions: {
      runtimeID: 'runtime_1',
      runtimeKind: 'env_local',
      sourceLabel: 'Runtime',
      targetLabels: [],
    },
    loadSettings: vi.fn(async () => settingsSnapshot()),
    saveSettings: vi.fn(async (_draft: FlowerSettingsDraft) => settingsSnapshot()),
    resolveHandler: vi.fn(async () => routerDecision()),
    launchTurn: vi.fn(async () => {
      throw new Error('launchTurn should not be called.');
    }),
    compactThreadContext: vi.fn(async () => {
      throw new Error('compactThreadContext should not be called.');
    }),
    stopThread: vi.fn(async () => {
      throw new Error('stopThread should not be called.');
    }),
    submitInput: vi.fn(async () => {
      throw new Error('submitInput should not be called.');
    }),
    ...optionOverrides,
  };
}

describe('runtime Flower surface adapter read state', () => {
  it('returns read_status from markThreadRead without reloading the thread', async () => {
    const status = readStatus();
    const markThreadRead = vi.fn(async () => ({ read_status: status }));
    const loadThread = vi.fn(async () => {
      throw new Error('loadThread should not be called.');
    });
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({
      markThreadRead,
      loadThread,
    }));

    const result = await adapter.markThreadRead(' thread_1 ', {
      activity_revision: 42.9,
      last_message_at_unix_ms: 3200.8,
      activity_signature: ' status:success ',
      waiting_prompt_id: ' ',
    });

    expect(result).toEqual({
      ...status,
      snapshot: {
        activity_revision: 42,
        last_message_at_unix_ms: 3200,
        activity_signature: 'status:success\u001factivity:42\u001flast_message:3200',
      },
      read_state: {
        last_seen_activity_revision: 42,
        last_read_message_at_unix_ms: 3200,
        last_seen_activity_signature: 'status:success\u001factivity:42\u001flast_message:3200',
      },
    });
    expect(markThreadRead).toHaveBeenCalledTimes(1);
    expect(markThreadRead).toHaveBeenCalledWith('thread_1', {
      snapshot: {
        activity_revision: 42,
        last_message_at_unix_ms: 3200,
        activity_signature: 'status:success',
        waiting_prompt_id: undefined,
      },
    });
    expect(loadThread).not.toHaveBeenCalled();
  });

  it('rejects a markThreadRead response without read_status', async () => {
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({
      markThreadRead: vi.fn(async () => ({} as never)),
    }));

    await expect(adapter.markThreadRead('thread_1', {
      activity_revision: 1,
      last_message_at_unix_ms: 1,
      activity_signature: 'activity:1',
      waiting_prompt_id: '',
    })).rejects.toThrow('Missing read status.');
  });

  it('rejects malformed markThreadRead read_status payloads', async () => {
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({
      markThreadRead: vi.fn(async () => ({
        read_status: {
          is_unread: false,
          snapshot: readStatus().snapshot,
        },
      } as never)),
    }));

    await expect(adapter.markThreadRead('thread_1', {
      activity_revision: 1,
      last_message_at_unix_ms: 1,
      activity_signature: 'activity:1',
      waiting_prompt_id: '',
    })).rejects.toThrow('thread.read_status.read_state is required');
  });

  it('passes compact context requests through without creating a user turn', async () => {
    const bootstrap = {
      schema_version: 1,
      endpoint_id: 'runtime_1',
      thread_id: 'thread_1',
      cursor: 4,
      retained_from_seq: 1,
      thread: {
        thread_id: 'thread_1',
        title: 'Running thread',
        run_status: 'running',
        model_id: 'default/gpt-5',
        created_at_unix_ms: 1,
        updated_at_unix_ms: 2,
        read_status: readStatus(),
      },
      timeline_messages: [],
      live_state: {
        thread_patch: {},
        runs: {},
        approval_actions: {},
        input_requests: {},
      },
      read_status: readStatus(),
      generated_at_ms: 10,
    };
    const compactThreadContext = vi.fn(async () => bootstrap as never);
    const launchTurn = vi.fn(async () => {
      throw new Error('launchTurn should not be called.');
    });
    const stopThread = vi.fn(async () => {
      throw new Error('stopThread should not be called.');
    });
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({}, {
      compactThreadContext,
      launchTurn,
      stopThread,
    }));

    const result = await adapter.compactThreadContext({
      thread_id: ' thread_1 ',
      active_run_id: ' run_1 ',
    });

    expect(result.thread.thread_id).toBe('thread_1');
    expect(compactThreadContext).toHaveBeenCalledWith({
      thread_id: 'thread_1',
      active_run_id: 'run_1',
    });
    expect(launchTurn).not.toHaveBeenCalled();
    expect(stopThread).not.toHaveBeenCalled();
  });

  it('patches thread permission type and reloads the thread', async () => {
    const patchThread = vi.fn(async () => ({ thread: { thread_id: 'thread_permission', read_status: readStatus() } }));
    const loadThread = vi.fn(async () => ({
      schema_version: 1,
      endpoint_id: 'runtime_1',
      thread_id: 'thread_permission',
      cursor: 5,
      retained_from_seq: 1,
      thread: {
        thread_id: 'thread_permission',
        title: 'Permission thread',
        run_status: 'running',
        model_id: 'default/gpt-5',
        permission_type: 'full_access',
        created_at_unix_ms: 1,
        updated_at_unix_ms: 2,
        read_status: readStatus(),
      },
      timeline_messages: [],
      live_state: {
        thread_patch: {},
        runs: {},
        approval_actions: {},
        input_requests: {},
      },
      read_status: readStatus(),
      generated_at_ms: 10,
    }));
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({
      patchThread,
      loadThread,
    }));

    const result = await adapter.setThreadPermissionType?.(' thread_permission ', 'full_access');

    expect(patchThread).toHaveBeenCalledWith('thread_permission', { permission_type: 'full_access' });
    expect(loadThread).toHaveBeenCalledWith('thread_permission');
    expect(result?.thread.permission_type).toBe('full_access');
  });

  it('submits main tool approvals with run and tool identity', async () => {
    const submitApproval = vi.fn(async () => undefined);
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ submitApproval }));

    await adapter.submitApproval({
      thread_id: ' thread_1 ',
      origin: 'main_tool',
      run_id: ' run_1 ',
      action_id: ' action_1 ',
      tool_id: ' tool_1 ',
      approved: true,
      expected_seq: 12.9,
      revision: 2.1,
    });

    expect(submitApproval).toHaveBeenCalledWith({
      thread_id: 'thread_1',
      origin: 'main_tool',
      run_id: 'run_1',
      action_id: 'action_1',
      tool_id: 'tool_1',
      approved: true,
      expected_seq: 12,
      revision: 2,
      version: undefined,
      surface_epoch: undefined,
    });
  });

  it('submits delegated approvals without requiring run or tool identity', async () => {
    const submitApproval = vi.fn(async () => undefined);
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ submitApproval }));
    const delegatedRef = {
      parent_thread_id: 'thread_1',
      parent_run_id: 'run_parent',
      subagent_id: 'child_1',
      child_thread_id: 'thread_child',
      child_run_id: 'run_child',
      child_tool_call_id: 'tool_child',
      approval_id: 'approval_child',
    };

    await adapter.submitApproval({
      thread_id: ' thread_1 ',
      origin: 'delegated_subagent',
      action_id: ' action_delegated ',
      approved: false,
      version: 3,
      surface_epoch: 5,
      idempotency_key: ' idem-1 ',
      delegated_ref: delegatedRef,
    });

    expect(submitApproval).toHaveBeenCalledWith({
      thread_id: 'thread_1',
      origin: 'delegated_subagent',
      action_id: 'action_delegated',
      approved: false,
      expected_seq: undefined,
      revision: undefined,
      version: 3,
      surface_epoch: 5,
      idempotency_key: 'idem-1',
      delegated_ref: delegatedRef,
    });
  });
});
