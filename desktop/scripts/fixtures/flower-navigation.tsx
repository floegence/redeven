import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from '../../src/welcome/App';
import type { DesktopWelcomeSnapshot } from '../../src/shared/desktopLauncherIPC';
import type { RuntimeFlowerStreamEvent } from '../../src/shared/runtimeFlowerIPC';
import '../../src/welcome/index.css';

declare global {
  interface Window {
    navigationSnapshot: DesktopWelcomeSnapshot;
    navigationFixture: {
      requests: string[];
      streams: number;
      cancellations: number;
      releaseRuntime: () => void;
      publish: (patch: Partial<DesktopWelcomeSnapshot>) => void;
      dispose: () => void;
    };
  }
}

let snapshot = window.navigationSnapshot;
let receive: ((value: DesktopWelcomeSnapshot) => void) | undefined;
let receiveStream: ((event: RuntimeFlowerStreamEvent) => void) | undefined;
let releaseRuntime = () => {};
const runtimeReady = new Promise<void>(resolve => { releaseRuntime = resolve; });
const fixture = window.navigationFixture = {
  requests: [] as string[], streams: 0, cancellations: 0, releaseRuntime, dispose: () => {},
  publish(patch: Partial<DesktopWelcomeSnapshot>) {
    snapshot = { ...snapshot, ...patch, snapshot_revision: (snapshot.snapshot_revision ?? 0) + 1 };
    receive?.(snapshot);
  },
};
const thread = {
  thread_id: 'navigation-thread', title: 'Keep this conversation', title_status: 'ready', title_generation: 1,
  model_id: 'fixture/model', run_status: 'idle', working_dir: '/workspace',
  created_at_unix_ms: 1, updated_at_unix_ms: 2, last_message_at_unix_ms: 2,
  read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } },
};
const current = { thread_id: thread.thread_id, view_version: 1, activity: 'idle', items: [], queue: [], interactions: [] };
const settings: DesktopWelcomeRuntime['settings'] = {
  async load() { return { ok: false, error: 'No environment settings in this fixture.' }; },
  async save() { return { ok: false, error: 'No settings mutations in this fixture.' }; },
  cancel() {},
  async requestRuntimeFlower(request) {
    const url = new URL(request.path, 'http://fixture.invalid');
    const route = url.pathname.replace('/_redeven_proxy/api/', '');
    fixture.requests.push(`${request.method} ${route}`);
    await runtimeReady;
    if (route === 'settings') return { ok: true, data: {
      ai: { current_model_id: 'fixture/model', permission_type: 'approval_required', computer_use_enabled: false,
        providers: [{ id: 'fixture', name: 'Fixture', type: 'openai_compatible', base_url: 'https://fixture.invalid',
          models: [{ model_name: 'model', context_window: 128000, max_output_tokens: 4096, input_modalities: ['text'] }] }] },
      ai_secrets: { provider_api_key_set: { fixture: true } },
    } };
    if (route === 'ai/models') return { ok: true, data: { current_model: 'fixture/model', models: [{ id: 'fixture/model' }] } };
    if (route === 'ai/threads') return { ok: true, data: { threads: [thread] } };
    if (route === `ai/threads/${thread.thread_id}`) return { ok: true, data: { thread, current } };
    if (route === `ai/threads/${thread.thread_id}/read`) return { ok: true, data: thread.read_status };
    if (route === 'fs/path_context') return { ok: true, data: { home_path_abs: '/workspace', agent_home_path_abs: '/workspace/.redeven', default_root_id: 'home', roots: [{ id: 'home', label: 'Home', path_abs: '/workspace' }] } };
    if (route === 'ai/attachments/capabilities') return { ok: true, data: { model_id: 'fixture/model', revision: '1', enabled: false } };
    return { ok: false, error: { code: 'fixture_unexpected_route', message: `Unexpected fixture route: ${route}` } };
  },
  async startRuntimeFlowerStream(request) {
    fixture.streams++;
    queueMicrotask(() => receiveStream?.({ stream_id: request.stream_id, kind: 'chunk',
      chunk: new TextEncoder().encode(`data: ${JSON.stringify({ schema_version: 1, kind: 'ready', summaries: [thread] })}\n\n`) }));
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
