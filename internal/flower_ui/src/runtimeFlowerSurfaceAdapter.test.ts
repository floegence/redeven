import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerApprovalCommandResult,
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
    defaults: { permission_type: 'approval_required' },
    model_profile: {
      schema_version: 1,
      current_model_id: 'default/gpt-5',
      providers: [],
    },
    provider_secrets: [],
  };
}

function approvalResult(threadID: string, interactionID = 'approval-1', approved = true, version = 1): FlowerApprovalCommandResult {
  return {
    ok: true,
    current: {
      thread_id: threadID,
      view_version: version,
      activity: 'active',
      interactions: [{ id: interactionID, kind: 'approval', resolved: true, approved }],
    },
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
    loadSubagentDetail: vi.fn(async () => ({ detail: undefined })),
    readTerminalProcess: vi.fn(async () => ({
      process_id: 'tp_default',
      status: 'running',
      output: '',
	  first_seq: 0,
	  last_seq: 0,
	  latest_seq: 0,
	  has_more: false,
	  truncated: false,
    })),
    markThreadRead: vi.fn(async () => ({ read_status: readStatus() })),
    patchThread: vi.fn(async () => ({ thread: undefined })),
    forkThread: vi.fn(async () => ({ thread: undefined })),
	    submitApproval: vi.fn(async (input) => approvalResult(input.thread_id, input.interaction_id, input.approved)),
	    retryEffect: vi.fn(async () => undefined),
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
    saveDefaultPermission: vi.fn(async () => settingsSnapshot()),
    saveModelProfile: vi.fn(async (_draft: FlowerSettingsDraft) => settingsSnapshot()),
    persistDefaultModel: vi.fn(async (_modelID: string) => settingsSnapshot()),
    resolveHandler: vi.fn(async () => routerDecision()),
    launchTurn: vi.fn(async () => {
      throw new Error('launchTurn should not be called.');
    }),
    retryThread: vi.fn(async () => {
      throw new Error('retryThread should not be called.');
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
	it('loads product metadata and typed current view without polling', async () => {
		const loadThread = vi.fn(async () => ({
			thread: {
				thread_id: 'thread_detail',
				title: '',
				title_status: 'failed',
				model_id: 'default/gpt-5',
				permission_type: 'approval_required',
				working_dir: '/workspace',
				queued_turn_count: 0,
				run_status: 'running',
				created_at_unix_ms: 1,
				updated_at_unix_ms: 2,
				last_message_at_unix_ms: 2,
				read_status: readStatus(),
			},
				current: {
					thread_id: 'thread_detail',
					view_version: 7,
				activity: 'active',
				items: [{ id: 'user:req-1', kind: 'user', text: 'hello' }],
			},
		}));
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ loadThread }));

		const detail = await adapter.loadThread('thread_detail');

		expect(detail.thread.thread_id).toBe('thread_detail');
		expect(detail.thread.title).toBe('hello');
			expect(detail.current.view_version).toBe(7);
		expect(detail.thread.messages).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: 'user:req-1', role: 'user', content: 'hello' }),
		]));
		expect(detail).not.toHaveProperty('cursor');
		expect(detail).not.toHaveProperty('stream_generation');
		expect(detail).not.toHaveProperty('live_state');
	});

	it('trims and forwards canonical continuation retries', async () => {
		const retryThread = vi.fn(async () => undefined);
		const loadThread = vi.fn(async () => ({
			thread: {
				thread_id: 'thread_1',
				title: 'Retry',
				title_status: 'ready',
				model_id: 'default/gpt-5',
				permission_type: 'approval_required',
				working_dir: '/workspace',
				queued_turn_count: 0,
				run_status: 'failed',
				created_at_unix_ms: 1,
				updated_at_unix_ms: 1,
				last_message_at_unix_ms: 1,
				read_status: readStatus(),
			},
			current: { thread_id: 'thread_1', view_version: 1 },
		}));
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ loadThread }, { retryThread }));

		await expect(adapter.retryThread(' thread_1 ')).resolves.toMatchObject({
			current: { view_version: 1 },
			thread: { thread_id: 'thread_1', title: 'Retry' },
		});
		expect(retryThread).toHaveBeenCalledWith('thread_1');
		expect(loadThread).toHaveBeenCalledWith('thread_1');
		await expect(adapter.retryThread('  ')).rejects.toThrow();
	});

	it('keeps read APIs while removing mutation affordances for read-only viewers', () => {
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({}, { canMutate: false }));

		expect(adapter.canMutate).toBe(false);
		expect(adapter.listThreads).toBeTypeOf('function');
		expect(adapter.loadThread).toBeTypeOf('function');
		expect(adapter.markThreadRead).toBeTypeOf('function');
		expect(adapter.renameThread).toBeUndefined();
		expect(adapter.setThreadPinned).toBeUndefined();
		expect(adapter.setThreadPermissionType).toBeUndefined();
		expect(adapter.setThreadModel).toBeUndefined();
		expect(adapter.setThreadReasoningSelection).toBeUndefined();
		expect(adapter.forkThread).toBeUndefined();
		expect(adapter.deleteThread).toBeUndefined();
		expect(adapter.deleteQueuedTurn).toBeUndefined();
		expect(adapter.uploadAttachment).toBeUndefined();
	});

	it('deletes one canonical queued turn and reconciles from the thread bootstrap', async () => {
		const deleteQueuedTurn = vi.fn(async () => undefined);
		const loadThread = vi.fn(async () => ({
				thread: {
				thread_id: 'thread_1',
				title: 'Queue',
				title_status: 'ready',
				model_id: 'default/gpt-5',
				permission_type: 'approval_required',
				working_dir: '/workspace',
				queued_turn_count: 0,
				run_status: 'running',
				created_at_unix_ms: 1,
				updated_at_unix_ms: 2,
				last_message_at_unix_ms: 2,
				read_status: readStatus(),
				},
				current: { thread: { id: 'thread_1' }, version: 4 },
			}));
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ deleteQueuedTurn, loadThread }));

		const result = await adapter.deleteQueuedTurn?.(' thread_1 ', ' followup_middle ');

		expect(deleteQueuedTurn).toHaveBeenCalledWith('thread_1', 'followup_middle');
		expect(loadThread).toHaveBeenCalledWith('thread_1');
		expect(result?.thread.thread_id).toBe('thread_1');
	});

		it('maps the published SSE transport into typed Flower envelopes', async () => {
			const connectLiveStream = vi.fn(async function* () {
				yield {
					schema_version: 1,
					kind: 'ready',
					summaries: [{
						thread_id: 'thread_stream',
						title: 'Streaming',
						title_status: 'ready',
						model_id: 'default/gpt-5',
						permission_type: 'approval_required',
						working_dir: '/workspace',
						queued_turn_count: 0,
						run_status: 'running',
						created_at_unix_ms: 1,
						updated_at_unix_ms: 2,
						last_message_at_unix_ms: 2,
						read_status: readStatus(),
					}],
				};
				yield {
					schema_version: 1,
					kind: 'thread.batch',
					thread_id: 'thread_stream',
					current: {
						thread: { id: 'thread_stream', title: 'Streaming' },
						version: 3,
						activity: 'active',
					},
				};
					yield {
						schema_version: 1,
						kind: 'viewer.read_state',
						thread_id: 'thread_stream',
					read_status: readStatus(),
				};
		});
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ connectLiveStream }));
		const controller = new AbortController();
			const frames = [];
			for await (const frame of adapter.connectLiveStream!({
				signal: controller.signal,
			})) frames.push(frame);

				expect(frames).toHaveLength(3);
			expect(frames[0]).toMatchObject({
				kind: 'ready',
				summaries: [{ thread_id: 'thread_stream', messages: [] }],
			});
			expect(frames[1]).toMatchObject({
				kind: 'thread.batch',
				current: { thread: { id: 'thread_stream', title: 'Streaming' }, version: 3, activity: 'active' },
				});
				expect(frames[2]).toMatchObject({
					kind: 'viewer.read_state',
					thread_id: 'thread_stream',
				read_status: { is_unread: false },
			});
	});

	it('maps summary-only SSE frames without requiring viewer read state', async () => {
		const connectLiveStream = vi.fn(async function* () {
			yield {
				schema_version: 1,
				kind: 'ready',
				summaries: [{
					thread_id: 'thread_failed',
					title: '',
					title_status: 'failed',
					model_id: 'deepseek/chat',
					permission_type: 'approval_required',
					working_dir: '/workspace',
					queued_turn_count: 0,
					run_status: 'failed',
					run_updated_at_unix_ms: 20,
					run_error_code: 'floret_turn_failed',
					run_error: 'provider rejected the request',
					waiting_prompt: { prompt_id: 'legacy-summary-detail-must-not-be-read' },
					created_at_unix_ms: 10,
					updated_at_unix_ms: 20,
					last_message_at_unix_ms: 20,
				}],
			};
		});
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ connectLiveStream }));
		const frames = [];
		for await (const frame of adapter.connectLiveStream!({ signal: new AbortController().signal })) frames.push(frame);

		expect(frames).toHaveLength(1);
		expect(frames[0]).toMatchObject({
			kind: 'ready',
			summaries: [{ thread_id: 'thread_failed', status: 'failed', messages: [], read_status: { is_unread: false } }],
		});
	});
  it('keeps thread-list summaries transcript-free even when preview fields are present', async () => {
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({
      listThreads: vi.fn(async () => ({
        threads: [{
          thread_id: 'thread_summary',
          title: 'Running summary',
          title_status: 'ready',
          model_id: 'default/gpt-5',
          permission_type: 'approval_required',
          working_dir: '/workspace',
          queued_turn_count: 0,
          run_status: 'running',
          active_run_id: 'run_live',
          created_at_unix_ms: 1_000,
          updated_at_unix_ms: 2_000,
          last_message_at_unix_ms: 2_000,
          last_message_preview: 'This preview must not become a transcript message.',
          model_io_status: { run_id: 'run_live', phase: 'streaming', updated_at_ms: 2_000 },
          read_status: readStatus(),
        }],
      })),
    }));

    const [summary] = await adapter.listThreads();

    expect(summary.messages).toEqual([]);
    expect(summary.model_io_status).toBeUndefined();
    expect(summary.active_run_id).toBe('run_live');
  });

  it('preserves linked-context host capabilities independently from activity file actions', async () => {
    const openLinkedFilePreview = vi.fn(async () => undefined);
    const openLinkedDirectoryBrowser = vi.fn(async () => undefined);
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({}, {
      openLinkedFilePreview,
      openLinkedDirectoryBrowser,
    }));
    const request = {
      path: '/workspace/src/app.ts',
      thread_id: 'thread_1',
      message_id: 'message_1',
      context_index: 0,
      source_surface: 'file_preview' as const,
      target: 'current',
    };

    await adapter.openLinkedFilePreview?.(request);
    await adapter.openLinkedDirectoryBrowser?.({ ...request, path: '/workspace/src' });

    expect(openLinkedFilePreview).toHaveBeenCalledWith(request);
    expect(openLinkedDirectoryBrowser).toHaveBeenCalledWith({ ...request, path: '/workspace/src' });
    expect(adapter.openFilePreview).toBeUndefined();
    expect(adapter.openFileBrowser).toBeUndefined();
  });

  it('delegates current model updates through the host option', async () => {
    const nextSnapshot = {
      ...settingsSnapshot(),
      model_profile: {
        ...settingsSnapshot().model_profile!,
        current_model_id: 'default/gpt-5.4',
      },
    };
    const persistDefaultModel = vi.fn(async () => nextSnapshot);
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({}, { persistDefaultModel }));

    const snapshot = await adapter.persistDefaultModel(' default/gpt-5.4 ');

    expect(persistDefaultModel).toHaveBeenCalledWith('default/gpt-5.4');
    expect(snapshot.model_profile?.current_model_id).toBe('default/gpt-5.4');
  });

  it('forwards synchronous thread deletion without a lifecycle receipt', async () => {
    const deleteThread = vi.fn(async () => undefined);
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ deleteThread }));

    await expect(adapter.deleteThread?.(' thread_1 ')).resolves.toBeUndefined();
    expect(deleteThread).toHaveBeenCalledWith('thread_1');
  });

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

  it('reads terminal process output through the runtime transport with bounded query values', async () => {
    const readTerminalProcess = vi.fn(async () => ({
      process_id: 'tp_live',
      status: 'running',
      output: 'tick 1\n',
	  first_seq: 2,
      last_seq: 2,
	  latest_seq: 2,
	  has_more: false,
	  truncated: false,
    }));
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ readTerminalProcess }));

    const result = await adapter.readTerminalProcess?.({
      run_id: ' run_live ',
      process_id: ' tp_live ',
	  after_seq: 2,
    });

    expect(readTerminalProcess).toHaveBeenCalledWith('run_live', 'tp_live', {
      after_seq: 2,
    });
    expect(result?.output).toBe('tick 1\n');
  });

	it('rejects invalid terminal process cursors instead of normalizing them', async () => {
	  const readTerminalProcess = vi.fn();
	  const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ readTerminalProcess }));

	  await expect(adapter.readTerminalProcess?.({
		run_id: 'run_live',
		process_id: 'tp_live',
		after_seq: 2.8,
	  })).rejects.toThrow('Invalid terminal output sequence.');
	  expect(readTerminalProcess).not.toHaveBeenCalled();
	});

  it('patches thread permission type and reloads the thread', async () => {
    const patchThread = vi.fn(async () => ({ thread: { thread_id: 'thread_permission', read_status: readStatus() } }));
    const loadThread = vi.fn(async () => ({
	      thread: {
        thread_id: 'thread_permission',
        title: 'Permission thread',
        title_status: 'ready',
        run_status: 'running',
        model_id: 'default/gpt-5',
        permission_type: 'full_access',
        created_at_unix_ms: 1,
        updated_at_unix_ms: 2,
        read_status: readStatus(),
	      },
	      current: { thread: { id: 'thread_permission' }, version: 5 },
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

  it('submits approvals with typed thread and interaction identity', async () => {
    const result = approvalResult('thread_1', 'action_1', true, 13);
    const submitApproval = vi.fn(async () => result);
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ submitApproval }));

    const receipt = await adapter.submitApproval({
      thread_id: ' thread_1 ',
      interaction_id: ' action_1 ',
      approved: true,
    });

    expect(submitApproval).toHaveBeenCalledWith({
      thread_id: 'thread_1',
      interaction_id: 'action_1',
      approved: true,
    });
    expect(receipt).toEqual(result);
  });

  it('rejects missing typed approval identity before transport', async () => {
    const submitApproval = vi.fn(async () => approvalResult('thread_1'));
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ submitApproval }));

    await expect(adapter.submitApproval({ thread_id: '', interaction_id: 'action_1', approved: true })).rejects.toThrow(/thread/i);
    await expect(adapter.submitApproval({ thread_id: 'thread_1', interaction_id: '', approved: true })).rejects.toThrow(/interaction/i);
    expect(submitApproval).not.toHaveBeenCalled();
  });

  it('passes working directory picker requests through adapter options', async () => {
    const getWorkingDirectoryPathContext = vi.fn(async () => ({
      agentHomePathAbs: '/Users/alice/.redeven/local-environment',
      homePathAbs: '/Users/alice',
      defaultRootId: 'home',
      roots: [],
    }));
    const listWorkingDirectoryEntries = vi.fn(async () => [{
      name: 'redeven',
      path: '/Users/alice/redeven',
      isDirectory: true,
    }]);
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({}, {
      getWorkingDirectoryPathContext,
      listWorkingDirectoryEntries,
    }));

    await expect(adapter.getWorkingDirectoryPathContext?.()).resolves.toEqual({
      agentHomePathAbs: '/Users/alice/.redeven/local-environment',
      homePathAbs: '/Users/alice',
      defaultRootId: 'home',
      roots: [],
    });
    await expect(adapter.listWorkingDirectoryEntries?.({
      path: '/Users/alice',
      showHidden: true,
    })).resolves.toEqual([{
      name: 'redeven',
      path: '/Users/alice/redeven',
      isDirectory: true,
    }]);
    expect(listWorkingDirectoryEntries).toHaveBeenCalledWith({
      path: '/Users/alice',
      showHidden: true,
    });
  });
});
