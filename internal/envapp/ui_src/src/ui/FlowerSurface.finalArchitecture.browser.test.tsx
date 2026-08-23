import { describe, expect, it, vi } from 'vitest';

import type { FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  activityItem,
  activityTimeline,
  adapter,
  deferred,
  inputRequest,
  liveBootstrap,
  modelIOStatus,
  readStatus,
  renderSurfaceWithAdapter,
  runtimeCurrentView,
  thread,
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

  it('uses semantic terminal titles and omits empty terminal disclosures', async () => {
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
    expect(execRow.textContent).toContain('Run command: Fetch official specifications');
    expect(terminateRow.textContent).toContain('Terminate command execution: Stop the stalled request');
    expect(runtime.textContent).not.toContain('terminal.exec');
    expect(runtime.textContent).not.toContain('terminal.terminate');
    expect(execRow.querySelector('button.flower-activity-inline-button')).not.toBeNull();
    expect(terminateRow.querySelector('button.flower-activity-inline-button')).toBeNull();
    expect(terminateRow.querySelector('.flower-activity-inline-chevron')).toBeNull();
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

  it('retries a lost terminal current and converges without a thread switch', async () => {
    const completed = completedTerminalThread();
    const running = thread({
      ...completed,
      status: 'running',
      active_run_id: 'turn-terminal',
      updated_at_ms: 795,
      read_status: readStatus(false, 795, 'running'),
      model_io_status: modelIOStatus({ run_id: 'turn-terminal', updated_at_ms: 795 }),
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

    await waitFor(() => surfaceAdapter.loadThread.mock.calls.length === 3);
    await waitFor(() => runtime.textContent?.includes('Syncing the latest reply...') ?? false);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    recoveredRequest.resolve(liveBootstrap(completed, 796));
    await waitFor(() => runtime.querySelectorAll('[data-flower-message-id]').length === 6, 2_000);
    expect(runtime.textContent).toContain('Redeven 是一个本地开发环境产品。');
    expect(runtime.textContent).not.toContain("Cannot read properties of null");
    expect(surfaceAdapter.loadThread).toHaveBeenCalledTimes(3);
  });

  it('does not let a pre-completion detail request replace terminal recovery', async () => {
    const completed = completedTerminalThread();
    const running = thread({
      ...completed,
      status: 'running',
      active_run_id: 'turn-terminal',
      updated_at_ms: 795,
      read_status: readStatus(false, 795, 'running'),
      model_io_status: modelIOStatus({ run_id: 'turn-terminal', updated_at_ms: 795 }),
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
    stream.push({ schema_version: 1, kind: 'summary.batch', summaries: [completed] });

    await waitFor(() => surfaceAdapter.loadThread.mock.calls.length === 2);
    await waitFor(() => runtime.querySelectorAll('[data-flower-message-id]').length === 6);
    staleRequest.resolve(liveBootstrap(running, 795));
    await waitFor(() => runtime.textContent?.includes('Redeven 是一个本地开发环境产品。') ?? false);
    expect(runtime.querySelectorAll('[data-flower-message-id]')).toHaveLength(6);
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
  });

  it('keeps existing content and offers manual retry after bounded recovery fails', async () => {
    const completed = completedTerminalThread();
    const running = thread({
      ...completed,
      status: 'running',
      active_run_id: 'turn-terminal',
      updated_at_ms: 795,
      read_status: readStatus(false, 795, 'running'),
      model_io_status: modelIOStatus({ run_id: 'turn-terminal', updated_at_ms: 795 }),
      messages: completed.messages.slice(0, 1),
    });
    const stream = controlledWorkspaceStream([{ schema_version: 1, kind: 'ready', summaries: [running] }]);
    let loadCount = 0;
    let failedRecoveryCount = 0;
    let recoveryAvailable = false;
    const surfaceAdapter = {
      ...adapter(true),
      listThreads: vi.fn(async () => [running]),
      loadThread: vi.fn(async () => {
        loadCount += 1;
        if (loadCount === 1) return liveBootstrap(running, 795);
        if (recoveryAvailable) return liveBootstrap(completed, 796);
        failedRecoveryCount += 1;
        throw new TypeError("Cannot read properties of null (reading 'length')");
      }),
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
    expect(failedRecoveryCount).toBe(4);

    recoveryAvailable = true;
    (runtime.querySelector('.flower-error-actions button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-message-id]').length === 6);
    expect(runtime.textContent).toContain('Redeven 是一个本地开发环境产品。');
  });
});
