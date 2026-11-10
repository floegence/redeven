import { modelDirectoryWireFixture } from '../../../internal/envapp/ui_src/src/test/modelDirectoryWireFixture';
import type { RuntimeFlowerAttachmentPrepareRequest } from '../../src/shared/runtimeFlowerAttachmentIPC';
import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from '../../src/welcome/App';
import type { DesktopWelcomeSnapshot } from '../../src/shared/desktopLauncherIPC';
import type { RuntimeFlowerStreamEvent } from '../../src/shared/runtimeFlowerIPC';
import type { FlowerGoal, FlowerGoalInput, FlowerHistoryRequest, FlowerRuntimeCurrentView } from '../../../internal/flower_ui/src/contracts/flowerSurfaceContracts';
import { flowerLiveWireFixture } from '../../../internal/flower_ui/src/test/flowerLiveWireFixture';
import '../../src/welcome/index.css';
import { INTERFACE_DENSITY_MARKDOWN } from '../../../internal/envapp/ui_src/src/ui/FlowerSurface.interfaceDensity.fixture';

declare global {
  interface Window {
    navigationSnapshot: DesktopWelcomeSnapshot;
    navigationFixture: {
      requests: string[];
      turnRequests: unknown[];
      uploads: RuntimeFlowerAttachmentPrepareRequest[];
      streams: number;
      cancellations: number;
      prematureRequests: number;
      goalReads: number;
      goalRequests: FlowerGoalInput[];
      holdGoalReads: boolean;
      releaseGoalRead: (fail?: boolean) => void;
      publishGoal: (text: string, live?: boolean) => void;
      releaseRuntime: () => void;
      releaseBaseline: () => void;
      releaseFirstPage: () => void;
      refreshHealth: () => void;
      publishHTML: (text: string, generating: boolean) => void;
      historyRequests: FlowerHistoryRequest[];
      growSentReply: () => void;
      publish: (patch: Partial<DesktopWelcomeSnapshot>) => void;
      dispose: () => void;
    };
  }
}

let snapshot = window.navigationSnapshot;
let receive: ((value: DesktopWelcomeSnapshot) => void) | undefined;
let receiveStream: ((event: RuntimeFlowerStreamEvent) => void) | undefined;
let receiveStreamID = '';
let aiReady = false;
const goalMode = new URLSearchParams(location.search).has('goal');
const modelPickerMode = new URLSearchParams(location.search).has('model-picker');
let modelPreference: string | undefined;
const progressiveMode = new URLSearchParams(location.search).has('progressive');
const delayedFirstPage = new URLSearchParams(location.search).has('delayed-first-page');
const settledHistory = new URLSearchParams(location.search).has('settled-history');
const activeTail = new URLSearchParams(location.search).has('active-tail');
const sendLatest = new URLSearchParams(location.search).has('send-latest');
let readingInterest: FlowerHistoryRequest = {};
let goal: FlowerGoal = { version: 1, text: 'Confirm the release and preserve every requirement.', actor: 'user', status: 'active' };
let releaseGoalRead: ((fail: boolean) => void) | undefined;
const unavailable = () => ({ ok: false as const, error: { code: 'AI_SERVICE_UNAVAILABLE', status: 503,
  message: 'AI service is unavailable', data: { readiness: { state: 'inspecting', retryable: false, safe_to_retry: false } } } });
const fixture = window.navigationFixture = {
  turnRequests: [] as unknown[], uploads: [] as RuntimeFlowerAttachmentPrepareRequest[],
  requests: [] as string[], streams: 0, cancellations: 0, prematureRequests: 0, dispose: () => {},
  historyRequests: [] as FlowerHistoryRequest[],
  growSentReply() {
    current = { ...current, view_version: current.view_version + 1,
      items: [...current.items ?? [], { id: 'sent-growth', ordinal: 333, kind: 'assistant', turn_id: 'sent-turn', run_id: 'sent-run', text: 'Further live output.\n\n'.repeat(20), live: true }] };
    const next = selectReadingWindow(readingInterest);
    for (const frame of flowerLiveWireFixture({ schema_version: 3, kind: 'thread.batch', thread_id: thread.thread_id,
      reading_revision: readingInterest.reading_revision, current: next, window: next.window }, 'send-' + current.view_version))
      receiveStream?.({ stream_id: receiveStreamID, kind: 'chunk', chunk: new TextEncoder().encode('data: ' + frame.data + '\n\n') });
  },
  goalReads: 0, goalRequests: [] as FlowerGoalInput[], holdGoalReads: false,
  releaseGoalRead(fail = false) { releaseGoalRead?.(fail); releaseGoalRead = undefined; },
  publishGoal(text: string, live = true) {
    goal = { version: goal.version + 1, text, status: 'active', actor: 'model' };
    thread.goal = goal;
    current = { ...current, view_version: current.view_version + 1, goal };
    if (live) for (const frame of flowerLiveWireFixture({ schema_version: 3, kind: 'thread.batch', thread_id: thread.thread_id, current }, 'goal-' + current.view_version))
      receiveStream?.({ stream_id: receiveStreamID, kind: 'chunk', chunk: new TextEncoder().encode('data: ' + frame.data + '\n\n') });
  },
  releaseFirstPage() {
    for (const frame of flowerLiveWireFixture({ schema_version: 3, kind: 'ready', baseline_complete: !progressiveMode, summaries: [thread], ...(sendLatest ? { observer_id: 'desktop-send-observer' } : {}) }, 'navigation-ready'))
      receiveStream?.({ stream_id: receiveStreamID, kind: 'chunk', chunk: new TextEncoder().encode('data: ' + frame.data + '\n\n') });
  },
  releaseBaseline() {
    for (const frame of flowerLiveWireFixture({ schema_version: 3, kind: 'summary.batch', baseline_complete: true, summaries: [{ ...thread, thread_id: 'older-thread', title: 'Older conversation' }] }, 'navigation-complete'))
      receiveStream?.({ stream_id: receiveStreamID, kind: 'chunk', chunk: new TextEncoder().encode('data: ' + frame.data + '\n\n') });
  },
  releaseRuntime() {
    aiReady = true;
    fixture.publish({ environments: snapshot.environments.map(entry => ({ ...entry,
      ...(entry.runtime_service ? { runtime_service: { ...entry.runtime_service, ai_readiness: { state: 'ready' as const } } } : {}),
    })) });
  },
  publishHTML(text: string, generating: boolean) {
    const previous = current;
    const previousText = previous.items?.find(item => item.id === 'density-reading')?.text ?? '';
    current = { ...current, view_version: current.view_version + 1, activity: generating ? 'active' : 'idle',
      turn_id: 'navigation-turn', run_id: 'navigation-run', run_progress: generating ? { phase: 'streaming' } : null,
      items: current.items?.map(item => item.id === 'density-reading' ? { ...item, text, live: generating } : item) };
    const content = generating && previous.activity === 'active' && text.startsWith(previousText)
      ? { update: { thread_id: thread.thread_id, turn_id: 'navigation-turn', run_id: 'navigation-run',
        base_version: previous.view_version, view_version: current.view_version,
        facts: { activity: 'active', queue_count: 0, run_progress: { phase: 'streaming' } },
        items: [{ kind: 'append', item_id: 'density-reading', append: { offset_bytes: new TextEncoder().encode(previousText).length, text: text.slice(previousText.length) } }] } }
      : { current };
    for (const frame of flowerLiveWireFixture({ schema_version: 3, kind: 'thread.batch', thread_id: thread.thread_id, ...content }, 'html-'+current.view_version)) {
      receiveStream?.({ stream_id: receiveStreamID, kind: 'chunk', chunk: new TextEncoder().encode('data: '+frame.data+'\n\n') });
    }
  },
  publish(patch: Partial<DesktopWelcomeSnapshot>) {
    snapshot = { ...snapshot, ...patch, snapshot_revision: (snapshot.snapshot_revision ?? 0) + 1 };
    receive?.(snapshot);
  },
  refreshHealth() {
    fixture.publish({ environments: snapshot.environments.map(entry => ({ ...entry,
      runtime_health: { status: 'online', source: 'local_runtime_probe', freshness: 'fresh', checked_at_unix_ms: Date.now() },
    })) });
  },
};
const thread = {
  thread_id: 'navigation-thread', title: 'Keep this conversation', title_status: 'ready', title_generation: 1,
  model_id: 'fixture/gpt-4.1', run_status: 'idle', working_dir: '/workspace', goal: goalMode ? goal : undefined,
  created_at_unix_ms: 1, updated_at_unix_ms: 2, last_message_at_unix_ms: 2,
  read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } },
};
const mediaMode = new URLSearchParams(location.search).has('media');
const mediaRef = `computer://browser-main/${'a'.repeat(64)}`;
const mediaHTML = '<h1>Daily brief</h1><input aria-label="Reading note"><button onclick="this.textContent=\'Updated\'">Update report</button><a href="#economy">Economy</a><a href="https://example.com/news">News source</a><a href="javascript:alert(1)">Unsupported link</a><section id="economy" style="margin-top:1200px">Economy section</section>';

let current: FlowerRuntimeCurrentView = { thread_id: thread.thread_id, view_version: 1, activity: 'idle', items: [{ id: 'navigation-input', kind: 'user', turn_id: 'navigation-turn', run_id: 'navigation-run', ordinal: 1, text: 'Inspect this workspace' }, { id: 'density-reading', kind: 'assistant', turn_id: 'navigation-turn', run_id: 'navigation-run', ordinal: 2, text: mediaMode ? `Here is the workspace preview.\n\n![Workspace](${mediaRef})\n\n\`\`\`html preview\n${mediaHTML}\n\`\`\`\n\nReady for your next step.` : INTERFACE_DENSITY_MARKDOWN }], queue: [], interactions: [] };
if (sendLatest) current = { ...current, items: Array.from({ length: 330 }, (_, index) => ({
  id: `history-${index}`, ordinal: index + 1, kind: 'assistant', turn_id: 'navigation-turn', run_id: 'navigation-run',
  text: `Historical response ${index}\n\nA paragraph for reading earlier conversation messages.`,
})) };
function selectReadingWindow(input: FlowerHistoryRequest): FlowerRuntimeCurrentView {
  const items = current.items ?? [];
  const anchor = input.anchor_id ? items.findIndex(item => item.id === input.anchor_id) : items.length;
  const limit = input.limit ?? 150;
  const selected = input.item_ids ? items.filter(item => input.item_ids!.includes(item.id))
    : input.direction === 'after' ? items.slice(anchor + 1, anchor + 1 + limit) : items.slice(Math.max(0, anchor - limit), anchor);
  return { ...current, items: selected, window: { first_item_id: selected[0]?.id, last_item_id: selected.at(-1)?.id,
    has_before: selected[0]?.id !== items[0]?.id, has_after: selected.at(-1)?.id !== items.at(-1)?.id } };
}
if (settledHistory) current = { ...current, last_outcome: 'completed',
  items: current.items?.map(item => item.id === 'density-reading' ? { ...item, text: `${item.text}\n\n${'Completed historical paragraph.\n\n'.repeat(60)}` } : item),
  turns: [{
  turn_id: 'navigation-turn', run_id: 'navigation-run', started_at: '2026-10-23T12:00:00Z', ended_at: '2026-10-23T12:01:00Z',
  outcome: 'completed', elapsed_ms: 60000, waiting_ms: 0, work_duration_ms: 60000,
  intermediate_item_ids: [], final_item_ids: ['density-reading'], final_boundary_complete: true,
}] };
if (activeTail) current = { ...current, activity: 'active', turn_id: 'active-turn', run_id: 'active-run',
  run_progress: { phase: 'streaming' },
  items: [...(current.items ?? []), { id: 'active-reading', kind: 'assistant', turn_id: 'active-turn', run_id: 'active-run', ordinal: 3,
    text: 'Current response paragraph.\n\n'.repeat(40) }],
  turns: [...(current.turns ?? []), { turn_id: 'active-turn', run_id: 'active-run', started_at: '2026-10-23T12:02:00Z',
    elapsed_ms: 0, waiting_ms: 0, work_duration_ms: 0, final_item_ids: [], final_boundary_complete: false }],
};
const settings: DesktopWelcomeRuntime['settings'] = {
  async load() { return { ok: false, error: 'No environment settings in this fixture.' }; },
  async save() { return { ok: false, error: 'No settings mutations in this fixture.' }; },
  cancel() {},
  async requestRuntimeFlower(request) {
    const url = new URL(request.path, 'http://fixture.invalid');
    const route = url.pathname.replace('/_redeven_proxy/api/', '');
    fixture.requests.push(`${request.method} ${route}`);
    if (route === 'settings') return { ok: true, data: {
      ai: { current_model_id: 'fixture/gpt-4.1', permission_type: 'approval_required', computer_use_enabled: false,
        providers: [{ id: 'fixture', name: 'Fixture', type: 'openai_compatible', base_url: 'https://fixture.invalid',
          models: [{ model_name: 'gpt-4.1', context_window: 128000, max_output_tokens: 4096, input_modalities: ['text'] }] }] },
      ai_secrets: { provider_api_key_set: { fixture: true } },
    } };
    if (route.startsWith('ai/') && !aiReady) { fixture.prematureRequests++; return unavailable(); }
    if (route === 'ai/models' && modelPickerMode) return { ok: true, data: modelDirectoryWireFixture({ ai: { current_model_id: 'gateway/short' } }, { models: [
      { id: 'gateway/short', label: 'Gateway / Sol', provider_name: 'Gateway', provider_type: 'openai', model_name: 'short', display_name: 'Sol' },
      { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek / DeepSeek V4.1 Flash (1017)', provider_name: 'DeepSeek', provider_type: 'deepseek', model_name: 'deepseek-v4-flash', display_name: 'DeepSeek V4.1 Flash (1017)',
        reasoning_capability: { kind: 'effort', supported_levels: ['high'], default_level: 'high', disable_supported: true } },
    ] }) };
    if (route === 'ai/models') return { ok: true, data: modelDirectoryWireFixture({ ai: { current_model_id: 'fixture/gpt-4.1' } }, { models: [
      { id: 'fixture/gpt-4.1', label: 'OpenAI / gpt-4.1', provider_name: 'OpenAI', provider_type: 'openai' },
      { id: 'anthropic/claude-sonnet-4.5', label: 'Anthropic / claude-sonnet-4.5', provider_name: 'Anthropic', provider_type: 'anthropic' },
      { id: 'gateway/claude-sonnet-4.5', label: 'Team Gateway / claude-sonnet-4.5', provider_name: 'Team Gateway', provider_type: 'openai_compatible' },
    ] }) };
    if (route === 'ai/conversation_preferences') {
      if (request.method === 'PATCH') modelPreference = (request.body as { model_id?: string }).model_id ?? modelPreference;
      return { ok: true, data: { revision: modelPreference ? 1 : 0, model_id: modelPreference, reasoning_by_model: {} } };
    }
    if (route === 'ai/threads') return { ok: true, data: { threads: [thread] } };
    if (route === 'ai/storage-generation') return { ok: true, data: { storage_generation: 'a'.repeat(32) } };
    if (route === 'ai/thread-goal' && goalMode) {
      const input = request.body as FlowerGoalInput;
      fixture.goalRequests.push(input);
      const conflict = input.expected_version !== goal.version;
      if (!conflict) {
        goal = { version: goal.version + 1, ...(input.operation !== 'delete' ? { text: input.text } : {}), status: input.operation === 'delete' ? 'absent' : 'active', actor: 'user' };
        thread.goal = goal;
        current = { ...current, view_version: current.view_version + 1, goal };
      }
      return { ok: true, data: { client_request_id: input.client_request_id, thread_id: thread.thread_id, goal, current, conflict } };
    }
    if (route === `ai/threads/${thread.thread_id}` || route === `ai/threads/${thread.thread_id}/history`) {
      if (sendLatest) {
        const input = request.body as FlowerHistoryRequest ?? {};
        fixture.historyRequests.push(input);
        if (input.observer_id) readingInterest = input;
        return { ok: true, data: { thread, current: selectReadingWindow(input) } };
      }
      fixture.goalReads++;
      if (fixture.holdGoalReads) {
        const failed = await new Promise<boolean>(resolve => { releaseGoalRead = resolve; });
        if (failed) return { ok: false, error: { code: 'fixture_read_failed', message: 'Goal confirmation is unavailable.' } };
      }
      return { ok: true, data: { thread, current: { ...current, ...(goalMode ? { goal } : {}) } } };
    }
    if (route === `ai/threads/${thread.thread_id}/read`) {
      const body = request.body as { snapshot: { activity_revision: number } };
      thread.read_status = { is_unread: false, snapshot: body.snapshot,
        read_state: { last_seen_activity_revision: body.snapshot.activity_revision } };
      return { ok: true, data: { read_status: thread.read_status } };
    }
    if (route === `ai/threads/${thread.thread_id}/computer-media/browser-main/${'a'.repeat(64)}`) {
      const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 440;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#e1ebe7'; context.fillRect(0, 0, 960, 440);
      context.fillStyle = '#294f40'; context.font = '40px sans-serif'; context.fillText('Your workspace, ready.', 60, 200);
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
      return { ok: true, data: { mime_type: 'image/png', bytes: new Uint8Array(await blob.arrayBuffer()) } };
    }
    if (route === 'fs/path_context') return { ok: true, data: { home_path_abs: '/workspace', agent_home_path_abs: '/workspace/.redeven', default_root_id: 'home', roots: [{ id: 'home', label: 'Home', path_abs: '/workspace' }] } };
    if (route === 'ai/attachments/capabilities') return { ok: true, data: { model_id: url.searchParams.get('model_id'), revision: '1', enabled: true,
      supports_long_text: true, max_count: 10, max_item_bytes: 1000000, max_turn_bytes: 5000000, media_types: [] } };
    if (route === 'ai/upload-staging-scopes') return { ok: true, stagingCapability: 'fixture-capability', data: {
      staging_scope_id: 'scope-1', target_id: (request.body as { target_id: string }).target_id, expires_at_unix_ms: Date.now() + 60000 } };
    if (route === 'ai/turns' || sendLatest && route === `ai/threads/${thread.thread_id}/turns`) {
      fixture.turnRequests.push(request.body);
      if (sendLatest) {
        const input = request.body as { client_request_id: string; input: { text: string } };
        thread.run_status = 'running';
        current = { ...current, view_version: current.view_version + 1, activity: 'active', turn_id: 'sent-turn', run_id: 'sent-run',
          run_progress: { phase: 'streaming' }, items: [...current.items ?? [],
            { id: `user:${input.client_request_id}`, ordinal: 331, kind: 'user', turn_id: 'sent-turn', run_id: 'sent-run', text: input.input.text },
            { id: 'sent-reply', ordinal: 332, kind: 'assistant', turn_id: 'sent-turn', run_id: 'sent-run', text: 'New reply after sending.\n\n'.repeat(24), live: true }] };
        return { ok: true, data: { client_request_id: input.client_request_id, thread_id: thread.thread_id } };
      }
      return { ok: false, failureKind: 'transport_unknown', error: { message: 'Delivery is still being confirmed.' } };
    }
    if (sendLatest && route === `ai/threads/${thread.thread_id}/history-release`) return { ok: true, data: {} };
    return { ok: false, error: { code: 'fixture_unexpected_route', message: `Unexpected fixture route: ${route}` } };
  },
  async prepareRuntimeFlowerAttachment(request) {
    fixture.uploads.push(request); return { ok: true, operation_id: request.operation_id, chunk_size_bytes: 262144 };
  },
  async writeRuntimeFlowerAttachmentChunk(request) { return { ok: true, next_offset_bytes: request.offset_bytes + request.chunk.byteLength }; },
  async commitRuntimeFlowerAttachment(request) {
    const file = fixture.uploads.find(upload => upload.operation_id === request.operation_id)!;
    return { ok: true, data: { attachment_id: 'upload-1', display_name: file.display_name, detected_media_type: file.media_type,
      size_bytes: file.size_bytes, content_sha256: file.content_sha256, logical_locator: 'attachment://v1/upload-1/notes.txt', capability_revision: '1' } };
  },
  async cancelRuntimeFlowerAttachment() { return { ok: true, cancelled: true }; },
  subscribeRuntimeFlowerAttachmentProgress() { return () => {}; },
  async startRuntimeFlowerStream(request) {
    fixture.streams++;
    receiveStreamID = request.stream_id;
    if (!aiReady) { fixture.prematureRequests++; return unavailable(); }
    if (!delayedFirstPage) queueMicrotask(() => fixture.releaseFirstPage());
    return { ok: true, status: 200, content_type: 'text/event-stream' };
  },
  cancelRuntimeFlowerStream() { fixture.cancellations++; },
  subscribeRuntimeFlowerStream(listener) { receiveStream = listener; return () => { receiveStream = undefined; }; },
};

document.documentElement.style.setProperty('--redeven-desktop-titlebar-height', '40px');
fixture.dispose = render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{ settings, launcher: {
  getSnapshot: () => { fixture.requests.push('snapshot'); return new Promise<never>(() => {}); },
  performAction: request => { fixture.requests.push(request.kind); return new Promise<never>(() => {}); },
  subscribeSnapshot(listener) { receive = listener; return () => { receive = undefined; }; },
} }} />, document.getElementById('root')!);
