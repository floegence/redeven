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
      execution_policy: {
        require_user_approval: true,
        block_dangerous_commands: true,
      },
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

function adapterOptions(overrides: Partial<FlowerRuntimeTransport>): RuntimeFlowerSurfaceAdapterOptions {
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
    ...overrides,
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
    stopThread: vi.fn(async () => {
      throw new Error('stopThread should not be called.');
    }),
    submitInput: vi.fn(async () => {
      throw new Error('submitInput should not be called.');
    }),
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
});
