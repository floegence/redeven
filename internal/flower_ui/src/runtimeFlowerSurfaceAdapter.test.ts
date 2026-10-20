import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerApprovalCommandResult,
  FlowerRouterDecision,
  FlowerSettingsDraft,
  FlowerSettingsSnapshot,
  FlowerThreadReadStatus,
  FlowerLiveStreamConnectInput,
} from './contracts/flowerSurfaceContracts';
import { flowerLiveWireFixture } from './test/flowerLiveWireFixture';
import {
  createRuntimeFlowerSurfaceAdapter,
  type FlowerRuntimeTransport,
  type RuntimeFlowerSurfaceAdapterOptions,
} from './runtimeFlowerSurfaceAdapter';

function readStatus(): FlowerThreadReadStatus {
  return {
    is_unread: false,
    snapshot: { activity_revision: 42 },
    read_state: { last_seen_activity_revision: 42 },
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
      run_id: `run:${threadID}`,
      interactions: [{ id: interactionID, turn_id: 'turn-fixture', run_id: 'run-fixture', kind: 'approval', resolved: true, approved }],
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
  transportOverrides: Partial<Omit<FlowerRuntimeTransport, 'connectLiveStream'>> & {
    connectLiveStream?: (input: FlowerLiveStreamConnectInput) => AsyncIterable<unknown>;
  } = {},
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
    ...transportOverrides,
    connectLiveStream: transportOverrides.connectLiveStream ? async function* (input) {
      for await (const envelope of transportOverrides.connectLiveStream!(input)) yield* flowerLiveWireFixture(envelope);
    } : undefined,
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
  it('passes the independent source icon resolver through read-only adapters', async () => {
    const resolveSourceIcon = vi.fn(async () => ({ expires_at: '2027-01-13T00:00:00Z' }));
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({}, { canMutate: false, resolveSourceIcon }));
    await adapter.resolveSourceIcon?.('https://example.com');
    expect(resolveSourceIcon).toHaveBeenCalledExactlyOnceWith('https://example.com');
  });
  it('rejects the removed unfragmented wire shape at the production adapter boundary', async () => {
    const base = adapterOptions();
    const adapter = createRuntimeFlowerSurfaceAdapter({ ...base, transport: {
      ...base.transport,
      connectLiveStream: async function* () { yield { data: '{"schema_version":1,"kind":"ready"}' }; },
    } });
    const iterator = adapter.connectLiveStream!({ signal: new AbortController().signal })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toMatchObject({ code: 'flower_live_sync_error' });
  });

  it('maps the full reconstructed large current rather than a partial history projection', async () => {
    const current = {
      thread_id: 'large', view_version: 20705, activity: 'active', run_id: 'run', turn_id: 'turn',
      items: Array.from({ length: 395 }, (_, index) => ({ id: `history-${index}`, kind: 'assistant', ordinal: index,
        turn_id: `turn-${index}`, run_id: `run-${index}`, text: 'historical text '.repeat(260) })),
    };
    const base = adapterOptions();
    const adapter = createRuntimeFlowerSurfaceAdapter({ ...base, transport: {
      ...base.transport,
      connectLiveStream: async function* () { yield* flowerLiveWireFixture({ schema_version: 1, kind: 'thread.batch', thread_id: 'large', current }); },
    } });
    const iterator = adapter.connectLiveStream!({ signal: new AbortController().signal })[Symbol.asyncIterator]();
    expect(await iterator.next()).toMatchObject({ done: false, value: { current } });
    expect((await iterator.next()).done).toBe(true);
  });

  it('rejects an unsupported logical schema after assembly', async () => {
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ connectLiveStream: async function* () {
      yield { schema_version: 2, kind: 'ready' };
    } }));
    const iterator = adapter.connectLiveStream!({ signal: new AbortController().signal })[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow('unsupported schema version');
  });

  it('preserves closed safety classifications from the real frame transport', async () => {
    const frame = { session_id: 'observer', target_id: 'task-page', viewer_revision: 1, sequence: 1, mime_type: 'image/png', error_code: 'computer_control_required' };
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ connectLiveStream: async function* () {
      yield { schema_version: 1, kind: 'computer.frame', thread_id: 'task', computer_frame: { ...frame, assistance_kind: 'captcha' } };
      yield { schema_version: 1, kind: 'computer.frame', thread_id: 'task', computer_frame: { ...frame, assistance_kind: 'untrusted arbitrary page text' } };
    } }));
    const frames = [];
    for await (const envelope of adapter.connectLiveStream!({ signal: new AbortController().signal })) frames.push(envelope.computer_frame);
    expect(frames[0]).toEqual({ ...frame, assistance_kind: 'captcha' });
    expect(frames[1]).toEqual(frame);
  });

  it('keeps computer status reasons inside the closed, non-sensitive contract', async () => {
    const statuses = [
      { thread_id: 'task', interaction_id: 'input-1', target_id: 'browser-1', state: 'unavailable', reason_code: 'target_closed', at_unix_ms: 10 },
      { thread_id: 'task', interaction_id: 'input-1', target_id: 'browser-1', state: 'unavailable', reason_code: 'password=secret', at_unix_ms: 11 },
    ];
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ connectLiveStream: async function* () {
      for (const computer_status of statuses) yield { schema_version: 1, kind: 'computer.status', thread_id: 'task', computer_status };
    } }));
    const received = [];
    for await (const envelope of adapter.connectLiveStream!({ signal: new AbortController().signal })) received.push(envelope.computer_status);
    expect(received[0]).toEqual({ ...statuses[0] });
    expect(received[1]).toEqual({ thread_id: 'task', interaction_id: 'input-1', target_id: 'browser-1', state: 'unavailable', at_unix_ms: 11 });
  });

  it('returns a named fork summary without coupling creation to detail loading', async () => {
    const forkThread = vi.fn(async () => ({
      client_request_id: 'fork-request',
      thread: {
        thread_id: 'fork-result', title: 'Source · Fork', title_status: 'ready', title_generation: 1,
        model_id: 'default/gpt-5', working_dir: '/workspace', run_status: 'idle',
        created_at_unix_ms: 1, updated_at_unix_ms: 2, read_status: readStatus(),
      },
    }));
    const options = adapterOptions({ forkThread });
    const adapter = createRuntimeFlowerSurfaceAdapter(options);
    const input = { client_request_id: 'fork-request', title: 'Source · Fork' };
    await expect(adapter.forkThread!('source', input)).resolves.toMatchObject({ thread_id: 'fork-result', title: input.title });
    expect(forkThread).toHaveBeenCalledWith('source', input);
    expect(options.transport.loadThread).not.toHaveBeenCalled();
  });

  it('rejects a fork response with a different request identity', async () => {
    const options = adapterOptions({ forkThread: vi.fn(async () => ({ client_request_id: 'other' })) });
    await expect(createRuntimeFlowerSurfaceAdapter(options).forkThread!('source', { client_request_id: 'fork-request', title: 'Source · Fork' })).rejects.toThrow('different client request identity');
    expect(options.transport.loadThread).not.toHaveBeenCalled();
  });
  it('maps pin acknowledgements without loading thread detail and rejects incomplete metadata', async () => {
    const pin = { thread_id: 'thread', pinned_at_unix_ms: 10, pin_rank: 4, settings_revision: 20 };
    const shifted = { thread_id: 'existing', pinned_at_unix_ms: 5, pin_rank: 5, settings_revision: 21 };
    const patchThread = vi.fn(async () => ({ thread: pin, pins: [shifted, pin] }));
    const movePinnedThread = vi.fn(async () => ({ pins: [pin] }));
    const options = adapterOptions({ patchThread, movePinnedThread });
    const adapter = createRuntimeFlowerSurfaceAdapter(options);
    const expected = { thread_id: 'thread', pinned_at_ms: 10, pin_rank: 4, settings_revision: 20 };
    expect(await adapter.setThreadPinned!('thread', true)).toEqual([
      { thread_id: 'existing', pinned_at_ms: 5, pin_rank: 5, settings_revision: 21 }, expected,
    ]);
    expect(await adapter.movePinnedThread!('thread', { anchor_thread_id: 'anchor', placement: 'after' })).toEqual([expected]);
    expect(options.transport.loadThread).not.toHaveBeenCalled();
    patchThread.mockResolvedValueOnce({ thread: { ...pin, settings_revision: undefined }, pins: [pin] } as never);
    await expect(adapter.setThreadPinned!('thread', true)).rejects.toThrow('Invalid pinned conversation metadata');
    patchThread.mockResolvedValueOnce({ thread: pin } as never);
    await expect(adapter.setThreadPinned!('thread', true)).rejects.toThrow('Invalid pinned conversation metadata');
    patchThread.mockResolvedValueOnce({ thread: pin, pins: [shifted] } as never);
    await expect(adapter.setThreadPinned!('thread', true)).rejects.toThrow('Invalid pinned conversation metadata');
    patchThread.mockResolvedValueOnce({ thread: shifted, pins: [shifted, { ...pin, pinned_at_unix_ms: 5, pin_rank: 5, settings_revision: 21 }] });
    await expect(adapter.setThreadPinned!('thread', true)).rejects.toThrow('Invalid pinned conversation metadata');
    patchThread.mockResolvedValueOnce({ thread: pin, pins: [pin, pin] });
    await expect(adapter.setThreadPinned!('thread', true)).rejects.toThrow('Invalid pinned conversation metadata');
  });

	it('treats stop as an acknowledgement without mapping or loading thread detail', async () => {
		const loadThread = vi.fn(async () => { throw new Error('loadThread must not race stop'); });
		const stopThread = vi.fn(async () => ({ ok: true }));
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ loadThread }, { stopThread }));

		await expect(adapter.stopThread(' thread_stop ')).resolves.toBeUndefined();

		expect(stopThread).toHaveBeenCalledWith('thread_stop');
		expect(loadThread).not.toHaveBeenCalled();
	});

	it('keeps read_status strict for thread detail after decoupling stop', async () => {
		const loadThread = vi.fn(async () => ({
			thread: {
				thread_id: 'thread_detail', title: 'Detail', title_status: 'ready', title_generation: 1, model_id: 'default/gpt-5',
				permission_type: 'approval_required', working_dir: '/workspace', queued_turn_count: 0,
				run_status: 'idle', created_at_unix_ms: 1, updated_at_unix_ms: 2,
			},
			current: { thread_id: 'thread_detail', view_version: 1 },
		}));
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ loadThread }));

		await expect(adapter.loadThread('thread_detail', new AbortController().signal)).rejects.toThrow('Flower contract error: thread.read_status is required.');
	});

	it('loads product metadata and typed current view without polling', async () => {
		const loadThread = vi.fn(async () => ({
			thread: {
				thread_id: 'thread_detail',
				title: 'Fallback title',
				title_status: 'failed', title_generation: 1,
				model_id: 'default/gpt-5',
				permission_type: 'approval_required',
				working_dir: '/workspace',
				queued_turn_count: 0,
				run_status: 'running',
				active_run_id: 'run_detail',
				run_progress: { run_id: 'run_detail', turn_id: 'turn-fixture', phase: 'preparing' },
				created_at_unix_ms: 1,
				updated_at_unix_ms: 2,
				last_message_at_unix_ms: 2,
				read_status: readStatus(),
			},
				current: {
					thread_id: 'thread_detail',
					view_version: 7,
				activity: 'active',
				run_id: 'run_detail',
				turn_id: 'turn-fixture',
				  run_progress: { phase: 'preparing' },
				items: [{ id: 'user:req-1', turn_id: 'turn-fixture', run_id: 'run-fixture', ordinal: 1, kind: 'user', text: 'hello' }],
			},
		}));
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ loadThread }));

		const detail = await adapter.loadThread('thread_detail', new AbortController().signal);

		expect(detail.thread.thread_id).toBe('thread_detail');
		expect(detail.thread.title).toBe('Fallback title');
			expect(detail.current.view_version).toBe(7);
		expect(detail.thread.messages).toEqual(expect.arrayContaining([
			expect.objectContaining({ id: 'user:req-1', role: 'user', content: 'hello' }),
		]));
		expect(detail).not.toHaveProperty('cursor');
		expect(detail).not.toHaveProperty('stream_generation');
		expect(detail).not.toHaveProperty('live_state');
	});

	it('loads one typed Subagent current without pagination parameters', async () => {
		const loadSubagentDetail = vi.fn(async () => ({
			detail: {
				summary: {
					parent_thread_id: 'parent-detail', thread_id: 'child-detail', task_name: 'Inspect detail', title: 'Inspect detail', title_status: 'ready' as const, title_generation: 1, status: 'running',
					can_send_input: false, can_interrupt: true, can_close: true,
				},
				current: { thread_id: 'child-detail', view_version: 4, activity: 'active' as const },
                model_context: { snapshot: { sections: [{ key: 'skills', title: 'Skills', text: 'Child catalog' }] }, entry_id: 'entry-child', path_depth: 1, turn_id: 'turn-child', run_id: 'run-child', updated_at: '2026-10-15T12:00:00Z', changed_keys: ['skills'], removed_keys: [] },
			},
		}));
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ loadSubagentDetail }));

		const detail = await adapter.loadSubagentDetail(' parent-detail ', ' child-detail ');

		expect(loadSubagentDetail).toHaveBeenCalledWith('parent-detail', 'child-detail');
		expect(detail.current.view_version).toBe(4);
        expect(detail.model_context?.snapshot.sections[0].text).toBe('Child catalog');
		expect(detail).toEqual(expect.not.objectContaining({ timeline: expect.anything(), generated_at_ms: expect.anything() }));
	});

	it('trims and forwards canonical continuation retries', async () => {
		const retryThread = vi.fn(async () => undefined);
		const loadThread = vi.fn(async () => ({
			thread: {
				thread_id: 'thread_1',
				title: 'Retry',
				title_status: 'ready', title_generation: 1,
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

		await expect(adapter.retryThread(' thread_1 ')).resolves.toBeUndefined();
		expect(retryThread).toHaveBeenCalledWith('thread_1');
		expect(loadThread).not.toHaveBeenCalled();
		await expect(adapter.retryThread('  ')).rejects.toThrow();
	});

	it('keeps read APIs while removing mutation affordances for read-only viewers', () => {
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ sendQueuedTurnNow: vi.fn(async () => undefined) }, { canMutate: false }));

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
		expect(adapter.sendQueuedTurnNow).toBeUndefined();
		expect(adapter.uploadAttachment).toBeUndefined();
	});

	it('deletes one canonical queued turn and reconciles from the thread bootstrap', async () => {
		const deleteQueuedTurn = vi.fn(async () => undefined);
		const loadThread = vi.fn(async () => ({
				thread: {
				thread_id: 'thread_1',
				title: 'Queue',
				title_status: 'ready', title_generation: 1,
				model_id: 'default/gpt-5',
				permission_type: 'approval_required',
				working_dir: '/workspace',
				queued_turn_count: 0,
					run_status: 'running',
					active_run_id: 'run_1',
					run_progress: { run_id: 'run_1', turn_id: 'turn_1', phase: 'preparing' },
				created_at_unix_ms: 1,
				updated_at_unix_ms: 2,
				last_message_at_unix_ms: 2,
				read_status: readStatus(),
				},
					current: {
						thread_id: 'thread_1',
						view_version: 4,
						activity: 'active',
						run_id: 'run_1',
						turn_id: 'turn_1',
						run_progress: { phase: 'preparing' },
						items: [],
					},
			}));
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ deleteQueuedTurn, loadThread }));

		const result = await adapter.deleteQueuedTurn?.(' thread_1 ', ' followup_middle ');

		expect(deleteQueuedTurn).toHaveBeenCalledWith('thread_1', 'followup_middle');
		expect(loadThread).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('sends one canonical queued turn now and reconciles from the thread bootstrap', async () => {
		const sendQueuedTurnNow = vi.fn(async () => undefined);
		const loadThread = vi.fn(async () => ({
			thread: {
				thread_id: 'thread_1', title: 'Queue', title_status: 'ready', title_generation: 1,
				model_id: 'default/gpt-5', permission_type: 'approval_required', working_dir: '/workspace',
				queued_turn_count: 0, run_status: 'running', active_run_id: 'run_1',
				run_progress: { run_id: 'run_1', turn_id: 'turn_1', phase: 'preparing' },
				created_at_unix_ms: 1, updated_at_unix_ms: 2, last_message_at_unix_ms: 2, read_status: readStatus(),
			},
			current: { thread_id: 'thread_1', view_version: 4, activity: 'active', run_id: 'run_1', turn_id: 'turn_1', run_progress: { phase: 'preparing' }, items: [] },
		}));
		const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ sendQueuedTurnNow, loadThread }));

		const result = await adapter.sendQueuedTurnNow?.(' thread_1 ', ' followup_first ');

		expect(sendQueuedTurnNow).toHaveBeenCalledWith('thread_1', 'followup_first');
		expect(loadThread).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
		await expect(adapter.sendQueuedTurnNow?.('  ', 'followup_first')).rejects.toThrow();
		await expect(adapter.sendQueuedTurnNow?.('thread_1', '  ')).rejects.toThrow();
		expect(sendQueuedTurnNow).toHaveBeenCalledTimes(1);
	});

		it('maps the published SSE transport into typed Flower envelopes', async () => {
			const connectLiveStream = vi.fn(async function* () {
				yield {
					schema_version: 1,
					kind: 'ready',
					summaries: [{
						thread_id: 'thread_stream',
						title: 'Streaming',
						title_status: 'ready', title_generation: 1,
						model_id: 'default/gpt-5',
						permission_type: 'approval_required',
						working_dir: '/workspace',
						queued_turn_count: 0,
						run_status: 'running',
						active_run_id: 'run_stream',
						run_progress: { run_id: 'run_stream', turn_id: 'turn_stream', phase: 'preparing' },
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
					context_compactions: [{
						operation_id: 'compact_stream', turn_id: 'turn_stream', canonical_ordinal: 7,
						phase: 'noop',
						status: 'noop',
						updated_at_ms: 4,
					}],
					timeline_decorations: [{
						decoration_id: 'context-compaction:compact_stream',
						kind: 'context_compaction',
						anchor: { target_kind: 'message', message_id: 'message_compact', edge: 'after' },
						ordinal: 0,
						compaction: {
							operation_id: 'compact_stream', turn_id: 'turn_stream', canonical_ordinal: 7,
							phase: 'noop',
							status: 'noop',
							updated_at_ms: 4,
						},
					}],
					context_usage: { confirmed: {
						run_id: 'run_stream', phase: 'provider_usage', input_tokens: 500,
						context_window_tokens: 1000, used_ratio: 0.5, pressure_status: 'stable', updated_at_ms: 5,
					} },
					current: {
						thread_id: 'thread_stream',
						view_version: 3,
						activity: 'active',
						run_id: 'run_stream',
						turn_id: 'turn_stream',
						run_progress: { phase: 'streaming' },
					},
				};
				yield {
					schema_version: 1,
					kind: 'viewer.read_state',
					thread_id: 'thread_stream',
					read_status: readStatus(),
				};
				yield {
					schema_version: 1,
					kind: 'thread.batch',
					thread_id: 'thread_stream',
					subagents: [{
						parent_thread_id: 'thread_stream',
						thread_id: 'thread_child',
						task_name: 'Research models', title: 'Research models', title_status: 'ready' as const, title_generation: 1,
						status: 'running',
						can_send_input: true,
						can_interrupt: true,
						can_close: true,
					}],
				};
				yield {
					schema_version: 1,
					kind: 'thread.batch',
					thread_id: 'thread_stream',
					subagent_current: {
						thread_id: 'thread_child', view_version: 6, activity: 'active', run_id: 'run_child',
					},
				};
			});
			const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ connectLiveStream }));
			const controller = new AbortController();
			const frames = [];
			for await (const frame of adapter.connectLiveStream!({
				signal: controller.signal,
			})) frames.push(frame);

			expect(frames).toHaveLength(5);
			expect(frames[0]).toMatchObject({
				kind: 'ready',
				summaries: [{ thread_id: 'thread_stream', messages: [] }],
			});
			expect(frames[1]).toMatchObject({
				kind: 'thread.batch',
				context_usage: { confirmed: { input_tokens: 500, used_ratio: 0.5 } },
				context_compactions: [{ operation_id: 'compact_stream', status: 'noop' }],
				timeline_decorations: [{ decoration_id: 'context-compaction:compact_stream' }],
				current: {
          thread_id: 'thread_stream', view_version: 3, activity: 'active', run_id: 'run_stream', turn_id: 'turn_stream',
          run_progress: { phase: 'streaming' },
        },
			});
			expect(frames[2]).toMatchObject({
				kind: 'viewer.read_state',
				thread_id: 'thread_stream',
				read_status: { is_unread: false },
			});
			expect(frames[3]).toMatchObject({
				kind: 'thread.batch',
				thread_id: 'thread_stream',
				subagents: [{ thread_id: 'thread_child', task_name: 'Research models', title: 'Research models', title_status: 'ready' as const, title_generation: 1, status: 'running' }],
			});
			expect(frames[4]).toMatchObject({
				kind: 'thread.batch',
				thread_id: 'thread_stream',
				subagent_current: { thread_id: 'thread_child', view_version: 6, run_id: 'run_child' },
			});
		});

	it('maps summary-only SSE frames without requiring viewer read state', async () => {
		const connectLiveStream = vi.fn(async function* () {
			yield {
				schema_version: 1,
				kind: 'ready',
				summaries: [{
					thread_id: 'thread_failed',
					title: 'Fallback title',
					title_status: 'failed', title_generation: 1,
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
			summaries: [{ thread_id: 'thread_failed', status: 'failed', messages: [] }],
		});
    expect(frames[0]?.summaries?.[0]).not.toHaveProperty('read_status');
	});
  it('keeps thread-list summaries transcript-free even when preview fields are present', async () => {
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({
      listThreads: vi.fn(async () => ({
        threads: [{
          thread_id: 'thread_summary',
          title: 'Running summary',
          title_status: 'ready', title_generation: 1,
          model_id: 'default/gpt-5',
          permission_type: 'approval_required',
          working_dir: '/workspace',
          queued_turn_count: 0,
          run_status: 'running',
          active_run_id: 'run_live',
          run_progress: { run_id: 'run_live', turn_id: 'turn_live', phase: 'streaming' },
          created_at_unix_ms: 1_000,
          updated_at_unix_ms: 2_000,
          last_message_at_unix_ms: 2_000,
          last_message_preview: 'This preview must not become a transcript message.',
          read_status: readStatus(),
        }],
      })),
    }));

    const [summary] = await adapter.listThreads();

    expect(summary.messages).toEqual([]);
    expect(summary.run_progress).toEqual({ run_id: 'run_live', turn_id: 'turn_live', phase: 'streaming' });
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
    expect(adapter.openMessageFile).toBeUndefined();
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
    });

    expect(result).toEqual({
      ...status,
      snapshot: {
        activity_revision: 42,
      },
      read_state: {
        last_seen_activity_revision: 42,
      },
    });
    expect(markThreadRead).toHaveBeenCalledTimes(1);
    expect(markThreadRead).toHaveBeenCalledWith('thread_1', {
      snapshot: {
        activity_revision: 42,
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

  it('uses the authoritative thread returned by a permission patch', async () => {
    const patchThread = vi.fn(async () => ({
	      thread: {
        thread_id: 'thread_permission',
        title: 'Permission thread',
        title_status: 'ready', title_generation: 1,
          run_status: 'running',
          active_run_id: 'run_permission',
          run_progress: { run_id: 'run_permission', turn_id: 'turn_permission', phase: 'preparing' },
        model_id: 'default/gpt-5',
        permission_type: 'full_access',
        created_at_unix_ms: 1,
        updated_at_unix_ms: 2,
        read_status: readStatus(),
	      },
		      current: { thread_id: 'thread_permission', view_version: 5, activity: 'active' as const, run_id: 'run_permission', turn_id: 'turn_permission', run_progress: { phase: 'preparing' as const }, items: [] },
	    }));
    const loadThread = vi.fn();
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ patchThread, loadThread }));

    const result = await adapter.setThreadPermissionType?.(' thread_permission ', 'full_access');

    expect(patchThread).toHaveBeenCalledWith('thread_permission', { permission_type: 'full_access' });
    expect(loadThread).not.toHaveBeenCalled();
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

  it('forwards the exact batch and rejects ambiguous or invalid selections before transport', async () => {
    const submitApproval = vi.fn(async () => approvalResult('thread_1'));
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ submitApproval }));
    await adapter.submitApproval({ thread_id: 'thread_1', interaction_ids: ['a', 'b'], approved: false });
    expect(submitApproval).toHaveBeenCalledExactlyOnceWith({ thread_id: 'thread_1', interaction_ids: ['a', 'b'], approved: false });
    for (const selection of [
      { interaction_ids: [] }, { interaction_ids: ['a', ''] }, { interaction_ids: ['a', 'a'] },
      { interaction_ids: ['a'], interaction_id: 'b' }, { interaction_ids: ['a'], reject_all: true },
    ]) await expect(adapter.submitApproval({ thread_id: 'thread_1', approved: true, ...selection })).rejects.toThrow(/selection/);
    expect(submitApproval).toHaveBeenCalledTimes(1);
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


describe('canonical title wire contract', () => {
  it('rejects a summary from a runtime without title generation', async () => {
    const listThreads = vi.fn(async () => ({ threads: [{
      thread_id: 'old-runtime', title: 'Old title', title_status: 'ready',
      run_status: 'idle', created_at_unix_ms: 1, updated_at_unix_ms: 1,
      read_status: readStatus(),
    }] }));
    const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ listThreads }));
    await expect(adapter.listThreads()).rejects.toThrow('Flower contract error: invalid canonical title snapshot');
  });
});

it.each([
  ['http rejection', Object.assign(new Error('conflict'), { status: 409 }), false, 'rejected'],
  ['desktop rejection', Object.assign(new Error('denied'), { failureKind: 'response' }), false, 'rejected'],
  ['lost transport', new Error('lost response'), false, 'unknown'],
  ['confirmed edit without hidden reload', Object.assign(new Error('reload denied'), { status: 403 }), true, 'unknown'],
] as const)('classifies queue edits at the canonical confirmation boundary: %s', async (_name, error, confirmed, kind) => {
  const loadThread = vi.fn(async () => { throw error; });
  const editQueuedTurn = vi.fn(async () => { if (!confirmed) throw error; });
  const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ loadThread, editQueuedTurn }));
  const command = { client_request_id: 'edit-1', expected_input_fingerprint: 'a'.repeat(64), prompt: 'new text', retained_attachment_ids: ['image'], retained_reference_ids: ['file'] };
  if (confirmed) await expect(adapter.editQueuedTurn!(' thread ', ' queue ', command)).resolves.toBeUndefined();
  else await expect(adapter.editQueuedTurn!(' thread ', ' queue ', command)).rejects.toMatchObject({ admission_kind: kind });
  expect(editQueuedTurn).toHaveBeenCalledWith('thread', 'queue', command);
  expect(loadThread).not.toHaveBeenCalled();
});

it('reconciles a lost take-back response with the exact same conditional removal', async () => {
  const current = { thread_id: 'thread', view_version: 2, activity: 'idle' as const, queue: [] };
  const takeBackQueuedTurn = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValue(current);
  const loadThread = vi.fn();
  const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ loadThread, prepareQueuedTurnDraft: vi.fn(), takeBackQueuedTurn }));
  await expect(adapter.takeBackQueuedTurn!(' thread ', ' queue ', 'a'.repeat(64))).resolves.toBe(current);
  expect(takeBackQueuedTurn.mock.calls).toEqual(Array(2).fill(['thread', 'queue', 'a'.repeat(64)]));
  expect(loadThread).not.toHaveBeenCalled();
});

it.each([
  [Object.assign(new Error('conflict'), { status: 409 }), 'rejected', 1],
  [Object.assign(new Error('denied'), { failureKind: 'response' }), 'rejected', 1],
  [new Error('disconnected'), 'unknown', 2],
] as const)('classifies a failed take-back without retrying a rejection: %s', async (error, kind, attempts) => {
  const takeBackQueuedTurn = vi.fn().mockRejectedValue(error);
  const adapter = createRuntimeFlowerSurfaceAdapter(adapterOptions({ prepareQueuedTurnDraft: vi.fn(), takeBackQueuedTurn }));
  await expect(adapter.takeBackQueuedTurn!('thread', 'queue', 'a'.repeat(64))).rejects.toMatchObject({ admission_kind: kind });
  expect(takeBackQueuedTurn).toHaveBeenCalledTimes(attempts);
});

it('forwards canonical child input operations and hides them from read-only surfaces', async () => {
  const detail = { summary: { parent_thread_id: 'parent', thread_id: 'child', task_name: 'Review', title: 'Review', title_status: 'ready' as const, title_generation: 1, status: 'running', agent_type: 'reviewer', can_send_input: true, can_interrupt: true, can_close: true }, current: { thread_id: 'child', activity: 'idle' as const, view_version: 1, items: [] } };
  const operation = { action: 'steer_queue' as const, item_id: 'queue:first', expected_input_fingerprint: 'full-input', client_request_id: 'command' };
  const operate = vi.fn(async () => ({ detail }));
  const options = adapterOptions({ operateSubagentInput: operate });
  const adapter = createRuntimeFlowerSurfaceAdapter(options);
  expect(await adapter.operateSubagentInput!('parent', 'child', operation)).toMatchObject({ summary: { parent_thread_id: 'parent', thread_id: 'child' }, current: detail.current });
  expect(operate).toHaveBeenCalledWith('parent', 'child', operation);
  expect(createRuntimeFlowerSurfaceAdapter({ ...options, canMutate: false }).operateSubagentInput).toBeUndefined();
});

it('keeps one adapter while permission changes and rejects captured commands after revocation or disposal', async () => {
  let allowed = true;
  const lifetime = new AbortController();
  const launchTurn = vi.fn();
  const patchThread = vi.fn();
  const adapter = createRuntimeFlowerSurfaceAdapter({ ...adapterOptions({ patchThread }, { launchTurn }), signal: lifetime.signal, get canMutate() { return allowed; } });
  const launch = adapter.launchTurn;
  const rename = adapter.renameThread!;
  allowed = false;
  expect(adapter.canMutate).toBe(false);
  expect(adapter.renameThread).toBeUndefined();
  await expect(launch({ client_request_id: 'request', prompt: 'hello' })).rejects.toMatchObject({ name: 'NotAllowedError' });
  await expect(rename('thread', 'title')).rejects.toMatchObject({ name: 'NotAllowedError' });
  allowed = true;
  expect(adapter.renameThread).toBe(rename);
  lifetime.abort();
  await expect(launch({ client_request_id: 'request', prompt: 'hello' })).rejects.toMatchObject({ name: 'AbortError' });
  expect(launchTurn).not.toHaveBeenCalled();
  expect(patchThread).not.toHaveBeenCalled();
});


it.each(['revoked', 'disposed'] as const)('does not retry a lost take-back response after authority is %s', async reason => {
  let allowed = true;
  const lifetime = new AbortController();
  const takeBackQueuedTurn = vi.fn(async () => {
    if (reason === 'revoked') allowed = false; else lifetime.abort();
    throw new Error('Response lost');
  });
  const adapter = createRuntimeFlowerSurfaceAdapter({ ...adapterOptions({ prepareQueuedTurnDraft: vi.fn(), takeBackQueuedTurn }), signal: lifetime.signal, get canMutate() { return allowed; } });
  await expect(adapter.takeBackQueuedTurn!('thread', 'queued', 'fingerprint')).rejects.toMatchObject({ admission_kind: 'unknown' });
  expect(takeBackQueuedTurn).toHaveBeenCalledOnce();
});
