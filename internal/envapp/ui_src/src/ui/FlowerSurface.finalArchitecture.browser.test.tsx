import '../index.css';
import './flower-feature.css';

import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerLiveStreamEnvelope,
  FlowerRuntimeCurrentView,
  FlowerSubagentDetail,
  FlowerTurnLaunchInput,
  FlowerTurnLaunchReceipt,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  activityItem,
  activityTimeline,
  adapter,
  deferred,
  inputRequest,
  launchReceipt,
  liveBootstrap,
  readStatus,
  renderSurfaceWithAdapter,
  runtimeCurrentView,
  settingsSnapshot,
  subagentDetail,
  subagentSummary,
  thread,
  wait,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

function controlledWorkspaceStream(initial: readonly FlowerLiveStreamEnvelope[]) {
  const queued = [...initial];
  let wake: (() => void) | undefined;
  return {
    push(value: FlowerLiveStreamEnvelope) {
      queued.push(value);
      wake?.();
      wake = undefined;
    },
    async *connect({ signal }: Readonly<{ signal: AbortSignal }>): AsyncIterable<FlowerLiveStreamEnvelope> {
      while (!signal.aborted) {
        const value = queued.shift();
        if (value) {
          yield value;
          continue;
        }
        await new Promise<void>((resolve) => {
          wake = resolve;
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      }
    },
  };
}

function resolveInheritedColor(host: HTMLElement, value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  host.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

function srgbChannels(color: string): readonly number[] {
  const channels = color.match(/-?\d*\.?\d+/g)?.slice(0, 3).map(Number) ?? [];
  if (channels.length !== 3) {
    throw new Error(`Expected an sRGB color, received ${color}`);
  }
  return color.startsWith('rgb') ? channels.map((channel) => channel / 255) : channels;
}

function maxSrgbChannelDistance(first: string, second: string): number {
  const firstChannels = srgbChannels(first);
  const secondChannels = srgbChannels(second);
  return Math.max(...firstChannels.map((channel, index) => Math.abs(channel - secondChannels[index])));
}

function completedTerminalThread() {
  const threadID = 'thread-ca1c0220d0484c81cf2a5644d83439b5';
  const runID = 'turn-terminal';
  return thread({
    thread_id: threadID,
    title: 'Terminal convergence',
    status: 'success',
    active_run_id: undefined,
    updated_at_ms: 796,
    read_status: readStatus(false, 796, 'success'),
    messages: [
      { id: 'terminal-user', turn_id: runID, role: 'user', content: '你知道redeven吗', status: 'complete', created_at_ms: 790 },
      { id: 'terminal-thinking-1', turn_id: runID, role: 'assistant', content: '', status: 'complete', created_at_ms: 791, blocks: [{ type: 'thinking', content: '先检查项目信息。' }] },
      {
        id: 'terminal-tool-1', turn_id: runID, role: 'assistant', content: '', status: 'complete', created_at_ms: 792,
        blocks: [activityTimeline({
          thread_id: threadID, run_id: runID, turn_id: runID,
          items: [activityItem({ item_id: 'terminal-call-1', label: 'Inspect project' })],
        })],
      },
      { id: 'terminal-thinking-2', turn_id: runID, role: 'assistant', content: '', status: 'complete', created_at_ms: 793, blocks: [{ type: 'thinking', content: '整理检查结果。' }] },
      {
        id: 'terminal-tool-2', turn_id: runID, role: 'assistant', content: '', status: 'complete', created_at_ms: 794,
        blocks: [activityTimeline({
          thread_id: threadID, run_id: runID, turn_id: runID,
          items: [activityItem({ item_id: 'terminal-call-2', label: 'Read documentation' })],
        })],
      },
      { id: 'terminal-answer', turn_id: runID, role: 'assistant', content: 'Redeven 是一个本地开发环境产品。', status: 'complete', created_at_ms: 796 },
    ],
  });
}

describe('Flower final thread cache and workspace transport', () => {
  it('presents an unknown effect as terminal failure without replay controls', async () => {
    const failed = thread({
      thread_id: 'thread-unknown-effect-browser',
      title: 'Unknown effect',
      status: 'failed',
      error: {
        code: 'floret_effect_outcome_unknown',
        message: 'private effect dispatch state',
      },
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [failed]),
      loadThread: vi.fn(async () => liveBootstrap(failed)),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${failed.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${failed.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-error-card')));

    const errorText = runtime.querySelector('.flower-error-card')?.textContent ?? '';
    expect(errorText).toContain('The task was stopped to avoid duplicate execution.');
    expect(errorText).not.toContain('private effect dispatch state');
    expect(runtime.querySelector('.flower-error-actions button')).toBeNull();
    expect(runtime.querySelector('[data-flower-effect-retry]')).toBeNull();
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect((runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement).disabled).toBe(false);
  });

  it('coalesces live read revisions while one acknowledgement is in flight', async () => {
    const initial = thread({
      thread_id: 'thread-read-ack-coalescing',
      title: 'Read acknowledgement coalescing',
      status: 'success',
      read_status: readStatus(true, 7, 'success'),
    });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [initial],
    }]);
    const firstAcknowledgement = deferred<ReturnType<typeof readStatus>>();
    const markThreadRead = vi.fn(async (_threadID: string, snapshot: { activity_revision: number }) => {
      if (snapshot.activity_revision === 7) return firstAcknowledgement.promise;
      return {
        is_unread: false,
        snapshot,
        read_state: { last_seen_activity_revision: snapshot.activity_revision },
      };
    });
    let latestThread = initial;
    const loadThread = vi.fn(async () => liveBootstrap(latestThread, latestThread.updated_at_ms));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [initial]),
      loadThread,
      connectLiveStream: stream.connect,
      markThreadRead,
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${initial.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${initial.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => markThreadRead.mock.calls.length === 1);

    latestThread = thread({
      ...initial,
      updated_at_ms: 8,
      read_status: readStatus(true, 8, 'success'),
    });
    stream.push({
      schema_version: 1,
      kind: 'summary.batch',
      summaries: [latestThread],
    });
    await waitFor(() => loadThread.mock.calls.length >= 2);
    latestThread = thread({
      ...initial,
      updated_at_ms: 9,
      read_status: readStatus(true, 9, 'success'),
    });
    stream.push({
      schema_version: 1,
      kind: 'summary.batch',
      summaries: [latestThread],
    });
    await waitFor(() => loadThread.mock.calls.length >= 3);
    await wait(25);
    expect(markThreadRead).toHaveBeenCalledTimes(1);

    firstAcknowledgement.resolve(readStatus(true, 9, 'success'));
    await waitFor(() => markThreadRead.mock.calls.length === 2);

    expect(markThreadRead.mock.calls.map((call) => call[1].activity_revision)).toEqual([7, 9]);
  });

  it('keeps a running Subagent window open and orders HTTP, live, and reconnect current views', async () => {
    const parent = thread({
      thread_id: 'thread-parent-live-subagent',
      title: 'Parent research task',
      status: 'running',
      active_run_id: 'parent-run',
      subagents: [],
    });
    const peer = thread({
      thread_id: 'thread-peer-live-subagent',
      title: 'Another parent task',
      subagents: [],
    });
    const child = subagentSummary({
      parent_thread_id: parent.thread_id,
      thread_id: 'thread-child-live-subagent',
      task_name: 'Research model releases',
      task_description: 'Review the latest model releases.',
      status: 'running',
    });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [parent, peer],
    }]);
    const surfaceAdapter = adapter(true);
    const firstDetail = deferred<FlowerSubagentDetail>();
    let parentDetailVersion = 1;
    const runningChildCurrent = (viewVersion: number, output: string): FlowerRuntimeCurrentView => ({
      thread_id: child.thread_id,
      view_version: viewVersion,
      activity: 'active',
      turn_id: 'child-turn',
      run_id: 'child-run',
      run_progress: { phase: 'streaming' },
      items: [
        {
          id: 'child-live', turn_id: 'child-turn', run_id: 'child-run', ordinal: 1,
          kind: 'assistant', text: 'Live child content.',
        },
        {
          id: 'child-tool-live', turn_id: 'child-turn', run_id: 'child-run', ordinal: 2,
          kind: 'tool', activity: {
            item_id: 'child-tool-live', tool_id: 'child-tool-live', tool_name: 'terminal.exec', kind: 'tool',
            status: 'running', severity: 'normal', needs_attention: false, requires_approval: false,
            presentation: {
              label: 'Run command',
              description: 'Inspect live output',
              renderer: 'terminal',
              payload: { command: 'inspect --stream', output },
            },
          },
        },
        ...(viewVersion >= 12 ? [{
          id: 'child-tool-peer', turn_id: 'child-turn', run_id: 'child-run', ordinal: 3,
          kind: 'tool' as const, activity: {
            item_id: 'child-tool-peer', tool_id: 'child-tool-peer', tool_name: 'terminal.exec', kind: 'tool',
            status: 'running', severity: 'normal', needs_attention: false, requires_approval: false,
            presentation: {
              label: 'Run command',
              description: 'Inspect peer output',
              renderer: 'terminal',
              payload: { command: 'inspect --peer', output: 'peer stream' },
            },
          },
        }] : []),
      ],
    });
    const loadSubagentDetail = vi.fn()
      .mockImplementationOnce(async () => firstDetail.promise)
      .mockResolvedValue(subagentDetail({
        summary: { ...child, status: 'completed' },
        current: {
          thread_id: child.thread_id, view_version: 20, activity: 'idle', turn_id: 'child-turn',
          last_outcome: 'completed',
          items: [{
            id: 'child-final', turn_id: 'child-turn', run_id: 'child-run', ordinal: 1,
            kind: 'assistant', text: 'Reconnected final child result.',
          }],
        },
      }));
    const runtime = renderSurfaceWithAdapter({
      ...surfaceAdapter,
      listThreads: vi.fn(async () => [parent, peer]),
      loadThread: vi.fn(async (threadID: string) => liveBootstrap(
        threadID === parent.thread_id ? parent : peer,
        threadID === parent.thread_id ? parentDetailVersion : 1,
      )),
      connectLiveStream: stream.connect,
      loadSubagentDetail,
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${parent.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${parent.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector(`[data-thread-id="${parent.thread_id}"]`)?.getAttribute('data-flower-thread-active') === 'true');
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: parent.thread_id,
      subagents: [child],
    });

    await waitFor(() => runtime.querySelector('.flower-header-icon-badge')?.textContent === '1');
    expect(runtime.querySelector(`[data-thread-id="${child.thread_id}"]`)).toBeNull();
    const trigger = runtime.querySelector('button[aria-controls="flower-subagents-dropdown"]') as HTMLButtonElement;
    trigger.click();
    await waitFor(() => Boolean(document.querySelector(`[data-flower-subagent-row="0"]`)));
    const subagentRow = document.querySelector(`[data-flower-subagent-row="0"]`) as HTMLButtonElement;
    const rowOrb = subagentRow.querySelector<HTMLCanvasElement>('[data-thinking-orb-state="composing"]');
    const rowTitle = subagentRow.querySelector('.flower-subagent-dropdown-name') as HTMLElement;
    expect(rowOrb).not.toBeNull();
    expect(rowOrb?.classList.contains('flower-subagent-thinking-orb')).toBe(true);
    expect(getComputedStyle(rowTitle).animationName).toBe('flower-activity-title-sweep');
    rowTitle.style.setProperty('--foreground', '#f4f7fb');
    rowTitle.style.setProperty('--primary', '#f4f7fb');
    rowTitle.style.setProperty('--flower-subagents-panel', '#28313d');
    rowTitle.style.setProperty('--flower-subagents-active', '#6bb7ff');
    expect(maxSrgbChannelDistance(
      resolveInheritedColor(rowTitle, 'var(--flower-subagent-running-text-base)'),
      resolveInheritedColor(rowTitle, 'var(--flower-subagent-running-text-highlight)'),
    )).toBeGreaterThan(0.12);
    subagentRow.click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-detail="open"]')));

    const detail = document.querySelector('[data-flower-subagent-detail="open"]') as HTMLElement;
    const detailSignal = detail.querySelector('.flower-subagent-detail-signal') as HTMLElement;
    const detailOrb = detailSignal.querySelector<HTMLCanvasElement>('[data-thinking-orb-state="composing"]');
    const statusText = detail.querySelector('.flower-subagent-status-text') as HTMLElement;
    const detailWindow = document.querySelector<HTMLElement>('[data-floe-geometry-surface="floating-window"]');
    expect(detailWindow).not.toBeNull();
    await waitFor(() => detailWindow?.dataset.floatingPresence === 'open');
    await waitFor(() => getComputedStyle(detailWindow!).opacity === '1');
    expect(detailOrb).not.toBeNull();
    expect(detailSignal.querySelector('svg')).toBeNull();
    expect(getComputedStyle(detailSignal).borderRadius).toBe('9999px');
    expect(statusText.textContent).toBe('Running');
    expect(getComputedStyle(statusText).animationName).toBe('flower-activity-title-sweep');
    statusText.style.setProperty('--primary', '#f4f7fb');
    statusText.style.setProperty('--flower-subagent-window-text', '#f4f7fb');
    statusText.style.setProperty('--flower-subagent-window-surface-band', '#28313d');
    statusText.style.setProperty('--flower-subagent-window-accent', '#6bb7ff');
    expect(maxSrgbChannelDistance(
      resolveInheritedColor(statusText, 'var(--flower-subagent-running-text-base)'),
      resolveInheritedColor(statusText, 'var(--flower-subagent-running-text-highlight)'),
    )).toBeGreaterThan(0.12);

    const presenceStates: string[] = [];
    const presenceObserver = new MutationObserver(() => {
      presenceStates.push(detailWindow?.dataset.floatingPresence ?? '');
    });
    presenceObserver.observe(detailWindow!, { attributes: true, attributeFilter: ['data-floating-presence'] });

    expect(loadSubagentDetail).toHaveBeenCalledTimes(1);
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: parent.thread_id,
      subagents: [],
    });
    await waitFor(() => runtime.querySelector('.flower-header-icon-badge') === null);
    expect(document.querySelector('[data-flower-subagent-detail="open"]')).not.toBeNull();

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: parent.thread_id,
      subagent_current: {
        thread_id: child.thread_id, view_version: 8, activity: 'active', turn_id: 'child-turn', run_id: 'child-run',
        run_progress: { phase: 'streaming' },
        items: [{
          id: 'child-live', turn_id: 'child-turn', run_id: 'child-run', ordinal: 1,
          kind: 'assistant', text: 'Live child content.', live: true,
        }],
      },
    });
    await waitFor(() => document.body.textContent?.includes('Live child content.') === true);
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: parent.thread_id,
      subagent_current: runningChildCurrent(9, 'stream chunk 1'),
    });
    await waitFor(() => Boolean(detail.querySelector('[data-flower-activity-item-id="child-tool-live"]')));
    const runningToolRow = detail.querySelector('[data-flower-activity-item-id="child-tool-live"]') as HTMLElement;
    const runningToolButton = runningToolRow.querySelector('.flower-activity-inline-button') as HTMLElement;
    const runningToolTitle = runningToolRow.querySelector('.flower-activity-inline-title') as HTMLElement;
    expect(getComputedStyle(runningToolButton).boxShadow).toBe('none');
    expect(getComputedStyle(runningToolTitle, '::after').animationName).toBe('flower-activity-title-sweep');

    const parentViewport = runtime.querySelector('.flower-chat-transcript') as HTMLDivElement;
    const childViewport = detail.querySelector('.flower-subagent-detail-transcript') as HTMLDivElement;
    let parentScrollTop = 800;
    let childScrollTop = 800;
    Object.defineProperties(parentViewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
      scrollTop: {
        configurable: true,
        get: () => parentScrollTop,
        set: (value: number) => { parentScrollTop = value; },
      },
    });
    Object.defineProperties(childViewport, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_200 },
      scrollTop: {
        configurable: true,
        get: () => childScrollTop,
        set: (value: number) => { childScrollTop = value; },
      },
    });
    vi.spyOn(childViewport, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({
      x: 0, y: 0, width: 800, height: 400,
    }));
    vi.spyOn(runningToolButton, 'getBoundingClientRect').mockReturnValue(DOMRect.fromRect({
      x: 20, y: 100, width: 700, height: 32,
    }));
    parentViewport.dispatchEvent(new Event('scroll'));
    childViewport.dispatchEvent(new Event('scroll'));

    runningToolButton.click();
    childViewport.dispatchEvent(new Event('scroll'));
    await waitFor(() => runningToolButton.getAttribute('aria-expanded') === 'true');
    await waitFor(() => Boolean(detail.querySelector('.flower-activity-terminal-output')));
    const terminalViewport = detail.querySelector('.flower-activity-terminal-output');

    Object.defineProperty(childViewport, 'scrollHeight', { configurable: true, value: 1_600 });
    for (let viewVersion = 10; viewVersion <= 14; viewVersion += 1) {
      stream.push({
        schema_version: 1,
        kind: 'thread.batch',
        thread_id: parent.thread_id,
        subagent_current: runningChildCurrent(viewVersion, `stream chunk ${viewVersion - 8}`),
      });
      await wait(55);
      expect(detail.querySelector('[data-flower-activity-item-id="child-tool-live"]')).toBe(runningToolRow);
      expect(detail.querySelector('.flower-activity-terminal-output')).toBe(terminalViewport);
      expect(runningToolButton.getAttribute('aria-expanded')).toBe('true');
    }
    await waitFor(() => runningToolRow.dataset.state === 'open');
    expect(detail.querySelector('[data-flower-subagent-ledger-kind="activity"]')?.textContent).toContain('2 operations');
    expect(childViewport.scrollTop).toBeLessThan(1_180);
    expect(parentViewport.scrollTop).toBe(800);
    expect(terminalViewport?.textContent).toContain('stream chunk 6');

    Object.defineProperty(parentViewport, 'scrollHeight', { configurable: true, value: 1_600 });
    parentDetailVersion = 2;
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: parent.thread_id,
      current: {
        thread_id: parent.thread_id,
        view_version: 2,
        activity: 'active',
        turn_id: 'parent-turn',
        run_id: 'parent-run',
        run_progress: { phase: 'streaming' },
        items: [{
          id: 'parent-live', turn_id: 'parent-turn', run_id: 'parent-run', ordinal: 1,
          kind: 'assistant', text: 'Parent live growth.', live: true,
        }],
      },
    });
    await waitFor(() => parentViewport.scrollTop === 1_200);

    await waitFor(() => Boolean(detail.querySelector('.flower-subagent-detail-scroll-to-latest button')));
    const childScrollToLatest = detail.querySelector('.flower-subagent-detail-scroll-to-latest button') as HTMLButtonElement;
    childScrollToLatest.click();
    await waitFor(() => childViewport.scrollTop === 1_200);
    expect(parentViewport.scrollTop).toBe(1_200);

    childViewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -24, bubbles: true }));
    childScrollTop = 900;
    childViewport.dispatchEvent(new Event('scroll'));
    Object.defineProperty(childViewport, 'scrollHeight', { configurable: true, value: 1_800 });
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: parent.thread_id,
      subagent_current: runningChildCurrent(15, 'stream chunk 7'),
    });
    await wait(55);
    expect(childViewport.scrollTop).toBe(900);
    expect(parentViewport.scrollTop).toBe(1_200);
    await waitFor(() => Boolean(detail.querySelector('.flower-subagent-detail-scroll-to-latest button')));
    (detail.querySelector('.flower-subagent-detail-scroll-to-latest button') as HTMLButtonElement).click();
    await waitFor(() => childViewport.scrollTop === 1_400);
    expect(parentViewport.scrollTop).toBe(1_200);

    await wait(25);
    presenceObserver.disconnect();
    expect(document.querySelector('[data-floe-geometry-surface="floating-window"]')).toBe(detailWindow);
    expect(detailWindow?.dataset.floatingPresence).toBe('open');
    expect(getComputedStyle(detailWindow!).opacity).toBe('1');
    expect(presenceStates).not.toContain('entering');

    firstDetail.resolve(subagentDetail({
      summary: child,
      current: {
        thread_id: child.thread_id, view_version: 7, activity: 'active', turn_id: 'child-turn', run_id: 'child-run',
        run_progress: { phase: 'streaming' },
        items: [{
          id: 'child-stale', turn_id: 'child-turn', run_id: 'child-run', ordinal: 1,
          kind: 'assistant', text: 'Stale HTTP content.', live: true,
        }],
      },
    }));
    await wait(25);
    expect(document.body.textContent).toContain('Live child content.');
    expect(document.body.textContent).not.toContain('Stale HTTP content.');
    expect(document.querySelector('[data-flower-subagent-dock]')).toBeNull();

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(loadSubagentDetail).toHaveBeenCalledTimes(1);
    vi.useRealTimers();

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: 'other-parent',
      subagent_current: { thread_id: child.thread_id, view_version: 99, items: [] },
    });
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: parent.thread_id,
      subagent_current: { thread_id: 'other-child', view_version: 99, items: [] },
    });
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: parent.thread_id,
      subagent_current: {
        thread_id: child.thread_id,
        view_version: 100,
        items: [{ id: 'incomplete-child-item', ordinal: 1, kind: 'assistant', text: 'Invalid child content.' }],
      } as unknown as FlowerRuntimeCurrentView,
    });
    await wait(25);
    expect(document.body.textContent).toContain('Live child content.');
    expect(document.body.textContent).not.toContain('Invalid child content.');

    stream.push({ schema_version: 1, kind: 'ready', summaries: [parent, peer] });
    await waitFor(() => loadSubagentDetail.mock.calls.length === 2);
    await waitFor(() => document.body.textContent?.includes('Reconnected final child result.') === true);

    expect(document.querySelector('[data-floe-geometry-surface="floating-window"]')).not.toBeNull();
    expect(runtime.querySelector(`[data-thread-id="${parent.thread_id}"]`)?.getAttribute('data-flower-thread-active')).toBe('true');
    expect(runtime.querySelector(`[data-thread-id="${child.thread_id}"]`)).toBeNull();

    (runtime.querySelector(`[data-thread-id="${peer.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector(`[data-thread-id="${peer.thread_id}"]`)?.getAttribute('data-flower-thread-active') === 'true');
    expect(document.querySelector('[data-flower-subagent-detail="open"]')).toBeNull();
  });

  it('keeps the Subagent window mounted after initial failure and retries in place', async () => {
    const parent = thread({
      thread_id: 'thread-parent-subagent-retry',
      title: 'Parent retry task',
      subagents: [],
    });
    const child = subagentSummary({
      parent_thread_id: parent.thread_id,
      thread_id: 'thread-child-subagent-retry',
      task_name: 'Retry child detail',
      status: 'running',
    });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [parent],
    }]);
    const firstDetail = deferred<FlowerSubagentDetail>();
    const loadSubagentDetail = vi.fn()
      .mockImplementationOnce(async () => firstDetail.promise)
      .mockResolvedValue(subagentDetail({
        summary: child,
        current: {
          thread_id: child.thread_id,
          view_version: 2,
          activity: 'active',
          turn_id: 'child-turn-retry',
          run_id: 'child-run-retry',
          run_progress: { phase: 'streaming' },
          items: [{
            id: 'child-retry-result',
            turn_id: 'child-turn-retry',
            run_id: 'child-run-retry',
            ordinal: 1,
            kind: 'assistant',
            text: 'Child detail recovered.',
            live: true,
          }],
        },
      }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [parent]),
      loadThread: vi.fn(async () => liveBootstrap(parent, 1)),
      connectLiveStream: stream.connect,
      loadSubagentDetail,
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${parent.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${parent.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector(`[data-thread-id="${parent.thread_id}"]`)?.getAttribute('data-flower-thread-active') === 'true');
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: parent.thread_id,
      subagents: [child],
    });
    await waitFor(() => runtime.querySelector('.flower-header-icon-badge')?.textContent === '1');
    (runtime.querySelector('button[aria-controls="flower-subagents-dropdown"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-row="0"]')));
    (document.querySelector('[data-flower-subagent-row="0"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(document.querySelector('[data-flower-subagent-detail="open"]')));

    const windowBeforeFailure = document.querySelector('[data-floe-geometry-surface="floating-window"]');
    expect(windowBeforeFailure).not.toBeNull();
    firstDetail.reject(new Error('Temporary child detail failure.'));
    await waitFor(() => Boolean(document.querySelector('.flower-subagent-detail-retry')));
    expect(document.querySelector('[data-floe-geometry-surface="floating-window"]')).toBe(windowBeforeFailure);

    (document.querySelector('.flower-subagent-detail-retry') as HTMLButtonElement).click();
    await waitFor(() => document.body.textContent?.includes('Child detail recovered.') === true);
    expect(loadSubagentDetail).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-floe-geometry-surface="floating-window"]')).toBe(windowBeforeFailure);
    expect(document.querySelector('[data-flower-subagent-dock]')).toBeNull();
  });

  it('wraps live thinking without making the transcript horizontally scrollable', async () => {
    const threadID = 'thread-thinking-wrap';
    const turnID = 'turn-thinking-wrap';
    const runID = 'run-thinking-wrap';
    const longURL = `https://example.invalid/${'path-segment-'.repeat(320)}`;
    const longToken = 'unbroken'.repeat(512);
    const thinkingText = `Inspecting the workspace.\n${longURL}\n${longToken}`;
    const runningThread = thread({
      thread_id: threadID,
      title: 'Thinking wrap',
      status: 'running',
      active_run_id: runID,
      messages: [{
        id: 'user:thinking-wrap', turn_id: turnID, role: 'user', content: 'Inspect the workspace',
        status: 'complete', created_at_ms: 1,
      }],
    });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [runningThread],
    }]);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread, 1)),
      connectLiveStream: stream.connect,
    });
    runtime.style.width = '640px';
    runtime.style.height = '720px';

    await waitFor(() => runtime.querySelector(`[data-thread-id="${threadID}"] button`) !== null);
    (runtime.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-message-id="user:thinking-wrap"]') !== null);
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID,
        view_version: 2,
        activity: 'active',
        run_id: runID,
        turn_id: turnID,
        run_progress: { phase: 'streaming' },
        items: [
          { id: 'user:thinking-wrap', turn_id: turnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: 'Inspect the workspace' },
          { id: 'thinking:thinking-wrap', turn_id: turnID, run_id: 'run-fixture', ordinal: 2, kind: 'thinking', text: thinkingText, live: true },
        ],
      },
    });

    await waitFor(() => runtime.querySelector('.flower-thinking-content')?.textContent === thinkingText);
    const transcript = runtime.querySelector<HTMLElement>('.flower-chat-transcript');
    const blockStack = runtime.querySelector<HTMLElement>('.flower-message-block-stack-assistant');
    const thinkingContent = runtime.querySelector<HTMLElement>('.flower-thinking-content');
    expect(transcript).not.toBeNull();
    expect(blockStack).not.toBeNull();
    expect(thinkingContent).not.toBeNull();
    expect(thinkingContent?.textContent).toContain(`\n${longURL}\n`);
    expect(getComputedStyle(blockStack!).wordBreak).toBe('break-word');
    expect(getComputedStyle(blockStack!).overflowWrap).toBe('anywhere');
    expect(transcript!.scrollWidth).toBeLessThanOrEqual(transcript!.clientWidth + 1);
  });

  it('renders cumulative thinking before the provider turn completes', async () => {
    const threadID = 'thread-progressive-thinking';
    const turnID = 'turn-progressive-thinking';
    const runID = 'run-progressive-thinking';
    const runningThread = thread({
      thread_id: threadID,
      title: 'Progressive thinking',
      status: 'running',
      active_run_id: runID,
      messages: [{
        id: 'user:progressive-thinking', turn_id: turnID, role: 'user', content: 'Explain the workspace',
        status: 'complete', created_at_ms: 1,
      }],
    });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [runningThread],
    }]);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread: vi.fn(async () => liveBootstrap(runningThread, 1)),
      connectLiveStream: stream.connect,
    });

    await waitFor(() => runtime.querySelector(`[data-thread-id="${threadID}"] button`) !== null);
    (runtime.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-message-id="user:progressive-thinking"]') !== null);
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID,
        view_version: 2,
        activity: 'active',
        run_id: runID,
        turn_id: turnID,
        run_progress: { phase: 'streaming' },
        items: [
          { id: 'user:progressive-thinking', turn_id: turnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: 'Explain the workspace' },
          { id: 'thinking:progressive-thinking', turn_id: turnID, run_id: 'run-fixture', ordinal: 2, kind: 'thinking', text: 'Inspecting files', live: true },
        ],
      },
    });
    await waitFor(() => runtime.querySelector('.flower-thinking-content')?.textContent?.includes('Inspecting files') === true);
    const thinkingDisclosure = runtime.querySelector<HTMLElement>('.flower-thinking-disclosure');
    const thinkingToggle = runtime.querySelector<HTMLButtonElement>('.flower-thinking-toggle');
    expect(thinkingDisclosure?.getAttribute('data-flower-thinking-view')).toBe('preview');
    expect(runtime.querySelector('.flower-thinking-content')?.getAttribute('data-flower-thinking-view')).toBe('preview');
    expect(thinkingToggle?.getAttribute('aria-expanded')).toBe('true');
    thinkingToggle?.click();
    await waitFor(() => thinkingDisclosure?.getAttribute('data-flower-thinking-view') === 'expanded');
    expect(thinkingToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(runtime.textContent).not.toContain('Final workspace explanation');

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID,
        view_version: 3,
        activity: 'active',
        run_id: runID,
        turn_id: turnID,
        run_progress: { phase: 'streaming' },
        items: [
          { id: 'user:progressive-thinking', turn_id: turnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: 'Explain the workspace' },
          { id: 'thinking:progressive-thinking', turn_id: turnID, run_id: 'run-fixture', ordinal: 2, kind: 'thinking', text: 'Inspecting files and configuration', live: true },
        ],
      },
    });
    await waitFor(() => runtime.querySelector('.flower-thinking-content')?.textContent?.includes('and configuration') === true);
    expect(runtime.textContent).not.toContain('Final workspace explanation');

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID,
        view_version: 4,
        activity: 'idle',
        turn_id: turnID,
        last_outcome: 'completed',
        items: [
          { id: 'user:progressive-thinking', turn_id: turnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: 'Explain the workspace' },
          { id: 'thinking:progressive-thinking', turn_id: turnID, run_id: 'run-fixture', ordinal: 2, kind: 'thinking', text: 'Inspecting files and configuration' },
          { id: 'assistant:progressive-thinking', turn_id: turnID, run_id: 'run-fixture', ordinal: 3, kind: 'assistant', text: 'Final workspace explanation' },
        ],
      },
    });
    await waitFor(() => runtime.textContent?.includes('Final workspace explanation') === true);
    expect(runtime.querySelector('.flower-thinking-disclosure')?.getAttribute('data-flower-thinking-view')).toBe('collapsed');
    expect(runtime.querySelector('.flower-thinking-toggle')?.getAttribute('aria-expanded')).toBe('false');
    expect(runtime.querySelector('.flower-thinking-content')).toBeNull();
  });

  it('keeps stop then continue on one stream and presents each truthful live stage', async () => {
    const threadID = 'thread-stop-continue-progress';
    const oldTurnID = 'turn-stopped';
    const newTurnID = 'turn-continued';
    const oldRunID = 'run-stopped';
    const newRunID = 'run-continued';
    const runningThread = thread({
      thread_id: threadID,
      title: 'Stop then continue',
      status: 'running',
      active_run_id: oldRunID,
      run_progress: { phase: 'preparing', run_id: oldRunID, turn_id: oldTurnID },
      messages: [{
        id: 'user:stopped', turn_id: oldTurnID, role: 'user', content: 'Start the task',
        status: 'complete', created_at_ms: 1,
      }],
    });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [runningThread],
    }]);
    const connectLiveStream = vi.fn(stream.connect);
    const stopThread = vi.fn(async () => undefined);
    const loadThread = vi.fn(async () => liveBootstrap(runningThread, 1));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [runningThread]),
      loadThread,
      stopThread,
      connectLiveStream,
    });

    await waitFor(() => runtime.querySelector(`[data-thread-id="${threadID}"] button`) !== null);
    (runtime.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-primary-action="stop"]') !== null);
    (runtime.querySelector('[data-flower-primary-action="stop"]') as HTMLButtonElement).click();
    await waitFor(() => stopThread.mock.calls.length === 1);

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID, view_version: 2, activity: 'idle', turn_id: oldTurnID, last_outcome: 'cancelled',
        items: [{ id: 'user:stopped', turn_id: oldTurnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: 'Start the task' }],
      },
    });
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID, view_version: 3, activity: 'active', run_id: newRunID, turn_id: newTurnID,
        run_progress: { phase: 'waiting_response' },
        items: [
          { id: 'user:stopped', turn_id: oldTurnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: 'Start the task' },
          { id: 'user:continued', turn_id: newTurnID, run_id: 'run-fixture', ordinal: 2, kind: 'user', text: '请继续' },
          { id: 'assistant:continued', turn_id: newTurnID, run_id: 'run-fixture', ordinal: 3, kind: 'assistant', text: '', live: true },
        ],
      },
    });
    await waitFor(() => runtime.querySelector('[data-flower-progress-run-id="run-continued"]') !== null);
    const progressIndicator = runtime.querySelector('.flower-model-status-indicator');
    const progressFlower = progressIndicator?.querySelector('.flower-model-status-flower');
    const progressDots = progressIndicator?.querySelector('.flower-model-status-dots');
    expect(runtime.querySelector('.flower-live-progress-placeholder')).toBeNull();
    expect(progressIndicator?.closest('.flower-model-status-lane')).not.toBeNull();
    expect(runtime.textContent).toContain('Waiting for model response');

    // A late terminal view from the stopped turn cannot replace the newer turn.
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID, view_version: 2, activity: 'idle', turn_id: oldTurnID, last_outcome: 'cancelled',
        items: [{ id: 'user:stopped', turn_id: oldTurnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: 'Start the task' }],
      },
    });
    await waitFor(() => runtime.textContent?.includes('请继续') === true);
    expect(runtime.querySelector('[data-flower-progress-run-id="run-continued"]')).toBe(progressIndicator);

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID, view_version: 4, activity: 'active', run_id: newRunID, turn_id: newTurnID,
        run_progress: { phase: 'streaming' },
        items: [
          { id: 'user:continued', turn_id: newTurnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: '请继续' },
          { id: 'thinking:continued', turn_id: newTurnID, run_id: 'run-fixture', ordinal: 2, kind: 'thinking', text: 'Inspecting the next step', live: true },
        ],
      },
    });
    await waitFor(() => runtime.querySelector('.flower-thinking-content')?.textContent?.includes('Inspecting the next step') === true);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBe(progressIndicator);
    expect(progressIndicator?.querySelector('.flower-model-status-flower')).toBe(progressFlower);
    expect(progressIndicator?.querySelector('.flower-model-status-dots')).toBe(progressDots);
    expect(runtime.textContent).toContain('Thinking');

    const toolActivity = {
      item_id: 'tool:continued', tool_id: 'tool:continued', tool_name: 'file.write', kind: 'tool',
      status: 'running', severity: 'normal', needs_attention: false, requires_approval: false,
      presentation: {
        label: 'weather_gd.py', renderer: 'file',
        chips: [
          { kind: 'operation', label: 'operation', value: 'write' },
          { kind: 'display_name', label: 'display name', value: 'weather_gd.py' },
          { kind: 'change_type', label: 'create' },
        ],
        payload: { operation: 'write', display_name: 'weather_gd.py', change_type: 'create' },
      },
    };
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID, view_version: 5, activity: 'active', run_id: newRunID, turn_id: newTurnID,
        run_progress: { phase: 'tool_execution' },
        items: [
          { id: 'user:continued', turn_id: newTurnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: '请继续' },
          { id: 'thinking:continued', turn_id: newTurnID, run_id: 'run-fixture', ordinal: 2, kind: 'thinking', text: 'Inspecting the next step' },
          { id: 'tool:continued', turn_id: newTurnID, run_id: 'run-fixture', ordinal: 3, kind: 'tool', activity: toolActivity },
        ],
      },
    });
    await waitFor(() => runtime.querySelector('[data-flower-activity-item-id="tool:continued"]') !== null);
    const toolRow = runtime.querySelector('[data-flower-activity-item-id="tool:continued"]') as HTMLElement;
    expect(toolRow.textContent).toContain('Edit');
    expect(toolRow.textContent).toContain('weather_gd.py');
    expect(toolRow.textContent).not.toContain('operation write');
    expect(toolRow.textContent).not.toContain('display name');
    expect(toolRow.querySelector('button.flower-activity-inline-button')).toBeNull();
    expect(runtime.textContent).toContain('Using a tool');
    expect(runtime.querySelector('.flower-model-status-indicator')).toBe(progressIndicator);

    const completedToolActivity = {
      ...toolActivity,
      status: 'success',
      presentation: {
        ...toolActivity.presentation,
        chips: [],
        payload: {
          operation: 'write',
          display_name: 'weather_gd.py',
          change_type: 'create',
          additions: 49,
          deletions: 0,
          unified_diff: '--- /dev/null\n+++ b/weather_gd.py\n@@ -0,0 +1,49 @@\n+def main():\n+    return "sunny"',
        },
      },
    };
    const assistantCurrent = (version: number, text: string): FlowerLiveStreamEnvelope & { current: FlowerRuntimeCurrentView } => ({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        thread_id: threadID, view_version: version, activity: 'active', run_id: newRunID, turn_id: newTurnID,
        run_progress: { phase: 'streaming' },
        items: [
          { id: 'user:continued', turn_id: newTurnID, run_id: 'run-fixture', ordinal: 1, kind: 'user', text: '请继续' },
          { id: 'thinking:continued', turn_id: newTurnID, run_id: 'run-fixture', ordinal: 2, kind: 'thinking', text: 'Inspecting the next step' },
          { id: 'tool:continued', turn_id: newTurnID, run_id: 'run-fixture', ordinal: 3, kind: 'tool', activity: completedToolActivity },
          { id: 'assistant:continued', turn_id: newTurnID, run_id: 'run-fixture', ordinal: 4, kind: 'assistant', text, live: true },
        ],
      },
    });
    stream.push(assistantCurrent(6, 'Weather data'));
    await waitFor(() => runtime.textContent?.includes('Weather data') === true);
    await waitFor(() => toolRow.querySelector('.flower-activity-inline-change-stats')?.textContent?.includes('+49') === true);
    expect(toolRow.querySelector('.flower-activity-inline-change-stats')?.textContent).toContain('-0');
    expect(toolRow.textContent).not.toContain('display name');
    (toolRow.querySelector('button.flower-activity-inline-button') as HTMLButtonElement).click();
    await waitFor(() => toolRow.querySelector('.flower-activity-file-diff-unified') !== null);
    expect(toolRow.querySelector('.flower-activity-file-diff-unified')?.textContent).toContain('def main():');
    expect(toolRow.textContent).not.toContain('No textual diff');
    expect(toolRow.textContent).not.toContain('create');
    expect(runtime.textContent).toContain('Thinking');
    stream.push(assistantCurrent(7, 'Weather data is ready'));
    await waitFor(() => runtime.textContent?.includes('Weather data is ready') === true);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBe(progressIndicator);

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        ...assistantCurrent(8, 'Weather data is ready').current,
        view_version: 8,
        run_progress: { phase: 'retrying' },
      },
    });
    await waitFor(() => runtime.textContent?.includes('Retrying') === true);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBe(progressIndicator);

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        ...assistantCurrent(9, 'Weather data is ready').current,
        view_version: 9,
        run_progress: { phase: 'finalizing' },
      },
    });
    await waitFor(() => runtime.textContent?.includes('Finalizing') === true);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBe(progressIndicator);
    expect(progressIndicator?.querySelector('.flower-model-status-flower')).toBe(progressFlower);
    expect(progressIndicator?.querySelector('.flower-model-status-dots')).toBe(progressDots);

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: {
        ...assistantCurrent(10, 'Weather data is ready').current,
        view_version: 10,
        activity: 'idle',
        run_progress: null,
        last_outcome: 'completed',
      },
    });
    await waitFor(() => runtime.querySelector('.flower-model-status-indicator') === null);

    expect(stopThread).toHaveBeenCalledTimes(1);
    expect(connectLiveStream).toHaveBeenCalledTimes(1);
    expect(loadThread).toHaveBeenCalledTimes(1);
  });

  it('shows list loading state until an authoritative empty response arrives', async () => {
    const listResponse = deferred<ReturnType<typeof thread>[]>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(() => listResponse.promise),
    });

    await waitFor(() => runtime.querySelector('.flower-thread-warmup-list') !== null);
    expect(runtime.querySelector('.flower-thread-empty')).toBeNull();

    listResponse.resolve([]);
    await waitFor(() => runtime.querySelector('.flower-thread-empty') !== null);
    expect(runtime.querySelector('.flower-thread-warmup-list')).toBeNull();
  });

  it('atomically replaces a new-thread outbox row when live current wins the launch race', async () => {
    const stream = controlledWorkspaceStream([{ schema_version: 1, kind: 'ready', summaries: [] }]);
    const launchResponse = deferred<FlowerTurnLaunchReceipt>();
    const launchTurn = vi.fn((_input: FlowerTurnLaunchInput) => launchResponse.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      loadSettings: vi.fn(async () => ({
        ...settingsSnapshot(true),
        defaults: { permission_type: 'full_access' as const },
      })),
      listThreads: vi.fn(async () => []),
      launchTurn,
      connectLiveStream: stream.connect,
    });

    await waitFor(() => runtime.querySelector('.flower-permission-trigger')
      ?.getAttribute('data-permission-type') === 'full_access');
    (runtime.querySelector('.flower-permission-trigger') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector(
      '[data-permission-type="approval_required"].flower-permission-menu-item',
    ) !== null);
    (runtime.querySelector(
      '[data-permission-type="approval_required"].flower-permission-menu-item',
    ) as HTMLButtonElement).click();
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'hi';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const submit = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(submit && !submit.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => launchTurn.mock.calls.length === 1);
    const requestID = launchTurn.mock.calls[0]![0].client_request_id;
    await waitFor(() => runtime.querySelector(`[data-flower-transport-outbox-id="${requestID}"]`) !== null);
    const receipt = launchReceipt('thread-new-race', 'turn-new-race', 'start', requestID);
    const current = {
      ...receipt.current,
      items: [{
        id: `user:${requestID}`,
        turn_id: 'turn-new-race',
        run_id: 'run-fixture',
        ordinal: 1,
        kind: 'user' as const,
        text: 'hi',
      }],
    };
    let minVisibleUserRows = Number.POSITIVE_INFINITY;
    let maxVisibleUserRows = 0;
    let emptyStateObservedAfterSend = false;
    const observeVisibleRows = () => {
      const visibleUserRows = runtime.querySelectorAll(
        '[data-flower-message-role="user"], [data-flower-transport-outbox-id]',
      ).length;
      minVisibleUserRows = Math.min(minVisibleUserRows, visibleUserRows);
      maxVisibleUserRows = Math.max(maxVisibleUserRows, visibleUserRows);
      emptyStateObservedAfterSend ||= runtime.querySelector('.flower-empty-state') !== null;
    };
    const observer = new MutationObserver(observeVisibleRows);
    observer.observe(runtime, { childList: true, subtree: true });
    observeVisibleRows();

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: receipt.thread_id,
      current,
    });
    await waitFor(() => runtime.querySelector(`[data-flower-transport-outbox-id="${requestID}"]`) === null);
    observeVisibleRows();
    expect(runtime.querySelector(`[data-flower-message-id="user:${requestID}"]`)).not.toBeNull();
    expect(runtime.querySelector('.flower-permission-trigger')?.getAttribute('data-permission-type'))
      .toBe('approval_required');
    expect(runtime.querySelector('.flower-empty-state')).toBeNull();
    launchResponse.resolve({ ...receipt, current });

    await waitFor(() => runtime.querySelector(`[data-flower-message-id="user:${requestID}"]`) !== null);
    await Promise.resolve();
    observeVisibleRows();
    observer.disconnect();
    expect(launchTurn).toHaveBeenCalledTimes(1);
    expect(runtime.querySelectorAll(`[data-flower-message-id="user:${requestID}"]`)).toHaveLength(1);
    expect(runtime.querySelector(`[data-flower-transport-outbox-id="${requestID}"]`)).toBeNull();
    expect(minVisibleUserRows).toBe(1);
    expect(maxVisibleUserRows).toBe(1);
    expect(emptyStateObservedAfterSend).toBe(false);
  });

  it('keeps a newer New Chat draft selected when an earlier admission arrives late', async () => {
    const stream = controlledWorkspaceStream([{ schema_version: 1, kind: 'ready', summaries: [] }]);
    const launchResponse = deferred<FlowerTurnLaunchReceipt>();
    const launchTurn = vi.fn((_input: FlowerTurnLaunchInput) => launchResponse.promise);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      launchTurn,
      connectLiveStream: stream.connect,
    });

    await waitFor(() => Boolean(runtime.querySelector('textarea')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'first request';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => {
      const submit = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement | null;
      return Boolean(submit && !submit.disabled);
    });
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();

    await waitFor(() => launchTurn.mock.calls.length === 1);
    const requestID = launchTurn.mock.calls[0]![0].client_request_id;
    await waitFor(() => runtime.querySelector(`[data-flower-transport-outbox-id="${requestID}"]`) !== null);
    (runtime.querySelector('.flower-new-chat-button') as HTMLButtonElement).click();
    textarea.value = 'second draft';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));

    const receipt = launchReceipt('thread-late-admission', 'turn-late-admission', 'start', requestID);
    const current = {
      ...receipt.current,
      items: [{
        id: `user:${requestID}`,
        turn_id: 'turn-late-admission',
        run_id: 'run-fixture',
        ordinal: 1,
        kind: 'user' as const,
        text: 'first request',
      }],
    };
    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: receipt.thread_id,
      current,
    });
    await waitFor(() => runtime.querySelector(`[data-flower-transport-outbox-id="${requestID}"]`) === null);
    launchResponse.resolve({ ...receipt, current });
    await waitFor(() => (runtime.querySelector('textarea') as HTMLTextAreaElement | null)?.value === 'second draft');

    expect(runtime.querySelector('[data-flower-thread-active="true"]')).toBeNull();
    expect(runtime.querySelector(`[data-flower-message-id="user:${requestID}"]`)).toBeNull();
    expect(runtime.querySelector('.flower-empty-state')).not.toBeNull();
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('second draft');
  });

  it('renders the complete six-item terminal fixture on first detail load', async () => {
    const completed = completedTerminalThread();
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [completed]),
      loadThread: vi.fn(async () => liveBootstrap(completed, 796)),
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${completed.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${completed.thread_id}"] button`) as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelectorAll('[data-flower-message-id]').length === 6);
    expect(runtime.textContent).toContain('Redeven 是一个本地开发环境产品。');
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
  });

  it('expands typed OKF rows and keeps a successful Skill activity static', async () => {
    const threadID = 'thread-structured-activity-rows';
    const activityThread = thread({
      thread_id: threadID,
      title: 'Structured activity rows',
      status: 'success',
      messages: [{
        id: 'structured-activity-message',
        turn_id: 'structured-activity-turn',
        role: 'assistant',
        content: '',
        status: 'complete',
        created_at_ms: 10,
        blocks: [activityTimeline({
          thread_id: threadID,
          run_id: 'structured-activity-turn',
          turn_id: 'structured-activity-turn',
          items: [
            activityItem({
              item_id: 'okf-search',
              tool_id: 'okf-search',
              tool_name: 'okf.search',
              renderer: 'structured',
              label: 'OKF search results',
              payload: {
                operation: 'okf.search',
                rows: [{
                  title: 'Flower runtime',
                  meta: 'Architecture · Summary',
                  content: 'The current-view boundary.',
                  format: 'text',
                }],
              },
            }),
            activityItem({
              item_id: 'skill-success',
              tool_id: 'skill-success',
              tool_name: 'use_skill',
              renderer: 'structured',
              label: 'redeven-environment',
              payload: { operation: 'use_skill', status: 'success' },
            }),
          ],
        })],
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [activityThread]),
      loadThread: vi.fn(async () => liveBootstrap(activityThread, 10)),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${threadID}"] button`)));
    (runtime.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-activity-item-id]').length === 2);

    const okfRow = runtime.querySelector('[data-flower-activity-item-id="okf-search"]') as HTMLElement;
    const skillRow = runtime.querySelector('[data-flower-activity-item-id="skill-success"]') as HTMLElement;
    const okfToggle = okfRow.querySelector('.flower-activity-inline-button') as HTMLElement;
    const skillStatic = skillRow.querySelector('.flower-activity-inline-button') as HTMLElement;
    expect(okfToggle.tagName).toBe('BUTTON');
    expect(okfToggle.getAttribute('aria-expanded')).toBe('false');
    expect(skillStatic.tagName).toBe('DIV');
    expect(skillRow.querySelector('button.flower-activity-inline-button')).toBeNull();
    expect(skillRow.querySelector('.flower-activity-inline-chevron')).toBeNull();

    (okfToggle as HTMLButtonElement).click();
    await waitFor(() => okfRow.textContent?.includes('The current-view boundary.') === true);
    expect(okfRow.textContent).toContain('Flower runtime');
    expect(okfToggle.getAttribute('aria-expanded')).toBe('true');
  });

  it('expands Todo activity into the full list and current progress', async () => {
    const threadID = 'thread-todo-activity-disclosure';
    const activityThread = thread({
      thread_id: threadID,
      title: 'Todo activity disclosure',
      status: 'success',
      messages: [{
        id: 'todo-activity-message',
        turn_id: 'todo-activity-turn',
        role: 'assistant',
        content: '',
        status: 'complete',
        created_at_ms: 10,
        blocks: [activityTimeline({
          thread_id: threadID,
          run_id: 'todo-activity-turn',
          turn_id: 'todo-activity-turn',
          items: [activityItem({
            item_id: 'todo-update',
            tool_id: 'todo-update',
            tool_name: 'write_todos',
            renderer: 'todos',
            label: 'Update todos',
            payload: {
              operation: 'write',
              items: [
                { text: 'Locate the payload loss', status: 'completed' },
                { text: 'Verify current work', status: 'in_progress' },
              ],
            },
          })],
        })],
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [activityThread]),
      loadThread: vi.fn(async () => liveBootstrap(activityThread, 10)),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${threadID}"] button`)));
    (runtime.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="todo-update"]')));

    const todoRow = runtime.querySelector('[data-flower-activity-item-id="todo-update"]') as HTMLElement;
    const toggle = todoRow.querySelector('button.flower-activity-inline-button') as HTMLButtonElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(todoRow.textContent).toContain('1/2 completed');
    expect(todoRow.querySelector('.flower-activity-inline-chevron')).toBeTruthy();

    toggle.click();
    await waitFor(() => todoRow.querySelectorAll('.flower-activity-todo-item').length === 2);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(todoRow.querySelector('[data-status="completed"]')?.textContent).toContain('Locate the payload loss');
    expect(todoRow.querySelector('[data-status="in_progress"]')?.textContent).toContain('Verify current work');
  });

  it('uses one Web Fetch indicator and animates only the running title', async () => {
    const threadID = 'thread-web-fetch-searching-orb';
    const turnID = 'turn-web-fetch-searching-orb';
    const webFetchThread = thread({
      thread_id: threadID,
      title: 'Web Fetch indicator',
      status: 'running',
      active_run_id: turnID,
      messages: [{
        id: 'web-fetch-activity-message',
        turn_id: turnID,
        role: 'assistant',
        content: '',
        status: 'complete',
        created_at_ms: 10,
        blocks: [activityTimeline({
          thread_id: threadID,
          run_id: turnID,
          turn_id: turnID,
          status: 'running',
          items: [
            activityItem({
              item_id: 'web-fetch-running',
              tool_id: 'web-fetch-running',
              tool_name: 'web_fetch',
              renderer: 'web_fetch',
              status: 'running',
              label: 'Web fetch · https://example.test/a/very/long/path/that/must/remain/truncated/while-the-title-sweep-is-running',
              payload: { url: 'https://example.test/a/very/long/path/that/must/remain/truncated/while-the-title-sweep-is-running' },
            }),
            activityItem({
              item_id: 'web-fetch-complete',
              tool_id: 'web-fetch-complete',
              tool_name: 'web_fetch',
              renderer: 'web_fetch',
              status: 'success',
              label: 'Web fetch · https://example.test/complete',
              payload: { url: 'https://example.test/complete' },
            }),
            activityItem({
              item_id: 'web-fetch-error',
              tool_id: 'web-fetch-error',
              tool_name: 'web_fetch',
              renderer: 'web_fetch',
              status: 'error',
              label: 'Web fetch · https://example.test/error',
              payload: { url: 'https://example.test/error' },
            }),
          ],
        })],
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [webFetchThread]),
      loadThread: vi.fn(async () => liveBootstrap(webFetchThread, 10)),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${threadID}"] button`)));
    (runtime.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-activity-web-fetch-searching-orb').length === 2);

    const runningRow = runtime.querySelector('[data-flower-activity-item-id="web-fetch-running"]') as HTMLElement;
    const completeRow = runtime.querySelector('[data-flower-activity-item-id="web-fetch-complete"]') as HTMLElement;
    const errorRow = runtime.querySelector('[data-flower-activity-item-id="web-fetch-error"]') as HTMLElement;
    const runningOrb = runningRow.querySelector('.flower-activity-web-fetch-searching-orb') as HTMLCanvasElement;
    const completeOrb = completeRow.querySelector('.flower-activity-web-fetch-searching-orb') as HTMLCanvasElement;
    const runningTitle = runningRow.querySelector('.flower-activity-inline-title') as HTMLElement;
    const runningTarget = runningTitle.querySelector('.flower-activity-inline-title-target') as HTMLElement;
    const completeTitle = completeRow.querySelector('.flower-activity-inline-title') as HTMLElement;
    const errorTitle = errorRow.querySelector('.flower-activity-inline-title') as HTMLElement;

    expect(runningRow.querySelectorAll('.flower-activity-inline-icon > *')).toHaveLength(1);
    expect(completeRow.querySelectorAll('.flower-activity-inline-icon > *')).toHaveLength(1);
    expect(errorRow.querySelectorAll('.flower-activity-inline-icon > *')).toHaveLength(1);
    expect(runningRow.querySelector('.flower-activity-inline-title svg')).toBeNull();
    expect(completeRow.querySelector('.flower-activity-inline-title svg')).toBeNull();
    expect(errorRow.querySelector('.flower-activity-web-fetch-searching-orb')).toBeNull();
    expect(errorRow.dataset.flowerActivityStatus).toBe('error');
    expect(runningOrb.dataset.running).toBe('true');
    expect(completeOrb.dataset.running).toBe('false');
    expect(runningOrb.width).toBeGreaterThanOrEqual(20);
    expect(completeOrb.width).toBeGreaterThanOrEqual(20);
    expect(window.getComputedStyle(runningTitle, '::after').animationName).toBe('flower-activity-title-sweep');
    expect(window.getComputedStyle(runningTitle, '::after').pointerEvents).toBe('none');
    expect(window.getComputedStyle(completeTitle, '::after').animationName).toBe('none');
    expect(window.getComputedStyle(errorTitle, '::after').animationName).toBe('none');
    expect(window.getComputedStyle(runningTarget).textOverflow).toBe('ellipsis');
    expect(runningTarget.title).toBe('https://example.test/a/very/long/path/that/must/remain/truncated/while-the-title-sweep-is-running');
  });

  it('uses semantic terminal titles and keeps safe empty terminal disclosures', async () => {
    const threadID = 'thread-terminal-semantic-presentation';
    const terminalThread = thread({
      thread_id: threadID,
      title: 'Terminal presentation',
      status: 'success',
      messages: [{
        id: 'terminal-activity-message',
        turn_id: 'terminal-activity-turn',
        role: 'assistant',
        content: '',
        status: 'complete',
        created_at_ms: 10,
        blocks: [activityTimeline({
          thread_id: threadID,
          run_id: 'terminal-activity-turn',
          turn_id: 'terminal-activity-turn',
          items: [
            activityItem({
              item_id: 'terminal-exec-semantic',
              tool_id: 'terminal-exec-semantic',
              tool_name: 'terminal.exec',
              renderer: 'structured',
              label: 'terminal.exec',
              description: 'Fetch official specifications',
              payload: { command: 'curl -s https://example.test/specifications' },
            }),
            activityItem({
              item_id: 'terminal-terminate-semantic',
              tool_id: 'terminal-terminate-semantic',
              tool_name: 'terminal.terminate',
              renderer: 'structured',
              label: 'terminal.terminate',
              description: 'Stop the stalled request',
              payload: {},
            }),
          ],
        })],
      }],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [terminalThread]),
      loadThread: vi.fn(async () => liveBootstrap(terminalThread, 10)),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${threadID}"] button`)));
    (runtime.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-activity-item-id]').length === 2);

    const execRow = runtime.querySelector('[data-flower-activity-item-id="terminal-exec-semantic"]') as HTMLElement;
    const terminateRow = runtime.querySelector('[data-flower-activity-item-id="terminal-terminate-semantic"]') as HTMLElement;
    expect(execRow.textContent).toContain('Fetch official specifications');
    expect(terminateRow.textContent).toContain('Stop the stalled request');
    expect(runtime.textContent).not.toContain('terminal.exec');
    expect(runtime.textContent).not.toContain('terminal.terminate');
    expect(execRow.querySelector('button.flower-activity-inline-button')).not.toBeNull();
    const terminateToggle = terminateRow.querySelector<HTMLButtonElement>('button.flower-activity-inline-button')!;
    expect(terminateToggle).not.toBeNull();
    expect(terminateRow.querySelector('.flower-activity-inline-chevron')).not.toBeNull();
    terminateToggle.click();
    await waitFor(() => terminateToggle.getAttribute('aria-expanded') === 'true');
    expect(terminateRow.querySelector('.flower-activity-terminal-facts')).not.toBeNull();
  });

  it('keeps waiting-user navigation interactive and applies background state without pointer activity', async () => {
    const waiting = thread({
      thread_id: 'thread-a', title: 'Waiting A', status: 'waiting_user', active_run_id: 'turn-a',
      input_request: inputRequest({ prompt_id: 'prompt-a' }),
    });
    const idle = thread({ thread_id: 'thread-b', title: 'Thread B', status: 'idle' });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [waiting, idle],
    }]);
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [waiting, idle]),
      loadThread: vi.fn(async (threadID: string) => liveBootstrap(threadID === 'thread-a' ? waiting : idle, 1)),
      connectLiveStream: stream.connect,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-a"]')));
    const cardA = runtime.querySelector('[data-thread-id="thread-a"]') as HTMLElement;
    const cardB = runtime.querySelector('[data-thread-id="thread-b"]') as HTMLElement;
    expect(cardA.closest('[inert]')).toBeNull();
    expect(getComputedStyle(cardB).pointerEvents).not.toBe('none');

    const selectB = cardB.querySelector('button') as HTMLButtonElement;
    selectB.scrollIntoView({ block: 'center', inline: 'nearest' });
    const rect = selectB.getBoundingClientRect();
    const target = document.elementFromPoint(rect.left + Math.max(1, rect.width / 2), rect.top + Math.max(1, rect.height / 2));
    expect(target?.closest('[data-thread-id]')).toBe(cardB);
    (target as HTMLElement).click();
    await waitFor(() => cardB.getAttribute('data-flower-thread-active') === 'true');

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: 'thread-a',
      current: {
        ...runtimeCurrentView(thread({ ...waiting, status: 'running', input_request: undefined }), 2),
        interactions: [{
          id: 'approval-a',
          turn_id: 'turn-fixture',
          run_id: 'run-fixture',
          kind: 'approval',
          tool_call_id: 'tool-a',
          resolved: false,
          approval: {
            label: 'Run deployment',
            tool_name: 'terminal.exec',
            tool_call_id: 'tool-a',
          },
        }],
      },
    });
    await waitFor(() => cardA.getAttribute('data-flower-thread-status') === 'waiting_approval');
    expect(cardB.getAttribute('data-flower-thread-active')).toBe('true');
    expect(runtime.querySelector('.flower-composer-mark-row')).toBeNull();
  });

  it('recovers a waiting approval when only the selected summary arrives', async () => {
    const running = thread({
      thread_id: 'thread-summary-approval',
      title: 'Summary approval',
      status: 'running',
      active_run_id: 'turn-a',
    });
    const approvalAction = {
      action_id: 'approval-summary',
      origin: 'main_tool' as const,
      run_id: 'turn-a',
      tool_id: 'tool-a',
      tool_name: 'terminal.exec',
      state: 'requested' as const,
      status: 'pending' as const,
      requested_at_ms: 4,
      can_approve: true,
      queue_order: 1,
      summary: { label: 'Run command' },
    };
    const waiting = thread({
      ...running,
      status: 'waiting_approval',
      approval_pending: true,
      approval_pending_count: 1,
      approval_actions: [approvalAction],
      updated_at_ms: 4,
    });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [running],
    }]);
    let latest = running;
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [latest]),
      loadThread: vi.fn(async () => liveBootstrap(latest, latest === waiting ? 4 : 1)),
      connectLiveStream: stream.connect,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-summary-approval"]')));
    (runtime.querySelector('[data-thread-id="thread-summary-approval"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-thread-status="running"]') !== null);

    latest = waiting;
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [waiting] });

    await waitFor(() => runtime.querySelector('[data-flower-bottom-mode="approval"]') !== null);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    expect(surfaceAdapter.loadThread.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('refreshes detail for a newer settings revision without inventing activity', async () => {
    const initial = thread({
      thread_id: 'thread-settings-revision',
      title: 'Settings revision',
      status: 'success',
      permission_type: 'approval_required',
      settings_revision: 1,
      updated_at_ms: 10,
      read_status: readStatus(false, 10, 'success'),
    });
    const updated = thread({
      ...initial,
      permission_type: 'full_access',
      settings_revision: 2,
      // Settings changes must not advance the activity revision.
      updated_at_ms: initial.updated_at_ms,
      read_status: readStatus(false, initial.updated_at_ms, 'success'),
    });
    const stream = controlledWorkspaceStream([{
      schema_version: 1,
      kind: 'ready',
      summaries: [initial],
    }]);
    let latest = initial;
    const loadThread = vi.fn(async () => liveBootstrap(latest, 1));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [latest]),
      loadThread,
      connectLiveStream: stream.connect,
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${initial.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${initial.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-permission-trigger')?.getAttribute('data-permission-type') === 'approval_required');

    latest = updated;
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [updated] });
    await waitFor(() => loadThread.mock.calls.length === 2);
    await waitFor(() => runtime.querySelector('.flower-permission-trigger')?.getAttribute('data-permission-type') === 'full_access');

    expect(runtime.querySelector('.flower-thread-sync-error')).toBeNull();
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
  });

  it.each(['resolve', 'reject'] as const)('coalesces settings-only updates while a detail request must %s', async (settlement) => {
    const initial = thread({
      thread_id: 'thread-concurrent-settings', title: 'Concurrent settings', status: 'success',
      settings_revision: 1, permission_type: 'approval_required', updated_at_ms: 10,
      read_status: readStatus(false, 10, 'success'),
    });
    const intermediate = thread({ ...initial, settings_revision: 2, permission_type: 'readonly' });
    const latest = thread({ ...initial, settings_revision: 3, permission_type: 'full_access' });
    const pending = deferred<ReturnType<typeof liveBootstrap>>();
    const stream = controlledWorkspaceStream([{ schema_version: 1, kind: 'ready', summaries: [initial] }]);
    const loadThread = vi.fn()
      .mockResolvedValueOnce(liveBootstrap(initial, 5))
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValue(liveBootstrap(latest, 5));
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [initial]), loadThread, connectLiveStream: stream.connect });
    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${initial.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${initial.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-permission-trigger')?.getAttribute('data-permission-type') === 'approval_required');
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [intermediate] });
    await waitFor(() => loadThread.mock.calls.length === 2);
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [latest] });
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [intermediate] });
    await wait(80);
    expect(loadThread).toHaveBeenCalledTimes(2);
    expect(runtime.querySelector('.flower-permission-trigger')?.getAttribute('data-permission-type')).toBe('approval_required');
    if (settlement === 'resolve') pending.resolve(liveBootstrap(intermediate, 5));
    else pending.reject(new Error('Request failed'));
    await waitFor(() => runtime.querySelector('.flower-permission-trigger')?.getAttribute('data-permission-type') === 'full_access');
    expect(loadThread).toHaveBeenCalledTimes(3);
    expect(runtime.querySelector('.flower-thread-sync-error')).toBeNull();
    // A duplicate summary, stale reconnect inventory, and old current cannot undo accepted settings.
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [latest] });
    stream.push({ schema_version: 1, kind: 'ready', summaries: [intermediate] });
    stream.push({ schema_version: 1, kind: 'thread.batch', thread_id: initial.thread_id, current: runtimeCurrentView(initial, 4) });
    await wait(80);
    expect(runtime.querySelector('.flower-permission-trigger')?.getAttribute('data-permission-type')).toBe('full_access');
    expect(runtime.querySelector('.flower-thread-sync-error')).toBeNull();
    expect(loadThread).toHaveBeenCalledTimes(3);
  });

  it('retries after a settings revision advances beyond a failed request', async () => {
    const initial = thread({ thread_id: 'thread-failed-settings', title: 'Failed settings', settings_revision: 1, updated_at_ms: 10, read_status: readStatus(false, 10, 'idle') });
    const intermediate = thread({ ...initial, settings_revision: 2, permission_type: 'readonly' });
    const latest = thread({ ...initial, settings_revision: 3, permission_type: 'full_access' });
    const stream = controlledWorkspaceStream([{ schema_version: 1, kind: 'ready', summaries: [initial] }]);
    const loadThread = vi.fn()
      .mockResolvedValueOnce(liveBootstrap(initial, 5))
      .mockRejectedValueOnce(new Error('Request failed'))
      .mockResolvedValue(liveBootstrap(latest, 5));
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: vi.fn(async () => [initial]), loadThread, connectLiveStream: stream.connect });
    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${initial.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${initial.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-permission-trigger')));
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [intermediate] });
    await waitFor(() => Boolean(runtime.querySelector('.flower-thread-sync-error')));
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [intermediate] });
    await wait(80);
    expect(loadThread).toHaveBeenCalledTimes(2);
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [latest] });
    await waitFor(() => runtime.querySelector('.flower-permission-trigger')?.getAttribute('data-permission-type') === 'full_access');
    expect(runtime.querySelector('.flower-thread-sync-error')).toBeNull();
    expect(loadThread).toHaveBeenCalledTimes(3);
  });

  it.each([true, false])('requires an unresolved interaction when active progress is absent (complete=%s)', async (complete) => {
    const threadID = 'thread-approval-progress-gap';
    const turnID = 'turn-approval-progress-gap';
    const runID = 'run-approval-progress-gap';
    const running = thread({
      thread_id: threadID,
      title: 'Approval progress gap',
      status: 'running',
      active_run_id: runID,
      run_progress: { phase: 'preparing', run_id: runID, turn_id: turnID },
      messages: [{
        id: 'approval-gap-user',
        turn_id: turnID,
        run_id: runID,
        role: 'user',
        content: 'Run the deployment',
        status: 'complete',
        created_at_ms: 1,
      }],
    });
    const waiting = thread({
      ...running,
      status: 'waiting_approval',
      run_progress: null,
      updated_at_ms: 4,
      approval_pending: true,
      approval_pending_count: 1,
      approval_actions: [{
        action_id: 'approval-gap-action',
        origin: 'main_tool',
        run_id: runID,
        tool_id: 'approval-gap-tool',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        requested_at_ms: 4,
        can_approve: true,
        queue_order: 1,
        summary: { label: 'Run deployment' },
      }],
    });
    const stream = controlledWorkspaceStream([{ schema_version: 1, kind: 'ready', summaries: [running] }]);
    const loadThread = vi.fn(async () => liveBootstrap(running, 1));
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [running]),
      loadThread,
      connectLiveStream: stream.connect,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${threadID}"] button`)));
    (runtime.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-thread-status="running"]') !== null);

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: threadID,
      current: complete ? {
        ...runtimeCurrentView(waiting, 2),
        interactions: [{
          id: 'approval-gap-action', kind: 'approval', turn_id: turnID, run_id: runID,
          tool_call_id: 'approval-gap-tool', resolved: false,
          approval: { label: 'Run deployment', tool_name: 'terminal.exec', tool_call_id: 'approval-gap-tool' },
        }],
      } : {
        thread_id: threadID,
        view_version: 2,
        activity: 'active',
        run_id: runID,
        turn_id: turnID,
        items: [],
      },
    });

    if (complete) {
      await waitFor(() => runtime.querySelector('[data-flower-bottom-mode="approval"]') !== null);
      expect(runtime.querySelector('.flower-thread-sync-error')).toBeNull();
      expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();

      stream.push({
        schema_version: 1, kind: 'thread.batch', thread_id: threadID,
        current: runtimeCurrentView(running, 3),
      });
      await waitFor(() => runtime.querySelector('.flower-model-status-indicator') !== null);
      expect(runtime.querySelector('[data-flower-bottom-mode="approval"]')).toBeNull();
      expect(runtime.querySelector('.flower-thread-sync-error')).toBeNull();
    } else {
      await waitFor(() => runtime.querySelector('.flower-thread-sync-error') !== null);
      expect(runtime.querySelector('[data-flower-bottom-mode="approval"]')).toBeNull();
      expect(runtime.textContent).toContain('Run the deployment');
      expect(loadThread).toHaveBeenCalledTimes(1);
      stream.push({
        schema_version: 1, kind: 'thread.batch', thread_id: threadID,
        current: runtimeCurrentView(running, 3),
      });
      await waitFor(() => runtime.querySelector('.flower-thread-sync-error') === null);
      expect(runtime.querySelector('.flower-model-status-indicator')).not.toBeNull();
    }
    expect(loadThread).toHaveBeenCalledTimes(1);
  });

  it('waits for a higher revision after a terminal detail request fails', async () => {
    const completed = completedTerminalThread();
    const advanced = thread({
      ...completed,
      updated_at_ms: 797,
      read_status: readStatus(false, 797, 'success'),
    });
    const running = thread({
      ...completed,
      status: 'running',
      active_run_id: 'turn-terminal',
      updated_at_ms: 795,
      read_status: readStatus(false, 795, 'running'),
      run_progress: { phase: 'streaming', run_id: 'turn-terminal', turn_id: 'turn-terminal' },
      messages: completed.messages.slice(0, 1),
    });
    const stream = controlledWorkspaceStream([{ schema_version: 1, kind: 'ready', summaries: [running] }]);
    const recoveredRequest = deferred<ReturnType<typeof liveBootstrap>>();
    let loadCount = 0;
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [running]),
      loadThread: vi.fn(async () => {
        loadCount += 1;
        if (loadCount === 1) return liveBootstrap(running, 795);
        if (loadCount === 2) throw new TypeError("Cannot read properties of null (reading 'length')");
        return recoveredRequest.promise;
      }),
      connectLiveStream: stream.connect,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${completed.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${completed.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-model-status-indicator') !== null);

    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [completed] });

    await waitFor(() => runtime.textContent?.includes('Flower could not sync the latest reply. Try again.') ?? false);
    expect(surfaceAdapter.loadThread).toHaveBeenCalledTimes(2);

    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [completed] });
    await wait(120);
    expect(surfaceAdapter.loadThread).toHaveBeenCalledTimes(2);

    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [advanced] });
    await waitFor(() => surfaceAdapter.loadThread.mock.calls.length === 3);
    recoveredRequest.resolve(liveBootstrap(advanced, 797));
    await waitFor(() => runtime.querySelectorAll('[data-flower-message-id]').length === 6, 2_000);
    expect(runtime.textContent).toContain('Redeven 是一个本地开发环境产品。');
    expect(runtime.textContent).not.toContain("Cannot read properties of null");
    expect(surfaceAdapter.loadThread).toHaveBeenCalledTimes(3);
  });

  it('converges newer activity metadata when terminal runtime content is unchanged', async () => {
    const completed = thread({
      thread_id: 'thread-activity-metadata-convergence',
      title: 'Activity metadata convergence',
      status: 'success',
      active_run_id: undefined,
      updated_at_ms: 796,
      read_status: readStatus(false, 796, 'success'),
      messages: [
        { id: 'metadata-user', turn_id: 'turn-metadata', role: 'user', content: 'hi', status: 'complete', created_at_ms: 790 },
        { id: 'metadata-answer', turn_id: 'turn-metadata', role: 'assistant', content: 'Hello from Flower.', status: 'complete', created_at_ms: 796 },
      ],
    });
    const running = thread({
      ...completed,
      status: 'running',
      active_run_id: 'turn-terminal',
      updated_at_ms: 795,
      read_status: readStatus(false, 795, 'running'),
      run_progress: { phase: 'streaming', run_id: 'turn-terminal', turn_id: 'turn-terminal' },
      messages: completed.messages.slice(0, 1),
    });
    const stream = controlledWorkspaceStream([{ schema_version: 1, kind: 'ready', summaries: [running] }]);
    let loadCount = 0;
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [running]),
      loadThread: vi.fn(async () => {
        loadCount += 1;
        return loadCount === 1
          ? liveBootstrap(running, 80)
          : liveBootstrap(completed, 81);
      }),
      connectLiveStream: stream.connect,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${completed.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${completed.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-model-status-indicator') !== null);

    stream.push({
      schema_version: 1,
      kind: 'thread.batch',
      thread_id: completed.thread_id,
      current: runtimeCurrentView(completed, 81),
    });
    await waitFor(() => runtime.textContent?.includes('Hello from Flower.') ?? false);
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [completed] });

    await waitFor(() => surfaceAdapter.loadThread.mock.calls.length === 2);
    await waitFor(() => runtime.querySelector(`[data-thread-id="${completed.thread_id}"]`)?.getAttribute('data-flower-thread-status') === 'success');
    expect(runtime.querySelector('.flower-error-card')).toBeNull();
    expect(runtime.querySelector('.flower-composer-stop')).toBeNull();
    expect(runtime.textContent).toContain('Hello from Flower.');
    expect(surfaceAdapter.loadThread).toHaveBeenCalledTimes(2);
  });

  it('does not let a pre-completion detail request replace terminal recovery', async () => {
    const completed = completedTerminalThread();
    const running = thread({
      ...completed,
      status: 'running',
      active_run_id: 'turn-terminal',
      updated_at_ms: 795,
      read_status: readStatus(false, 795, 'running'),
      run_progress: { phase: 'streaming', run_id: 'turn-terminal', turn_id: 'turn-terminal' },
      messages: completed.messages.slice(0, 1),
    });
    const staleRequest = deferred<ReturnType<typeof liveBootstrap>>();
    const stream = controlledWorkspaceStream([{ schema_version: 1, kind: 'ready', summaries: [running] }]);
    let loadCount = 0;
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [running]),
      loadThread: vi.fn(() => {
        loadCount += 1;
        return loadCount === 1 ? staleRequest.promise : Promise.resolve(liveBootstrap(completed, 796));
      }),
      connectLiveStream: stream.connect,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${completed.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${completed.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => surfaceAdapter.loadThread.mock.calls.length === 1);
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [completed] });

    await wait(120);
    expect(surfaceAdapter.loadThread).toHaveBeenCalledTimes(1);
    staleRequest.resolve(liveBootstrap(running, 795));
    await waitFor(() => surfaceAdapter.loadThread.mock.calls.length === 2);
    await waitFor(() => runtime.querySelectorAll('[data-flower-message-id]').length === 6);
    await waitFor(() => runtime.textContent?.includes('Redeven 是一个本地开发环境产品。') ?? false);
    expect(runtime.querySelectorAll('[data-flower-message-id]')).toHaveLength(6);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
  });

  it('keeps a detail sync error actionable above the composer until retry succeeds', async () => {
    const completed = completedTerminalThread();
    const running = thread({
      ...completed,
      status: 'running',
      active_run_id: 'turn-terminal',
      updated_at_ms: 795,
      read_status: readStatus(false, 795, 'running'),
      run_progress: { phase: 'streaming', run_id: 'turn-terminal', turn_id: 'turn-terminal' },
      messages: completed.messages.slice(0, 1),
    });
    const stream = controlledWorkspaceStream([{ schema_version: 1, kind: 'ready', summaries: [running] }]);
    const recoveryRequest = deferred<ReturnType<typeof liveBootstrap>>();
    const launchTurn = vi.fn(async (input: FlowerTurnLaunchInput) => launchReceipt(
      input.thread_id ?? running.thread_id,
      'turn-unexpected',
    ));
    let loadCount = 0;
    let failedRecoveryCount = 0;
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [running]),
      loadThread: vi.fn(async () => {
        loadCount += 1;
        if (loadCount === 1) return liveBootstrap(running, 795);
        if (loadCount >= 3) return recoveryRequest.promise;
        failedRecoveryCount += 1;
        throw new TypeError("Cannot read properties of null (reading 'length')");
      }),
      launchTurn,
      connectLiveStream: stream.connect,
    };
    const runtime = renderSurfaceWithAdapter(surfaceAdapter);

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${completed.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${completed.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-model-status-indicator') !== null);
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [completed] });

    await waitFor(() => runtime.textContent?.includes('Flower could not sync the latest reply. Try again.') ?? false, 2_500);
    expect(runtime.querySelectorAll('[data-flower-message-id]')).toHaveLength(1);
    expect(runtime.textContent).not.toContain("Cannot read properties of null");
    expect(failedRecoveryCount).toBe(1);
    const transcript = runtime.querySelector('.flower-chat-transcript') as HTMLDivElement;
    Object.defineProperties(transcript, {
      clientHeight: { configurable: true, value: 400 },
      scrollHeight: { configurable: true, value: 1_600 },
      scrollTop: { configurable: true, writable: true, value: 1_200 },
    });
    transcript.dispatchEvent(new Event('scroll'));
    expect(runtime.querySelector('.flower-chat-bottom-dock .flower-error-card')).not.toBeNull();
    expect(runtime.querySelector('.flower-chat-transcript .flower-error-card')).toBeNull();

    const textarea = runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
    textarea.value = 'Keep this draft while Flower resyncs';
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
    await waitFor(() => runtime.querySelector('[data-flower-primary-action="send"]') !== null);
    expect(textarea.disabled).toBe(false);
    expect((runtime.querySelector('[data-flower-primary-action="send"]') as HTMLButtonElement).disabled).toBe(true);
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    textarea.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
    expect(launchTurn).not.toHaveBeenCalled();
    const stop = runtime.querySelector('.flower-composer-stop-inline') as HTMLButtonElement;
    expect(stop).not.toBeNull();
    expect(stop.disabled).toBe(false);
    expect((runtime.querySelector(`[data-thread-id="${running.thread_id}"] button`) as HTMLButtonElement).disabled).toBe(false);

    (runtime.querySelector('.flower-chat-bottom-dock .flower-error-actions button') as HTMLButtonElement).click();
    await waitFor(() => surfaceAdapter.loadThread.mock.calls.length === 3);
    expect(runtime.querySelector('.flower-chat-bottom-dock .flower-error-card')).not.toBeNull();
    expect((runtime.querySelector('[data-flower-primary-action="send"]') as HTMLButtonElement).disabled).toBe(true);

    recoveryRequest.resolve(liveBootstrap(completed, 796));
    await waitFor(() => runtime.querySelectorAll('[data-flower-message-id]').length === 6);
    expect(runtime.textContent).toContain('Redeven 是一个本地开发环境产品。');
    expect(runtime.querySelector('.flower-chat-bottom-dock .flower-error-card')).toBeNull();
    expect((runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement).value).toBe('Keep this draft while Flower resyncs');
  });

  it('presents a failed Floret control contract with retry reply', async () => {
    const failed = thread({
      thread_id: 'thread-control-contract-failed',
      title: 'Control contract failed',
      status: 'failed',
      error: {
        code: 'floret_control_contract_failed',
        message: 'private invalid control payload',
      },
    });
    const retryThread = vi.fn(async () => liveBootstrap(thread({
      ...failed,
      status: 'running',
      error: undefined,
      active_run_id: 'run-retry',
    })));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [failed]),
      loadThread: vi.fn(async () => liveBootstrap(failed)),
      retryThread,
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${failed.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${failed.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-error-card')));

    expect(runtime.querySelector('.flower-error-card')?.textContent).toContain('invalid interaction control signal');
    expect(runtime.querySelector('.flower-error-card')?.textContent).not.toContain('private invalid control payload');
    const retry = runtime.querySelector('.flower-error-actions button') as HTMLButtonElement;
    expect(retry.textContent).toContain('Retry reply');
    retry.click();
    await waitFor(() => retryThread.mock.calls.length === 1);
  });
});
