import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { DesktopWelcomeShell, type DesktopWelcomeRuntime } from './App';
import { buildDesktopWelcomeSnapshot } from '../main/desktopWelcomeState';
import { testDesktopPreferences } from '../testSupport/desktopTestHelpers';
import type { DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';
import { normalizeRuntimeServiceSnapshot, RUNTIME_SERVICE_COMPATIBILITY_EPOCH, RUNTIME_SERVICE_PROTOCOL_VERSION, type RuntimeServiceAIReadinessState } from '../shared/runtimeService';
import type { RuntimeFlowerRequest } from '../shared/runtimeFlowerIPC';
import { modelDirectoryWireFixture } from '../../../internal/envapp/ui_src/src/test/modelDirectoryWireFixture';
import type { AgentSettingsResponse } from '../../../internal/envapp/ui_src/src/ui/pages/settings/types';

const disposers: Array<() => void> = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const flower = () => document.querySelector<HTMLElement>('[data-flower-engaged]');
const click = (selector: string) => {
  const button = document.querySelector<HTMLButtonElement>(selector);
  expect(button, selector).not.toBeNull();
  button!.click();
};

async function mount(surface: DesktopWelcomeSnapshot['surface'] = 'connect_environment', aiState: RuntimeServiceAIReadinessState = 'ready', respond?: (request: RuntimeFlowerRequest) => unknown) {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('Worker', class extends EventTarget { postMessage() {} terminate() {} });
  vi.stubGlobal('CSS', { escape: (value: string) => value });
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  let snapshot = { ...buildDesktopWelcomeSnapshot({ preferences: testDesktopPreferences(), surface }), navigation_revision: 1 };
  const runtimeService = normalizeRuntimeServiceSnapshot({ compatibility_epoch: RUNTIME_SERVICE_COMPATIBILITY_EPOCH, protocol_version: RUNTIME_SERVICE_PROTOCOL_VERSION,
    compatibility: 'compatible', open_readiness: { state: 'openable' }, ai_readiness: { state: aiState } });
  snapshot = { ...snapshot, environments: snapshot.environments.map(entry => ({ ...entry, runtime_service: runtimeService })) };
  let receive: ((value: DesktopWelcomeSnapshot) => void) | undefined;
  // Both IPC and runtime preparation stay pending throughout navigation.
  const performAction = vi.fn(() => new Promise<never>(() => {}));
  const getSnapshot = vi.fn(() => new Promise<never>(() => {}));
  let fixtureSettings = {} as AgentSettingsResponse;
  const requestRuntimeFlower = vi.fn((request: RuntimeFlowerRequest) => {
    if (!respond) return new Promise<never>(() => {});
    const data = respond(request.path === '/_redeven_proxy/api/ai/models?mode=baseline' ? { ...request, path: '/_redeven_proxy/api/ai/models' } : request);
    if (request.path === '/_redeven_proxy/api/settings') fixtureSettings = data as AgentSettingsResponse;
    return Promise.resolve({ ok: true as const, data: request.path.startsWith('/_redeven_proxy/api/ai/models') ? modelDirectoryWireFixture(fixtureSettings, data as Record<string, unknown>) : data });
  });
  const startRuntimeFlowerStream = vi.fn(() => new Promise<never>(() => {}));
  const cancelRuntimeFlowerStream = vi.fn();
  const settings = { load: vi.fn(), save: vi.fn(), cancel: vi.fn(), requestRuntimeFlower,
    startRuntimeFlowerStream, cancelRuntimeFlowerStream, subscribeRuntimeFlowerStream: () => () => {},
  } as unknown as DesktopWelcomeRuntime['settings'];
  const host = document.createElement('div');
  document.body.append(host);
  disposers.push(render(() => <DesktopWelcomeShell snapshot={snapshot} runtime={{ settings, launcher: {
    getSnapshot, performAction, subscribeSnapshot: listener => { receive = listener; return () => {}; },
  } }} />, host));
  await settle();
  return { performAction, getSnapshot, requestRuntimeFlower, startRuntimeFlowerStream, cancelRuntimeFlowerStream, snapshot, publish(patch: Partial<typeof snapshot>) {
    snapshot = { ...snapshot, ...patch, snapshot_revision: (snapshot.snapshot_revision ?? 0) + 1 };
    receive?.(snapshot);
  } };
}

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('keeps the canvas available during AI startup and loads its configured model only after readiness', async () => {
  const canvas = { id: 'commerce', title: 'Commerce', latest_version: 1, archived: false, created_at: 1, updated_at: 1 };
  const version = { canvas_id: canvas.id, number: 1, document: { apiVersion: 'redeven.io/tessiven/v1', kind: 'ServiceCanvas', metadata: { title: canvas.title } }, document_yaml: '', digest: 'fixture', created_at: 1, source: 'created', summary: '' };
  const h = await mount('connect_environment', 'inspecting', request => {
    if (request.path.startsWith('/_redeven_proxy/api/tessiven/canvases?')) return { canvases: [canvas] };
    if (request.path === '/_redeven_proxy/api/tessiven/canvases/commerce') return canvas;
    if (request.path.includes('/canvases/commerce/versions/')) return version;
    if (request.path === '/_redeven_proxy/api/settings') return { ai: { current_model_id: 'deepseek/deepseek-flash', permission_type: 'full_access', providers: [{ id: 'deepseek', name: 'DeepSeek', type: 'deepseek', model_selection: { selected_models: ['deepseek-flash'] } }] }, ai_secrets: { provider_api_key_set: { deepseek: true } } };
    if (request.path === '/_redeven_proxy/api/ai/models') return { current_model: 'deepseek/deepseek-flash', models: [] };
    if (request.path.startsWith('/_redeven_proxy/api/ai/threads?')) return { threads: [] };
    return {};
  });
  click('button[aria-label="Tessiven"]');
  await vi.waitFor(() => expect(document.querySelector('.tessiven-library-card > button')).not.toBeNull());
  click('.tessiven-library-card > button');
  await vi.waitFor(() => expect(document.querySelector('.tessiven-canvas')).not.toBeNull());
  expect(document.querySelector('[data-flower-runtime-availability="preparing"]')).not.toBeNull();
  const aiRequests = () => h.requestRuntimeFlower.mock.calls.filter(([request]) => !request.path.startsWith('/_redeven_proxy/api/tessiven/'));
  expect(aiRequests()).toHaveLength(0);
  h.publish({ environments: h.snapshot.environments.map(entry => ({ ...entry, runtime_service: { ...entry.runtime_service!, ai_readiness: { state: 'ready' } } })) });
  await vi.waitFor(() => expect(document.querySelector('.flower-composer')?.textContent).toContain('DeepSeek'));
  expect(document.querySelector('.flower-composer')?.textContent).not.toContain('No model selected');
  const editor = document.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
  editor.value = 'Keep the horizontal layout request';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  h.publish({ environments: h.snapshot.environments.map(entry => ({ ...entry, runtime_service: { ...entry.runtime_service!, ai_readiness: { state: 'recovering' } } })) });
  await vi.waitFor(() => expect(document.querySelector('.flower-composer')).toBeNull());
  expect(document.querySelector('.tessiven-canvas')).not.toBeNull();
  h.publish({ environments: h.snapshot.environments.map(entry => ({ ...entry, runtime_service: { ...entry.runtime_service!, ai_readiness: { state: 'ready' } } })) });
  await vi.waitFor(() => expect(document.querySelector<HTMLTextAreaElement>('.flower-composer textarea')?.value).toBe('Keep the horizontal layout request'));
});

it('opens Flower on the click while IPC and runtime preparation are pending', async () => {
  const h = await mount('connect_environment', 'inspecting');
  expect(h.requestRuntimeFlower).not.toHaveBeenCalled();
  click('.redeven-flower-topbar-button');
  expect(document.querySelector('[data-flower-runtime-availability="preparing"]')).not.toBeNull();
  expect(flower()).toBeNull();
  expect(h.requestRuntimeFlower).not.toHaveBeenCalled();
  expect(document.querySelector('.redeven-flower-back-button')).not.toBeNull();
  expect(h.performAction).not.toHaveBeenCalled();
  expect(h.getSnapshot).not.toHaveBeenCalled();
});

it('returns during AI startup and initializes the retained page only when the runtime publishes ready', async () => {
  const h = await mount('flower', 'inspecting');
  expect(h.requestRuntimeFlower).not.toHaveBeenCalled();
  click('.redeven-flower-back-button');
  expect(document.querySelector('.redeven-flower-topbar-button')).not.toBeNull();
  h.publish({ environments: h.snapshot.environments.map(entry => ({ ...entry, runtime_service: { ...entry.runtime_service!, ai_readiness: { state: 'ready' } } })) });
  await settle();
  const mounted = flower();
  expect(mounted).not.toBeNull();
  expect(mounted?.dataset.flowerEngaged).toBe('false');
  const requests = h.requestRuntimeFlower.mock.calls.length;
  expect(requests).toBeGreaterThan(0);
  click('.redeven-flower-topbar-button');
  expect(flower()).toBe(mounted);
  expect(h.requestRuntimeFlower).toHaveBeenCalledTimes(requests);
  expect(h.performAction).not.toHaveBeenCalled();
});

it.each(['.redeven-flower-back-button', '.flower-sidebar-leading-action'])('returns immediately through %s and retains the pending Flower instance', async selector => {
  const h = await mount('flower');
  const mounted = flower();
  expect(mounted).not.toBeNull();
  const calls = h.requestRuntimeFlower.mock.calls.length;
  click(selector);
  expect(document.querySelector('.redeven-flower-topbar-button')).not.toBeNull();
  expect(mounted?.closest<HTMLElement>('[aria-hidden="true"]')?.inert).toBe(true);
  click('.redeven-flower-topbar-button');
  expect(flower()).toBe(mounted);
  expect(mounted?.dataset.flowerEngaged).toBe('true');
  expect(h.requestRuntimeFlower).toHaveBeenCalledTimes(calls);
  expect(h.performAction).not.toHaveBeenCalled();
});

it('keeps local navigation across background snapshots and honors repeated explicit host requests', async () => {
  const h = await mount();
  const card = document.querySelector('[data-environment-group]');
  click('.redeven-flower-topbar-button');
  h.publish({ surface: 'connect_environment' });
  expect(flower()?.dataset.flowerEngaged).toBe('true');
  h.publish({ surface: 'connect_environment', navigation_revision: 2 });
  expect(document.querySelector('.redeven-flower-topbar-button')).not.toBeNull();
  expect(document.querySelector('[data-environment-group]')).toBe(card);
  click('.redeven-flower-topbar-button');
  h.publish({ surface: 'connect_environment', navigation_revision: 3 });
  expect(document.querySelector('.redeven-flower-topbar-button')).not.toBeNull();
  h.publish({ surface: 'flower', navigation_revision: 4 });
  expect(flower()?.dataset.flowerEngaged).toBe('true');
});

it('releases the previous Flower when the selected runtime identity changes', async () => {
  const h = await mount();
  const card = document.querySelector('[data-environment-group]');
  click('.redeven-flower-topbar-button');
  const previous = flower();
  click('.redeven-flower-back-button');
  h.publish({ environments: h.snapshot.environments.map(entry => ({ ...entry, id: `${entry.id}-replacement` })) });
  click('.redeven-flower-topbar-button');
  expect(flower()).not.toBeNull();
  expect(flower()).not.toBe(previous);
  expect(previous?.isConnected).toBe(false);
  expect(card?.isConnected).toBe(false);
});

it('keeps filesystem requests stable through health snapshots and refreshes after runtime or session replacement', async () => {
  const h = await mount('flower');
  const mounted = flower();
  const initialCalls = h.requestRuntimeFlower.mock.calls.length;
  for (let revision = 1; revision <= 3; revision++) {
    h.publish({ environments: h.snapshot.environments.map(entry => ({
      ...entry, runtime_health: { status: 'online', checked_at_unix_ms: revision, source: 'local_runtime_probe', freshness: 'fresh' },
    })) });
    await settle();
  }
  expect(flower()).toBe(mounted);
  expect(h.requestRuntimeFlower).toHaveBeenCalledTimes(initialCalls);
  expect(h.startRuntimeFlowerStream).toHaveBeenCalledTimes(1);
  expect(h.cancelRuntimeFlowerStream).not.toHaveBeenCalled();
  h.publish({ environments: h.snapshot.environments.map(entry => ({ ...entry, runtime_started_at_unix_ms: 42 })) });
  await settle();
  expect(flower()).toBe(mounted);
  expect(h.requestRuntimeFlower).toHaveBeenCalledTimes(initialCalls + 1);
  h.publish({ environments: h.snapshot.environments.map(entry => ({ ...entry, runtime_started_at_unix_ms: 42, open_session_key: 'replacement' })) });
  await settle();
  expect(h.requestRuntimeFlower).toHaveBeenCalledTimes(initialCalls + 2);
});
