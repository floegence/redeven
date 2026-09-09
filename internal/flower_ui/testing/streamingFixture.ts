import { applyFlowerRuntimeCurrentView } from '../src/runtimeCurrentView';
import type { FlowerRuntimeCurrentView, FlowerSettingsSnapshot, FlowerSurfaceAdapter, FlowerThreadSnapshot, FlowerLiveStreamEnvelope, FlowerActivityItem, FlowerRouterDecision } from '../src/contracts/flowerSurfaceContracts';

export function streamingFixture(messageCount = 72, toolCount = 20) {
  const threadID = 'flower-streaming-fixture';
  const turnID = 'fixture-turn';
  const runID = 'fixture-run';
  const items: NonNullable<FlowerRuntimeCurrentView['items']>[number][] = [];
  const tool = (index: number): FlowerActivityItem => {
    const common = { item_id: `tool-${index}`, tool_id: `tool-${index}`, kind: 'tool' as const, status: 'success' as const, severity: 'quiet' as const, needs_attention: false, requires_approval: false };
    switch (index % 5) {
      case 0: return { ...common, tool_name: 'terminal.exec', renderer: 'terminal', label: 'Inspect workspace', payload: { operation: 'exec', command: 'git status --short', output: 'Workspace inspection complete.\n'.repeat(12), exit_code: 0 } };
      case 1: return { ...common, tool_name: 'file.read', renderer: 'file', label: 'Read README.md', target_refs: [{ kind: `file_action:file-${index}`, label: 'README.md' }], payload: { operation: 'read', display_name: 'README.md', content: '# Architecture\n\nStable presentation data.\n'.repeat(20), line_count: 60, total_lines: 60 } };
      case 2: return { ...common, tool_name: 'inspect', renderer: 'structured', label: 'Inspect structured results', payload: { rows: [{ title: 'Summary', content: 'Stable result row', format: 'text' }, { title: 'Code', content: 'const result = true;', format: 'code' }] } };
      case 3: return { ...common, tool_name: 'write_todos', renderer: 'todos', label: 'Update task checklist', payload: { items: [{ text: 'Inspect current state', status: 'completed' }, { text: 'Verify interactions', status: 'in_progress' }] } };
      default: return { ...common, tool_name: 'web_search', renderer: 'web_search', label: 'Search documentation', payload: { query: 'streaming interface', results: [{ title: 'Documentation', url: 'https://example.com/docs', snippet: 'Stable search result.' }] } };
    }
  };
  const textCount = Math.max(1, messageCount - toolCount - 1);
  for (let index = 0; index < textCount; index += 1) {
    items.push({ id: `message-${index}`, ordinal: items.length + 1, kind: index % 2 === 0 ? 'user' : 'assistant', turn_id: turnID, run_id: runID, created_at: '2026-09-09T00:00:00Z', text: `Message ${index + 1}\n\n${'Review the workspace and preserve the current interaction. '.repeat(3)}` });
    if (index >= textCount - toolCount && toolCount > 0) {
      const activity = tool(index - (textCount - toolCount));
      const { label, renderer, payload, target_refs, ...facts } = activity;
      items.push({ id: activity.item_id, ordinal: items.length + 1, kind: 'tool', turn_id: turnID, run_id: runID, created_at: '2026-09-09T00:00:00Z', activity: { ...facts, presentation: { label, renderer, payload, target_refs } } });
    }
  }
  items.push({ id: 'streaming-tail', ordinal: items.length + 1, kind: 'assistant', turn_id: turnID, run_id: runID, created_at: '2026-09-09T00:00:00Z', live: true, text: '# Streaming answer\n\n' });
  let current: FlowerRuntimeCurrentView = { thread_id: threadID, view_version: 1, activity: 'active', turn_id: turnID, run_id: runID, run_progress: { phase: 'streaming' }, items, queue: [
    { id: 'queued-first', request_key: 'queued-first', created_at: '2026-09-09T00:00:00Z', input: { text: 'Review the changes after this turn.' } },
    { id: 'queued-second', request_key: 'queued-second', created_at: '2026-09-09T00:00:00Z', input: { text: 'Run the interaction checks.' } },
  ], interactions: [] };
  const thread: FlowerThreadSnapshot = {
    thread_id: threadID, title: 'Streaming interface review', title_status: 'ready', title_generation: 1, model_id: 'fixture/model', working_dir: '/workspace', settings_revision: 1, created_at_ms: 1, updated_at_ms: 2,
    status: 'running', source_label: 'Performance fixture', target_labels: [], messages: [], active_run_id: runID, run_progress: { phase: 'streaming', turn_id: turnID, run_id: runID },
    read_status: { is_unread: false, snapshot: { activity_revision: 2 }, read_state: { last_seen_activity_revision: 2 } },
  };
  const settings: FlowerSettingsSnapshot = { defaults: { permission_type: 'approval_required' }, model_profile: { schema_version: 1, current_model_id: 'fixture/model', providers: [{ id: 'fixture', name: 'Fixture', type: 'openai', models: [{ model_name: 'model', context_window: 400_000, input_modalities: ['text'] }] }] }, provider_secrets: [{ provider_id: 'fixture', provider_api_key_configured: true, web_search_api_key_configured: false }] };
  const pending: FlowerLiveStreamEnvelope[] = [];
  let wake: (() => void) | undefined;
  const calls = { connections: 0, loads: 0, terminal: 0, preview: 0, delete: 0 };
  const emit = (value: FlowerLiveStreamEnvelope) => { pending.push(value); wake?.(); };
  const unavailable = async (): Promise<never> => { throw new Error('Action is outside the streaming fixture'); };
  const adapter: FlowerSurfaceAdapter = {
    loadSubagentDetail: unavailable, resolveHandler: async () => fixtureDecision(), launchTurn: unavailable, retryThread: unavailable, stopThread: unavailable, submitInput: unavailable, submitApproval: unavailable,
    persistDefaultModel: async () => settings,
    markThreadRead: async (_threadID, snapshot) => ({ is_unread: false, snapshot, read_state: { last_seen_activity_revision: snapshot.activity_revision } }),
    runtime: { runtime_id: 'fixture', runtime_kind: 'env_local', carrier_kind: 'runtime', display_name: 'Local fixture', subtitle: 'Deterministic streaming' },
    loadSettings: async () => settings, saveDefaultPermission: async () => settings, saveModelProfile: async () => settings,
    listThreads: async () => [thread], loadThread: async () => { calls.loads += 1; return { thread: applyFlowerRuntimeCurrentView(thread, current), current }; },
    keepLiveWhenHidden: true,
    async *connectLiveStream({ signal }) {
      calls.connections += 1;
      const abort = () => wake?.(); signal.addEventListener('abort', abort, { once: true });
      try { while (!signal.aborted) { const value = pending.shift(); if (value) yield value; else await new Promise<void>((resolve) => { wake = resolve; }); } }
      finally { signal.removeEventListener('abort', abort); }
    },
    deleteQueuedTurn: async (_threadID, queueID) => { calls.delete += 1; current = { ...current, view_version: current.view_version + 1, queue: current.queue?.filter((item) => item.id !== queueID) }; return { thread: applyFlowerRuntimeCurrentView(thread, current), current }; },
    openFilePreview: async () => { calls.preview += 1; },
    readTerminalProcess: async () => { calls.terminal += 1; return new Promise(() => undefined); },
  };
  return { adapter, thread, calls, emit, current: () => current,
    replace(next: FlowerRuntimeCurrentView, extras: Partial<FlowerLiveStreamEnvelope> = {}) { current = next; emit({ schema_version: 1, kind: 'thread.batch', thread_id: threadID, current, ...extras }); },
    append(text: string) { current = { ...current, view_version: current.view_version + 1, items: current.items?.map((item) => item.id === 'streaming-tail' ? { ...item, text: `${item.text}${text}` } : item) }; emit({ schema_version: 1, kind: 'thread.batch', thread_id: threadID, current: structuredClone(current) }); },
  };
}

function fixtureDecision(): FlowerRouterDecision {
  return {
    decision_id: 'decision-1',
    decision_revision: 1,
    route: 'env_local',
    reason_code: 'runtime_available',
    selected_handler: {
      handler_id: 'local-environment',
      handler_kind: 'env_local',
      display_name: 'Local Environment',
      carrier_kind: 'runtime',
      state: 'online',
      selection_source: 'router_default',
      supports_thread_kinds: ['chat'],
    },
    available_handlers: [],
    unavailable_handlers: [],
    handler_selection: {
      can_switch: false,
      requires_user_visible_confirmation: true,
    },
    decision_scope: {
      thread_kind: 'chat',
      client_surface: 'flower_surface',
    },
    runtime_presence: {
      schema_version: 1,
      runtime_id: 'local-environment',
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: 'Local Environment',
      state: 'online',
      endpoint: { visibility: 'local' },
      capabilities: ['chat'],
      last_seen_at_unix_ms: 1,
    },
    allowed_actions: ['start_thread'],
    ui_chips: [{ kind: 'runtime', label: 'Using Local AI Profile', tone: 'normal' }],
    blocker: null,
    created_at_unix_ms: 1,
  };
}
