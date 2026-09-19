import { render } from 'solid-js/web';
import { onTestFinished, vi } from 'vitest';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import {
  FlowerSurface, createFlowerComposerDraftCoordinator,
  type FlowerSettingsSnapshot, type FlowerSurfaceAdapter, type FlowerThreadSnapshot, type FlowerThreadView,
} from '../../../../flower_ui/src';

// Media acceptance uses the real UI components; only Runtime responses are fixtures.
export const waitFor = async (condition: () => boolean) => vi.waitFor(() => {
  if (!condition()) throw new Error('Media surface condition is not ready');
}, { timeout: 3000 });

export function thread(overrides: Partial<FlowerThreadSnapshot>): FlowerThreadSnapshot {
  return {
    thread_id: 'media-thread', title: 'Media review', title_status: 'ready', title_generation: 1,
    model_id: 'openai/gpt-5.2', working_dir: '/workspace/redeven', settings_revision: 1,
    created_at_ms: 1, updated_at_ms: 2, status: 'idle', source_label: 'Local Environment', target_labels: [],
    read_status: { is_unread: false, snapshot: { activity_revision: 2 }, read_state: { last_seen_activity_revision: 2 } },
    messages: [], ...overrides,
  };
}

export function liveBootstrap(value: FlowerThreadSnapshot, version: number): FlowerThreadView {
  return { thread: value, current: {
    thread_id: value.thread_id, view_version: version, activity: 'idle', queue: [], interactions: [],
    items: value.messages.map((message, index) => ({
      id: message.id, turn_id: message.turn_id ?? 'media-turn', run_id: 'media-run', ordinal: index + 1,
      kind: message.role === 'assistant' ? 'assistant' : 'user', text: message.content,
    })),
  } };
}

export function adapter(configured: boolean): FlowerSurfaceAdapter {
  const settings: FlowerSettingsSnapshot = {
    defaults: { permission_type: 'approval_required' },
    model_profile: { schema_version: 1, current_model_id: 'openai/gpt-5.2', providers: [
      { id: 'openai', name: 'OpenAI', type: 'openai', models: [{ model_name: 'gpt-5.2', context_window: 400000, input_modalities: ['text'] }] },
    ] },
    provider_secrets: [{ provider_id: 'openai', provider_api_key_configured: configured, web_search_api_key_configured: false }],
  };
  const unused = async (): Promise<never> => { throw new Error('Unexpected Runtime operation in media acceptance'); };
  return {
    runtime: { runtime_id: 'media-runtime', runtime_kind: 'env_local', carrier_kind: 'runtime', display_name: 'Local Environment', subtitle: 'Local workspace' },
    loadSettings: async () => settings, saveDefaultPermission: unused, saveModelProfile: unused,
    persistDefaultModel: unused, listThreads: unused, loadThread: unused, loadSubagentDetail: unused,
    markThreadRead: async (_threadID, snapshot) => ({ is_unread: false, snapshot, read_state: { last_seen_activity_revision: snapshot.activity_revision } }),
    resolveHandler: async () => ({
      decision_id: 'media-decision', decision_revision: 1, route: 'env_local', reason_code: 'runtime_available',
      selected_handler: { handler_id: 'media-runtime', handler_kind: 'env_local', display_name: 'Local Environment', carrier_kind: 'runtime', state: 'online', selection_source: 'router_default', supports_thread_kinds: ['chat'] },
      available_handlers: [], unavailable_handlers: [],
      handler_selection: { can_switch: false, requires_user_visible_confirmation: false },
      decision_scope: { thread_kind: 'chat', client_surface: 'flower_surface' },
      runtime_presence: { schema_version: 1, runtime_id: 'media-runtime', runtime_kind: 'env_local', carrier_kind: 'runtime', display_name: 'Local Environment', state: 'online', endpoint: { visibility: 'local' }, capabilities: ['chat'], last_seen_at_unix_ms: 1 },
      allowed_actions: ['start_thread'], ui_chips: [], created_at_unix_ms: 1,
    }),
    createAttachmentStagingScope: async (targetID) => ({ staging_scope_id: 'media-staging', target_id: targetID ?? 'media-new', capability: 'fixture-capability', expires_at_unix_ms: Date.now() + 60000 }),
    releaseAttachmentStagingScope: async () => undefined,
    launchTurn: unused, retryThread: unused, stopThread: unused, submitInput: unused, submitApproval: unused,
  };
}

export function renderSurfaceWithAdapter(adapter: FlowerSurfaceAdapter): HTMLDivElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const surfaceAdapter: FlowerSurfaceAdapter = { ...adapter, connectLiveStream: async function* ({ signal }) {
    yield { schema_version: 1, kind: 'ready', summaries: await adapter.listThreads() };
    if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
  } };
  const dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <FlowerSurface adapter={surfaceAdapter} draftCoordinator={createFlowerComposerDraftCoordinator()} notify={notification => { throw new Error(notification.message); }} />
  </LayoutProvider></FloeConfigProvider>, host);
  onTestFinished(() => { dispose(); host.remove(); });
  return host;
}
