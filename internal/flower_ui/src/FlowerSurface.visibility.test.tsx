// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./SubagentDetailWindow', () => ({
  SubagentDetailWindow: () => null,
}));

vi.mock('./filePicker/FlowerWorkingDirPickerDialog', () => ({
  FlowerWorkingDirPickerDialog: () => null,
}));

import type {
  FlowerLiveBootstrap,
  FlowerLiveEvent,
  FlowerLiveEventsResponse,
  FlowerRouterDecision,
  FlowerSettingsSnapshot,
  FlowerSurfaceAdapter,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import type { FlowerCompanionPresenceProjection } from './flowerCompanionPresence';
import { FlowerSurface } from './FlowerSurface';

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}>;

type AdapterHarness = Readonly<{
  adapter: FlowerSurfaceAdapter;
  listThreads: ReturnType<typeof vi.fn<FlowerSurfaceAdapter['listThreads']>>;
  loadThread: ReturnType<typeof vi.fn<FlowerSurfaceAdapter['loadThread']>>;
  listThreadLiveEvents: ReturnType<typeof vi.fn<FlowerSurfaceAdapter['listThreadLiveEvents']>>;
  markThreadRead: ReturnType<typeof vi.fn<FlowerSurfaceAdapter['markThreadRead']>>;
}>;

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
let animationFrames: FrameRequestCallback[];

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitUntil(predicate: () => boolean, message: string, timeoutMs = 1_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
}

async function presentNextFrame(): Promise<void> {
  const callbacks = animationFrames.splice(0);
  callbacks.forEach((callback) => callback(performance.now()));
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  await flushAsync();
}

function setDocumentVisible(visible: boolean): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: visible ? 'visible' : 'hidden',
  });
  document.dispatchEvent(new Event('visibilitychange'));
}

function readStatus(isUnread = true, revision = 2): FlowerThreadReadStatus {
  return {
    is_unread: isUnread,
    snapshot: {
      activity_revision: revision,
      last_message_at_unix_ms: revision * 1_000,
      activity_signature: `status:running\u001factivity:${revision}`,
    },
    read_state: {
      last_seen_activity_revision: isUnread ? revision - 1 : revision,
      last_read_message_at_unix_ms: isUnread ? (revision - 1) * 1_000 : revision * 1_000,
      last_seen_activity_signature: `status:running\u001factivity:${isUnread ? revision - 1 : revision}`,
    },
  };
}

function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-running',
    title: 'Running task',
    title_status: 'ready',
    model_id: 'default/model',
    working_dir: '/workspace/redeven',
    created_at_ms: 1_000,
    updated_at_ms: 2_000,
    status: 'running',
    source_label: 'This host',
    target_labels: [],
    messages: [],
    read_status: readStatus(),
    ...overrides,
  };
}

function bootstrap(snapshot = thread()): FlowerLiveBootstrap {
  return {
    schema_version: 1,
    endpoint_id: 'runtime-test',
    thread_id: snapshot.thread_id,
    stream_generation: 1,
    cursor: 0,
    retained_from_seq: 1,
    thread: snapshot,
    timeline_messages: snapshot.messages,
    live_state: {
      thread_patch: {},
      runs: {},
      approval_actions: {},
      input_requests: {},
    },
    read_status: snapshot.read_status,
    generated_at_ms: 3_000,
  };
}

function liveEvent<K extends FlowerLiveEvent['kind']>(
  threadID: string,
  seq: number,
  kind: K,
  payload: FlowerLiveEvent<K>['payload'],
): FlowerLiveEvent<K> {
  return {
    schema_version: 1,
    seq,
    endpoint_id: 'runtime-test',
    thread_id: threadID,
    run_id: 'run-live',
    turn_id: 'turn-live',
    at_unix_ms: 3_000 + seq,
    kind,
    payload,
  } as FlowerLiveEvent<K>;
}

function settings(): FlowerSettingsSnapshot {
  return {
    defaults: { permission_type: 'approval_required' },
    model_profile: {
      schema_version: 1,
      current_model_id: 'default/model',
      providers: [{
        id: 'default',
        type: 'openai',
        models: [{ model_name: 'model', context_window: 100_000, input_modalities: ['text'] }],
      }],
    },
    provider_secrets: [{
      provider_id: 'default',
      provider_api_key_configured: true,
      web_search_api_key_configured: false,
    }],
  };
}

function routerDecision(): FlowerRouterDecision {
  return {
    decision_id: 'decision-test',
    decision_revision: 1,
    route: 'flower',
    reason_code: 'test',
    selected_handler: {
      handler_id: 'runtime-test',
      handler_kind: 'env_local',
      display_name: 'Runtime',
      carrier_kind: 'runtime',
      state: 'online',
      selection_source: 'router_default',
      supports_thread_kinds: ['chat'],
    },
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
      runtime_id: 'runtime-test',
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

function createAdapterHarness(overrides: Partial<FlowerSurfaceAdapter> = {}): AdapterHarness {
  const listThreads = vi.fn<FlowerSurfaceAdapter['listThreads']>(async () => [thread()]);
  const loadThread = vi.fn<FlowerSurfaceAdapter['loadThread']>(async () => bootstrap());
  const listThreadLiveEvents = vi.fn<FlowerSurfaceAdapter['listThreadLiveEvents']>(async () => ({
    stream_generation: 1,
    events: [],
    next_cursor: 0,
    retained_from_seq: 1,
  }));
  const markThreadRead = vi.fn<FlowerSurfaceAdapter['markThreadRead']>(async () => readStatus(false));
  const adapter: FlowerSurfaceAdapter = {
    runtime: {
      runtime_id: 'runtime-test',
      runtime_kind: 'env_local',
      carrier_kind: 'runtime',
      display_name: 'Runtime',
      subtitle: 'Local',
    },
    loadSettings: async () => settings(),
    saveDefaultPermission: async () => settings(),
    saveModelProfile: async () => settings(),
    listThreads,
    loadThread,
    listThreadLiveEvents,
    loadSubagentDetail: async () => ({
      summary: {
        parent_thread_id: 'parent',
        thread_id: 'child',
        task_name: 'Child',
        status: 'running',
        can_send_input: false,
        can_interrupt: false,
        can_close: false,
      },
      timeline: [],
      next_ordinal: 0,
      has_more: false,
      generated_at_ms: 1,
    }),
    markThreadRead,
    persistDefaultModel: async () => settings(),
    resolveHandler: async () => routerDecision(),
    launchTurn: async () => ({ thread_id: 'new-thread', turn_id: 'turn', run_id: 'run', kind: 'start' }),
    compactThreadContext: async () => bootstrap(),
    stopThread: async () => bootstrap(),
    submitInput: async () => bootstrap(),
    submitApproval: async () => ({ ok: true, current_cursor: 0 }),
    ...overrides,
  };
  return {
    adapter,
    listThreads: adapter.listThreads === listThreads ? listThreads : vi.mocked(adapter.listThreads),
    loadThread: adapter.loadThread === loadThread ? loadThread : vi.mocked(adapter.loadThread),
    listThreadLiveEvents: adapter.listThreadLiveEvents === listThreadLiveEvents
      ? listThreadLiveEvents
      : vi.mocked(adapter.listThreadLiveEvents),
    markThreadRead: adapter.markThreadRead === markThreadRead ? markThreadRead : vi.mocked(adapter.markThreadRead),
  };
}

function renderSurface(
  adapter: FlowerSurfaceAdapter,
  initialEngaged = false,
  initialTranscriptVisible = false,
  onPresenceChange?: (presence: FlowerCompanionPresenceProjection) => void,
  presentation: 'full' | 'companion' = 'companion',
  companionPresenceOwner = presentation === 'companion',
) {
  const [engaged, setEngaged] = createSignal(initialEngaged);
  const [transcriptVisible, setTranscriptVisible] = createSignal(initialTranscriptVisible);
  dispose = render(() => (
    <FlowerSurface
      adapter={adapter}
      notify={() => undefined}
      presentation={presentation}
      companionOpen={engaged()}
      engaged={engaged()}
      transcriptVisible={transcriptVisible()}
      companionPresenceOwner={companionPresenceOwner}
      focusThreadRequest={{ request_id: 'focus-test', thread_id: 'thread-running' }}
      onPresenceChange={onPresenceChange}
    />
  ), host);
  return { setEngaged, setTranscriptVisible };
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  animationFrames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  setDocumentVisible(true);
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host.remove();
  vi.unstubAllGlobals();
});

describe('FlowerSurface companion visibility lifecycle', () => {
  it('keeps the ordinary composer textarea mounted while the companion expands and collapses', async () => {
    const idleThread = thread({
      status: 'idle',
      read_status: readStatus(false),
      context_usage: {
        run_id: '',
        phase: 'provider_usage',
        input_tokens: 12_000,
        context_window_tokens: 100_000,
        threshold_tokens: 80_000,
        used_ratio: 0.12,
        threshold_ratio: 0.8,
        pressure_status: 'stable',
        updated_at_ms: 2_000,
      },
    });
    const harness = createAdapterHarness({
      listThreads: vi.fn(async () => [idleThread]),
      loadThread: vi.fn(async () => bootstrap(idleThread)),
    });
    const [open, setOpen] = createSignal(false);
    dispose = render(() => (
      <FlowerSurface
        adapter={harness.adapter}
        notify={() => undefined}
        presentation="companion"
        companionOpen={open()}
        companionRegionID="test-flower-companion"
        companionSummary={{
          visualText: 'Working on · Refine the companion',
          accessibleText: 'Working on · Refine the companion',
          priorityStatus: 'running',
          running: true,
        }}
        engaged={open()}
        transcriptVisible={open()}
        onCompanionOpenRequest={() => setOpen(true)}
        focusThreadRequest={{ request_id: 'focus-idle', thread_id: idleThread.thread_id }}
      />
    ), host);

    await waitUntil(() => Boolean(host.querySelector('textarea')), 'composer textarea did not render');
    const textarea = host.querySelector('textarea') as HTMLTextAreaElement;
    const surface = host.querySelector('[data-flower-companion-open]') as HTMLElement;
    expect(surface.dataset.flowerCompanionOpen).toBe('false');
    const summary = host.querySelector('.flower-companion-collapsed-summary') as HTMLButtonElement;
    const composerContent = host.querySelector('.flower-composer-content') as HTMLElement;
    expect(summary.tagName).toBe('BUTTON');
    expect(summary.textContent).toContain('Refine the companion');
    expect(summary.getAttribute('aria-controls')).toBe('test-flower-companion');
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect((composerContent as HTMLElement & { inert: boolean }).inert).toBe(true);
    expect(composerContent.getAttribute('aria-hidden')).toBe('true');

    summary.click();
    await flushAsync();
    expect(surface.dataset.flowerCompanionOpen).toBe('true');
    expect(host.querySelector('textarea')).toBe(textarea);
    expect((composerContent as HTMLElement & { inert: boolean }).inert).toBe(false);

    const composer = host.querySelector('.flower-composer') as HTMLElement;
    await waitUntil(
      () => composer.dataset.flowerCompanionCompact === 'true',
      'expanded companion did not enter compact composer mode',
    );
    expect(composer.dataset.flowerCompanionCompact).toBe('true');
    expect(host.querySelectorAll('[data-flower-composer-inline-item]')).toHaveLength(0);
    const more = host.querySelector('.flower-composer-more-button') as HTMLButtonElement;
    expect(more).not.toBeNull();
    more.click();
    await flushAsync();
    expect(host.querySelector('[data-flower-composer-more-item="working_dir"]')).not.toBeNull();
    expect(host.querySelector('[data-flower-composer-more-item="permission"]')).not.toBeNull();
    expect(host.querySelector('[data-flower-composer-more-item="model_reasoning"]')).not.toBeNull();
    expect(host.querySelector('[data-flower-composer-more-item="context"]')).not.toBeNull();

    setOpen(false);
    await flushAsync();
    expect(surface.dataset.flowerCompanionOpen).toBe('false');
    expect(host.querySelector('textarea')).toBe(textarea);
  });

  it('does not compact the dedicated full-page composer', async () => {
    const idleThread = thread({ status: 'idle', read_status: readStatus(false) });
    const harness = createAdapterHarness({
      listThreads: vi.fn(async () => [idleThread]),
      loadThread: vi.fn(async () => bootstrap(idleThread)),
    });
    renderSurface(harness.adapter, true, true, undefined, 'full');

    await waitUntil(() => Boolean(host.querySelector('.flower-composer')), 'full-page composer did not render');
    await flushAsync();

    expect((host.querySelector('.flower-composer') as HTMLElement).dataset.flowerCompanionCompact).toBeUndefined();
  });

  it('consumes collapsed live progress without marking an unread thread as read', async () => {
    const harness = createAdapterHarness();
    renderSurface(harness.adapter);

    await waitUntil(() => harness.loadThread.mock.calls.length === 1, 'focused thread did not bootstrap');
    await flushAsync();
    await presentNextFrame();

    expect(harness.markThreadRead).not.toHaveBeenCalled();
    await waitUntil(() => harness.listThreadLiveEvents.mock.calls.length > 0, 'collapsed live subscription did not start');
    expect(harness.markThreadRead).not.toHaveBeenCalled();
  });

  it('bootstraps on engagement before consuming live events or acknowledging read state', async () => {
    const resumedBootstrap = deferred<FlowerLiveBootstrap>();
    const order: string[] = [];
    const loadThread = vi.fn<FlowerSurfaceAdapter['loadThread']>(async () => {
      const call = loadThread.mock.calls.length;
      order.push(`bootstrap:${call}:started`);
      if (call === 1) {
        order.push('bootstrap:1:finished');
        return bootstrap();
      }
      const result = await resumedBootstrap.promise;
      order.push('bootstrap:2:finished');
      return result;
    });
    const listThreadLiveEvents = vi.fn<FlowerSurfaceAdapter['listThreadLiveEvents']>(async () => {
      order.push('live');
      return {
        stream_generation: 1,
        events: [],
        next_cursor: 0,
        retained_from_seq: 1,
      };
    });
    const markThreadRead = vi.fn<FlowerSurfaceAdapter['markThreadRead']>(async () => {
      order.push('read');
      return readStatus(false);
    });
    const harness = createAdapterHarness({ loadThread, listThreadLiveEvents, markThreadRead });
    const controls = renderSurface(harness.adapter);
    await waitUntil(() => loadThread.mock.calls.length === 1, 'initial focused thread did not bootstrap');
    await waitUntil(() => listThreadLiveEvents.mock.calls.length > 0, 'collapsed live subscription did not start');
    listThreadLiveEvents.mockClear();
    order.length = 0;

    controls.setEngaged(true);
    controls.setTranscriptVisible(true);
    await waitUntil(() => loadThread.mock.calls.length === 2, 'engagement bootstrap did not start');
    await flushAsync();

    expect(listThreadLiveEvents).not.toHaveBeenCalled();
    expect(markThreadRead).not.toHaveBeenCalled();

    resumedBootstrap.resolve(bootstrap());
    await waitUntil(() => order.includes('bootstrap:2:finished'), 'engagement bootstrap did not finish');
    await waitUntil(() => listThreadLiveEvents.mock.calls.length > 0, 'live consumption did not resume');

    expect(order.indexOf('bootstrap:2:finished')).toBeLessThan(order.indexOf('live'));
    expect(markThreadRead).not.toHaveBeenCalled();

    await presentNextFrame();
    await waitUntil(() => markThreadRead.mock.calls.length === 1, 'read acknowledgement did not follow presentation');
    expect(order.indexOf('bootstrap:2:finished')).toBeLessThan(order.indexOf('read'));
  });

  it('keeps refreshing summaries for a selected running thread while collapsed', async () => {
    const externallyStartedThread = thread({
      thread_id: 'thread-external',
      title: 'Started elsewhere',
      updated_at_ms: 3_000,
    });
    const listThreads = vi.fn<FlowerSurfaceAdapter['listThreads']>(async () => [
      thread({ updated_at_ms: 2_100 }),
      externallyStartedThread,
    ]);
    const presences: FlowerCompanionPresenceProjection[] = [];
    const harness = createAdapterHarness({ listThreads });
    renderSurface(harness.adapter, false, false, (presence) => presences.push(presence));

    await waitUntil(() => harness.loadThread.mock.calls.length === 1, 'focused thread did not bootstrap');
    await waitUntil(() => listThreads.mock.calls.length >= 1, 'background summary refresh did not run', 2_500);
    await waitUntil(
      () => presences.some((presence) => presence.running_count === 2),
      'background summary refresh did not discover externally started work',
    );

    expect(listThreads.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(presences.at(-1)?.running_count).toBe(2);
    expect(harness.listThreadLiveEvents).toHaveBeenCalled();
    expect(harness.markThreadRead).not.toHaveBeenCalled();
  });

  it('streams waiting, tool, and output progress for the canonical collapsed priority thread', async () => {
    const selectedSummary = thread({
      title: 'Pending selected title',
      title_status: 'pending',
      status: 'idle',
      read_status: readStatus(false),
      messages: [],
    });
    const externalSummary = thread({
      thread_id: 'thread-external-live',
      title: 'Canonical external work',
      active_run_id: 'run-live',
      messages: [],
    });
    const externalBootstrap: FlowerLiveBootstrap = {
      ...bootstrap(externalSummary),
      live_state: {
        thread_patch: {},
        runs: { 'run-live': { run_id: 'run-live', status: 'running', message_id: 'assistant-live' } },
        model_io: { run_id: 'run-live', phase: 'waiting_response', updated_at_ms: 3_000 },
        approval_actions: {},
        input_requests: {},
      },
    };
    const toolPage = deferred<FlowerLiveEventsResponse>();
    const outputPage = deferred<FlowerLiveEventsResponse>();
    const terminalPage = deferred<FlowerLiveEventsResponse>();
    let externalLiveCall = 0;
    const listThreadLiveEvents = vi.fn<FlowerSurfaceAdapter['listThreadLiveEvents']>(async (threadID) => {
      if (threadID !== externalSummary.thread_id) {
        return { stream_generation: 1, events: [], next_cursor: 0, retained_from_seq: 1 };
      }
      externalLiveCall += 1;
      if (externalLiveCall === 1) return toolPage.promise;
      if (externalLiveCall === 2) return outputPage.promise;
      if (externalLiveCall === 3) return terminalPage.promise;
      return { stream_generation: 1, events: [], next_cursor: 4, retained_from_seq: 1 };
    });
    const presences: FlowerCompanionPresenceProjection[] = [];
    const harness = createAdapterHarness({
      listThreads: vi.fn(async () => [selectedSummary, externalSummary]),
      loadThread: vi.fn(async (threadID) => threadID === externalSummary.thread_id
        ? externalBootstrap
        : bootstrap(selectedSummary)),
      listThreadLiveEvents,
    });
    renderSurface(harness.adapter, false, false, (presence) => presences.push(presence));

    await waitUntil(
      () => presences.some((presence) => presence.priority_thread_progress === 'Waiting for model response...'),
      'waiting progress did not reach companion presence',
    );
    toolPage.resolve({
      stream_generation: 1,
      events: [
        liveEvent(externalSummary.thread_id, 1, 'model_io.updated', {
          status: { run_id: 'run-live', phase: 'streaming', updated_at_ms: 3_001 },
        }),
        liveEvent(externalSummary.thread_id, 2, 'message.started', {
          message_id: 'assistant-live', role: 'assistant', status: 'streaming', created_at_ms: 3_002,
        }),
        liveEvent(externalSummary.thread_id, 3, 'message.block_set', {
          message_id: 'assistant-live',
          block_index: 0,
          block: {
            type: 'activity-timeline',
            block: {
              type: 'activity-timeline',
              schema_version: 1,
              thread_id: externalSummary.thread_id,
              turn_id: 'turn-live',
              run_id: 'run-live',
              summary: { status: 'running', severity: 'normal', needs_attention: false, total_items: 1, counts: { running: 1 } },
              items: [{
                item_id: 'tool-live',
                tool_name: 'terminal.exec',
                kind: 'tool',
                status: 'running',
                severity: 'normal',
                needs_attention: false,
                requires_approval: false,
                label: 'Inspecting the Flower layout',
              }],
            },
          },
        }),
      ],
      next_cursor: 3,
      retained_from_seq: 1,
    });
    await waitUntil(
      () => presences.some((presence) => presence.priority_thread_progress === 'Inspecting the Flower layout'),
      'tool progress did not reach companion presence',
    );
    await waitUntil(() => externalLiveCall >= 2, 'output live page was not requested');
    outputPage.resolve({
      stream_generation: 1,
      events: [liveEvent(externalSummary.thread_id, 4, 'message.block_set', {
        message_id: 'assistant-live',
        block_index: 1,
        block: { type: 'markdown', content: 'The latest Flower output stays visible.' },
      })],
      next_cursor: 4,
      retained_from_seq: 1,
    });
    await waitUntil(
      () => presences.some((presence) => presence.priority_thread_progress === 'The latest Flower output stays visible.'),
      'output progress did not reach companion presence',
    );

    expect(presences.at(-1)).toMatchObject({
      priority_status: 'running',
      priority_thread_title: 'Canonical external work',
      priority_thread_progress: 'The latest Flower output stays visible.',
      priority_thread_progress_kind: 'output',
    });
    expect(listThreadLiveEvents.mock.calls
      .filter(([threadID]) => threadID === externalSummary.thread_id)
      .slice(0, 2)
      .map(([threadID, cursor]) => [threadID, cursor])).toEqual([
      [externalSummary.thread_id, 0],
      [externalSummary.thread_id, 3],
    ]);
    expect(harness.markThreadRead).not.toHaveBeenCalled();

    await waitUntil(() => externalLiveCall >= 3, 'terminal live page was not requested');
    terminalPage.resolve({
      stream_generation: 1,
      events: [liveEvent(externalSummary.thread_id, 5, 'run.status_changed', {
        run_id: 'run-live',
        status: 'success',
      })],
      next_cursor: 5,
      retained_from_seq: 1,
    });
    await waitUntil(
      () => presences.some((presence) => presence.priority_status === 'completed'),
      'terminal live status did not replace stale running progress',
    );
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    expect(externalLiveCall).toBe(3);
    expect(harness.markThreadRead).not.toHaveBeenCalled();
  });

  it('ignores a late live response after the canonical priority thread changes', async () => {
    const threadA = thread({ active_run_id: 'run-live' });
    const threadB = thread({
      thread_id: 'thread-priority-b',
      title: 'New priority work',
      active_run_id: 'run-live',
    });
    const idleA = { ...threadA, status: 'idle' as const, active_run_id: undefined };
    const bootstrapWithWaiting = (snapshot: FlowerThreadSnapshot): FlowerLiveBootstrap => ({
      ...bootstrap(snapshot),
      live_state: {
        thread_patch: {},
        runs: { 'run-live': { run_id: 'run-live', status: 'running', message_id: 'assistant-live' } },
        model_io: { run_id: 'run-live', phase: 'waiting_response', updated_at_ms: 3_000 },
        approval_actions: {},
        input_requests: {},
      },
    });
    const lateA = deferred<FlowerLiveEventsResponse>();
    let showThreadB = false;
    const listThreads = vi.fn<FlowerSurfaceAdapter['listThreads']>(async () => (
      showThreadB ? [idleA, threadB] : [threadA]
    ));
    const listThreadLiveEvents = vi.fn<FlowerSurfaceAdapter['listThreadLiveEvents']>(async (threadID, cursor) => {
      if (threadID === threadA.thread_id && cursor === 0) return lateA.promise;
      return { stream_generation: 1, events: [], next_cursor: cursor, retained_from_seq: 1 };
    });
    const presences: FlowerCompanionPresenceProjection[] = [];
    const harness = createAdapterHarness({
      listThreads,
      loadThread: vi.fn(async (threadID) => bootstrapWithWaiting(threadID === threadB.thread_id ? threadB : threadA)),
      listThreadLiveEvents,
    });
    renderSurface(harness.adapter, false, false, (presence) => presences.push(presence));

    await waitUntil(
      () => listThreadLiveEvents.mock.calls.some(([threadID]) => threadID === threadA.thread_id),
      'first priority live request did not start',
    );
    const listCallsBeforeSwitch = listThreads.mock.calls.length;
    showThreadB = true;
    await waitUntil(() => listThreads.mock.calls.length > listCallsBeforeSwitch, 'summary refresh did not switch priority', 2_500);
    await waitUntil(
      () => presences.some((presence) => presence.priority_thread_title === 'New priority work'),
      'new priority thread did not reach presence',
    );

    lateA.resolve({
      stream_generation: 1,
      events: [liveEvent(threadA.thread_id, 1, 'model_io.updated', {
        status: { run_id: 'run-live', phase: 'retrying', updated_at_ms: 4_000 },
      })],
      next_cursor: 1,
      retained_from_seq: 1,
    });
    await flushAsync();
    await new Promise((resolve) => window.setTimeout(resolve, 25));

    expect(presences.at(-1)?.priority_thread_title).toBe('New priority work');
    expect(presences.at(-1)?.priority_thread_progress).not.toBe('Retrying model request...');
    expect(harness.markThreadRead).not.toHaveBeenCalled();
  });

  it('moves directly to the next running thread when live terminal state leads stale summaries', async () => {
    const threadA = thread({
      title: 'First running task',
      active_run_id: 'run-live',
    });
    const threadB = thread({
      thread_id: 'thread-running-b',
      title: 'Second running task',
      active_run_id: 'run-b',
    });
    const terminalA = deferred<FlowerLiveEventsResponse>();
    let threadBLiveCalls = 0;
    const listThreads = vi.fn<FlowerSurfaceAdapter['listThreads']>(async () => [threadA, threadB]);
    const loadThread = vi.fn<FlowerSurfaceAdapter['loadThread']>(async (threadID) => {
      const snapshot = threadID === threadB.thread_id ? threadB : threadA;
      const runID = snapshot.active_run_id ?? '';
      return {
        ...bootstrap(snapshot),
        live_state: {
          thread_patch: {},
          runs: { [runID]: { run_id: runID, status: 'running', message_id: `assistant-${runID}` } },
          model_io: { run_id: runID, phase: 'waiting_response', updated_at_ms: 3_000 },
          approval_actions: {},
          input_requests: {},
        },
      };
    });
    const listThreadLiveEvents = vi.fn<FlowerSurfaceAdapter['listThreadLiveEvents']>(async (threadID, cursor) => {
      if (threadID === threadA.thread_id) return terminalA.promise;
      if (threadID === threadB.thread_id) threadBLiveCalls += 1;
      return { stream_generation: 1, events: [], next_cursor: cursor, retained_from_seq: 1 };
    });
    const presences: FlowerCompanionPresenceProjection[] = [];
    const harness = createAdapterHarness({ listThreads, loadThread, listThreadLiveEvents });
    renderSurface(harness.adapter, false, false, (presence) => presences.push(presence));

    await waitUntil(
      () => listThreadLiveEvents.mock.calls.some(([threadID]) => threadID === threadA.thread_id),
      'first running thread did not start live consumption',
    );
    const summaryCallsBeforeTerminal = listThreads.mock.calls.length;
    terminalA.resolve({
      stream_generation: 1,
      events: [liveEvent(threadA.thread_id, 1, 'run.status_changed', {
        run_id: 'run-live',
        status: 'success',
      })],
      next_cursor: 1,
      retained_from_seq: 1,
    });

    await waitUntil(() => threadBLiveCalls > 0, 'next running thread did not take over live consumption');
    await waitUntil(
      () => presences.some((presence) => presence.priority_thread_title === 'Second running task'),
      'next running thread did not replace terminal priority presence',
    );

    expect(listThreads).toHaveBeenCalledTimes(summaryCallsBeforeTerminal);
    expect(presences.at(-1)).toMatchObject({
      priority_status: 'running',
      priority_thread_title: 'Second running task',
      priority_thread_progress: 'Waiting for model response...',
    });
    expect(harness.markThreadRead).not.toHaveBeenCalled();
  });

  it('moves to the next running thread when bootstrap is already terminal', async () => {
    const threadA = thread({
      thread_id: 'thread-bootstrap-a',
      title: 'Stale running summary',
      active_run_id: 'run-live',
    });
    const threadB = thread({
      thread_id: 'thread-bootstrap-b',
      title: 'Bootstrap successor',
      active_run_id: 'run-b',
    });
    const terminalA = {
      ...threadA,
      status: 'success' as const,
      active_run_id: undefined,
    };
    const selected = thread({ status: 'idle', read_status: readStatus(false) });
    let threadALiveCalls = 0;
    let threadBLiveCalls = 0;
    const listThreads = vi.fn<FlowerSurfaceAdapter['listThreads']>(async () => [threadA, threadB, selected]);
    const loadThread = vi.fn<FlowerSurfaceAdapter['loadThread']>(async (threadID) => {
      if (threadID === threadA.thread_id) return bootstrap(terminalA);
      if (threadID === threadB.thread_id) return {
        ...bootstrap(threadB),
        live_state: {
          thread_patch: {},
          runs: { 'run-b': { run_id: 'run-b', status: 'running', message_id: 'assistant-b' } },
          model_io: { run_id: 'run-b', phase: 'waiting_response', updated_at_ms: 3_000 },
          approval_actions: {},
          input_requests: {},
        },
      };
      return bootstrap(selected);
    });
    const listThreadLiveEvents = vi.fn<FlowerSurfaceAdapter['listThreadLiveEvents']>(async (threadID, cursor) => {
      if (threadID === threadA.thread_id) threadALiveCalls += 1;
      if (threadID === threadB.thread_id) threadBLiveCalls += 1;
      return { stream_generation: 1, events: [], next_cursor: cursor, retained_from_seq: 1 };
    });
    const presences: FlowerCompanionPresenceProjection[] = [];
    const harness = createAdapterHarness({ listThreads, loadThread, listThreadLiveEvents });
    renderSurface(harness.adapter, false, false, (presence) => presences.push(presence));

    await waitUntil(
      () => loadThread.mock.calls.some(([threadID]) => threadID === threadA.thread_id),
      'terminal bootstrap did not load',
    );
    const summaryCallsBeforeHandoff = listThreads.mock.calls.length;
    await waitUntil(() => threadBLiveCalls > 0, 'bootstrap successor did not take over live consumption');
    await waitUntil(
      () => presences.some((presence) => presence.priority_thread_title === 'Bootstrap successor'),
      'bootstrap successor did not replace stale running presence',
    );

    expect(threadALiveCalls).toBe(0);
    expect(listThreads).toHaveBeenCalledTimes(summaryCallsBeforeHandoff);
    expect(presences.at(-1)).toMatchObject({
      priority_status: 'running',
      priority_thread_title: 'Bootstrap successor',
      priority_thread_progress: 'Waiting for model response...',
    });
    expect(harness.markThreadRead).not.toHaveBeenCalled();
  });

  it('pauses collapsed live requests while hidden and safely resumes when visible', async () => {
    const running = thread({ active_run_id: 'run-live' });
    const harness = createAdapterHarness({
      listThreads: vi.fn(async () => [running]),
      loadThread: vi.fn(async () => bootstrap(running)),
    });
    renderSurface(harness.adapter);

    await waitUntil(() => harness.listThreadLiveEvents.mock.calls.length > 0, 'collapsed live request did not start');
    setDocumentVisible(false);
    await flushAsync();
    const hiddenCallCount = harness.listThreadLiveEvents.mock.calls.length;
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    expect(harness.listThreadLiveEvents).toHaveBeenCalledTimes(hiddenCallCount);

    setDocumentVisible(true);
    await waitUntil(
      () => harness.listThreadLiveEvents.mock.calls.length > hiddenCallCount,
      'collapsed live subscription did not resume',
    );
    expect(harness.markThreadRead).not.toHaveBeenCalled();
  });

  it('projects a canonical summary-only queued count into companion presence', async () => {
    const queuedSummary = thread({
      status: 'idle',
      queued_turn_count: 2,
      queued_turns: undefined,
    });
    const presences: FlowerCompanionPresenceProjection[] = [];
    const harness = createAdapterHarness({
      listThreads: vi.fn(async () => [queuedSummary]),
      loadThread: vi.fn(async () => bootstrap(queuedSummary)),
    });
    renderSurface(harness.adapter, false, false, (presence) => presences.push(presence));

    await waitUntil(
      () => presences.some((presence) => presence.priority_status === 'queued' && presence.queued_count === 1),
      'summary-only queued count was not projected into companion presence',
    );

    expect(presences.at(-1)).toMatchObject({
      priority_status: 'queued',
      priority_count: 1,
      queued_count: 1,
    });
  });

  it('keeps discovering external work while the Activity companion is maximized', async () => {
    const selected = thread({ status: 'idle', read_status: readStatus(false) });
    const external = thread({
      thread_id: 'thread-external-maximized',
      title: 'Started while maximized',
      updated_at_ms: 4_000,
    });
    const listThreads = vi.fn<FlowerSurfaceAdapter['listThreads']>(async () => [selected, external]);
    const presences: FlowerCompanionPresenceProjection[] = [];
    const harness = createAdapterHarness({
      listThreads,
      loadThread: vi.fn(async () => bootstrap(selected)),
    });
    renderSurface(
      harness.adapter,
      true,
      true,
      (presence) => presences.push(presence),
      'full',
      true,
    );

    await waitUntil(() => listThreads.mock.calls.length >= 1, 'maximized companion did not refresh summaries');
    await waitUntil(
      () => presences.some((presence) => presence.running_count === 1),
      'maximized companion did not discover externally started work',
    );

    expect(presences.at(-1)?.running_count).toBe(1);
  });

  it('requires foreground visibility, loaded detail, and an after-paint token before marking read', async () => {
    const idleThread = thread({ status: 'idle' });
    const foregroundBootstrap = deferred<FlowerLiveBootstrap>();
    const loadThread = vi.fn<FlowerSurfaceAdapter['loadThread']>(async () => {
      if (loadThread.mock.calls.length === 1) return bootstrap(idleThread);
      return foregroundBootstrap.promise;
    });
    const harness = createAdapterHarness({
      loadThread,
      listThreads: vi.fn(async () => [idleThread]),
    });
    renderSurface(harness.adapter, true, true);

    await waitUntil(() => loadThread.mock.calls.length === 1, 'detail bootstrap did not start');
    await flushAsync();
    expect(harness.markThreadRead).not.toHaveBeenCalled();

    setDocumentVisible(false);
    await flushAsync();
    await presentNextFrame();
    expect(harness.markThreadRead).not.toHaveBeenCalled();

    setDocumentVisible(true);
    await waitUntil(() => loadThread.mock.calls.length === 2, 'foreground bootstrap did not start');
    await presentNextFrame();
    expect(harness.markThreadRead).not.toHaveBeenCalled();

    foregroundBootstrap.resolve(bootstrap(idleThread));
    await flushAsync();
    expect(harness.markThreadRead).not.toHaveBeenCalled();

    await presentNextFrame();
    await waitUntil(() => harness.markThreadRead.mock.calls.length === 1, 'visible presented detail was not acknowledged');
  });

  it('keeps live and read handling gated when an engagement bootstrap fails', async () => {
    const loadThread = vi.fn<FlowerSurfaceAdapter['loadThread']>(async () => {
      if (loadThread.mock.calls.length === 1) return bootstrap();
      throw new Error('engagement bootstrap failed');
    });
    const harness = createAdapterHarness({ loadThread });
    const controls = renderSurface(harness.adapter, false, false);

    await waitUntil(() => loadThread.mock.calls.length === 1, 'initial focused thread did not bootstrap');
    await waitUntil(() => harness.listThreadLiveEvents.mock.calls.length > 0, 'collapsed live subscription did not start');
    harness.listThreadLiveEvents.mockClear();
    controls.setEngaged(true);
    controls.setTranscriptVisible(true);
    await waitUntil(() => loadThread.mock.calls.length === 2, 'engagement bootstrap did not start');
    await flushAsync();
    await presentNextFrame();

    expect(harness.listThreadLiveEvents).not.toHaveBeenCalled();
    expect(harness.markThreadRead).not.toHaveBeenCalled();
    expect(host.querySelector('[data-flower-selected-thread-loading="true"]')).toBeNull();
  });
});
