// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

const writeTextToClipboardMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../flower_ui/src/clipboard', () => ({
  writeTextToClipboard: (...args: unknown[]) => writeTextToClipboardMock(...args),
}));

import type {
  FlowerActivityStatus,
  FlowerLiveEvent,
  FlowerThreadSnapshot,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  activityItem,
  activityTimeline,
  adapter,
  deferred,
  flowerSurfaceNotifications,
  inputRequest,
  liveBootstrap,
  modelIOStatus,
  renderSurfaceWithAdapter,
  subagentDetail,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  writeTextToClipboardMock.mockReset();
});

function expectModelStatusIndicator(root: ParentNode, label = 'Thinking...'): void {
  const indicator = root.querySelector('.flower-model-status-text');
  expect(indicator?.textContent).toBe(label);
  expect(indicator?.getAttribute('data-text')).toBe(label.replace(/\.\.\.$/, ''));
  expect(root.querySelector('.flower-model-status-lane')?.textContent).toContain(label);
}

function selectedThreadID(root: ParentNode): string | null {
  return root.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') ?? null;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function parentThreadWithRunningSubagent(): FlowerThreadSnapshot {
  return thread({
    thread_id: 'thread-parent-subagents',
    title: 'Parent with subagents',
    messages: [
      {
        id: 'm-parent-subagents',
        role: 'assistant',
        content: '',
        status: 'complete',
        created_at_ms: 20,
        blocks: [
          activityTimeline({
            run_id: 'run-subagents',
            turn_id: 'm-parent-subagents',
            items: [activityItem({
              item_id: 'tool-subagents-spawn',
              tool_id: 'tool-subagents-spawn',
              tool_name: 'subagents',
              renderer: 'structured',
              label: 'subagents',
              status: 'running',
              payload: {
                action: 'spawn',
                status: 'ok',
                task_name: 'Review API contract',
                task_description: 'Review the API boundary.',
                agent_type: 'reviewer',
                items: [{
                  task_name: 'Review API contract',
                  task_description: 'Review the API boundary.',
                  agent_type: 'reviewer',
                  status: 'running',
                }],
              },
            })],
            subagent_actions: {
              'tool-subagents-spawn': {
                operation: 'subagents',
                action: 'spawn',
                delegation_runtime: 'floret',
                thread_id: 'thread-child-review',
                subagent_id: 'thread-child-review',
                task_name: 'Review API contract',
                task_description: 'Review the API boundary.',
                agent_type: 'reviewer',
                status: 'running',
                updated_at_ms: 120,
              },
            },
          }),
        ],
      },
    ],
  });
}

describe('FlowerSurface navigation activity', () => {
  it('keeps the subagent dropdown accessible and returns focus when dismissed', async () => {
    const parentThread = parentThreadWithRunningSubagent();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [parentThread]),
      loadThread: vi.fn(async () => liveBootstrap(parentThread)),
      loadSubagentDetail: vi.fn(async () => subagentDetail()),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-parent-subagents"] button')));
    (runtime.querySelector('[data-thread-id="thread-parent-subagents"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-subagents-spawn"]')));

    const trigger = runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement;
    const badge = trigger.querySelector('.flower-header-icon-badge') as HTMLElement;
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.getAttribute('aria-controls')).toBe('flower-subagents-dropdown');
    expect(badge.textContent).toBe('1');
    expect(badge.getAttribute('data-running')).toBe('true');
    trigger.focus();
    trigger.click();
    await waitFor(() => Boolean(runtime.querySelector('#flower-subagents-dropdown')));

    const dropdown = runtime.querySelector('#flower-subagents-dropdown') as HTMLElement;
    const row = runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]') as HTMLElement;
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(dropdown.getAttribute('role')).toBe('dialog');
    expect(dropdown.getAttribute('aria-label')).toBe('Subagents');
    expect(row.getAttribute('data-flower-subagent-status')).toBe('running');
    expect(row.querySelector('.flower-activity-inline-loader')).toBeTruthy();
    expect(row.querySelector('.flower-subagent-status-dot-running')).toBeNull();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !runtime.querySelector('#flower-subagents-dropdown'));

    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(trigger);
  });

  it('opens subagent details from the parent header without selecting the child thread', async () => {
    const parentThread = parentThreadWithRunningSubagent();
    const siblingThread = thread({
      thread_id: 'thread-sibling',
      title: 'Sibling thread',
    });
    const loadThread = vi.fn(async (threadID: string) => liveBootstrap(threadID === siblingThread.thread_id ? siblingThread : parentThread));
    const loadSubagentDetail = vi.fn(async (_parentID: string, _childID: string, afterOrdinal = 0) => {
      if (afterOrdinal > 0) {
        return subagentDetail({
          timeline: [
            {
              ordinal: 5,
              kind: 'custom',
              type: 'delegated_lifecycle',
              created_at_ms: 180,
              generic: {
                title: 'delegated_lifecycle',
                body: 'Subagent queued follow-up evidence.',
                metadata: { phase: 'handoff', source: 'floret' },
              },
            },
            {
              ordinal: 6,
              kind: 'assistant_message',
              created_at_ms: 190,
              message: {
                role: 'assistant',
                text: 'Second page handoff detail.',
              },
            },
          ],
          activity: activityTimeline({
            run_id: 'subagent:thread-child-review',
            turn_id: 'child-canonical',
            items: [
              activityItem({
                item_id: 'call-terminal-running',
                tool_id: 'call-terminal-running',
                tool_name: 'terminal.exec',
                renderer: 'terminal',
                label: 'go test ./internal/ui',
                status: 'running',
                payload: {
                  command: 'go test ./internal/ui',
                  status: 'running',
                },
              }),
              activityItem({
                item_id: 'call-terminal',
                tool_id: 'call-terminal',
                tool_name: 'terminal.exec',
                renderer: 'terminal',
                label: 'go test ./internal/ai',
                status: 'success',
                payload: {
                  command: 'go test ./internal/ai',
                  status: 'success',
                  stdout: 'PASS ./internal/ai',
                  content_ref: 'hash-tool-result',
                },
              }),
              activityItem({
                item_id: 'event-delegated-lifecycle',
                tool_id: 'event-delegated-lifecycle',
                tool_name: 'subagent.event',
                kind: 'control',
                renderer: 'structured',
                label: 'delegated_lifecycle',
                description: 'Subagent queued follow-up evidence.',
                status: 'success',
                payload: {
                  summary: 'Subagent queued follow-up evidence.',
                  details: 'phase: handoff\nsource: floret',
                },
              }),
            ],
          }),
          next_ordinal: 7,
          has_more: false,
          generated_at_ms: 200,
        });
      }
      return subagentDetail({ has_more: true });
    });
    const stopThread = vi.fn(async (threadID: string) => liveBootstrap(thread({ thread_id: threadID, status: 'canceled' })));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [parentThread, siblingThread]),
      loadThread,
      loadSubagentDetail,
      stopThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-parent-subagents"] button')));
    (runtime.querySelector('[data-thread-id="thread-parent-subagents"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-subagents-spawn"]')));

    const subagentsTrigger = runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement;
    expect(subagentsTrigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(subagentsTrigger.getAttribute('aria-controls')).toBe('flower-subagents-dropdown');
    subagentsTrigger.click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-subagents-dropdown')));

    expect(runtime.querySelector('.flower-subagents-dropdown-layer')).toBeTruthy();
    expect(runtime.querySelector('.flower-subagents-dropdown')?.getAttribute('role')).toBe('dialog');
    expect(runtime.textContent).toContain('Review API contract');
    expect(runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"] .flower-activity-inline-loader')).toBeTruthy();
    expect(runtime.querySelector('.flower-subagent-status-dot-running')).toBeNull();

    (runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]')));

    expect(loadSubagentDetail).toHaveBeenCalledWith('thread-parent-subagents', 'thread-child-review', 0, 200);
    expect(loadThread).not.toHaveBeenCalledWith('thread-child-review');
    expect(selectedThreadID(runtime)).toBe('thread-parent-subagents');
    expect(runtime.querySelector('.flower-chat-header-title')?.textContent).toBe('Parent with subagents');
    const floatingWindow = runtime.querySelector('[data-floe-geometry-surface="floating-window"]');
    expect(floatingWindow).toBeTruthy();
    expect(floatingWindow?.classList.contains('flower-subagent-detail-window')).toBe(true);
    expect(floatingWindow?.querySelector('.flower-chat-transcript')).toBeTruthy();
    expect(floatingWindow?.querySelector('[data-flower-message-role="user"]')).toBeTruthy();
    expect(floatingWindow?.querySelector('[data-flower-message-role="assistant"]')).toBeTruthy();
    expect(floatingWindow?.querySelector('.flower-subagent-status-pill .flower-activity-inline-loader')).toBeTruthy();
    expect(floatingWindow?.querySelector('.flower-subagent-detail-bottom-dock')).toBeTruthy();
    expect(floatingWindow?.querySelector('.flower-subagent-detail-live-lane .flower-model-status-text')?.textContent).toBe('Waiting for model response...');
    expect(floatingWindow?.querySelector('.flower-composer')).toBeNull();
    expect(floatingWindow?.querySelector('textarea')).toBeNull();
    expect(floatingWindow?.querySelector('.flower-composer-submit')).toBeNull();
    expect(runtime.querySelector('.flower-subagent-detail-backdrop')).toBeNull();
    expect(runtime.querySelector('.flower-subagent-detail-dialog')).toBeNull();
    expect(runtime.querySelector('.flower-subagent-detail-timeline')).toBeNull();
    const toolResultRow = floatingWindow?.querySelector('[data-flower-activity-item-id="call-terminal"]') as HTMLElement | null;
    const runningToolRow = floatingWindow?.querySelector('[data-flower-activity-item-id="call-terminal-running"]') as HTMLElement | null;
    expect(runningToolRow).toBeTruthy();
    expect(runningToolRow?.classList.contains('flower-activity-inline-row-running')).toBe(true);
    expect(runningToolRow?.querySelector('.flower-activity-inline-loader')).toBeTruthy();
    expect(toolResultRow).toBeTruthy();
    expect(runtime.textContent).toContain('go test ./internal/ai');
    (toolResultRow?.querySelector('.flower-activity-inline-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('PASS ./internal/ai') ?? false);
    expect(runtime.textContent).toContain('PASS ./internal/ai');
    expect(runtime.textContent).toContain('Child handoff ready.');
    const loadMore = Array.from(runtime.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Load more')) as HTMLButtonElement;
    expect(loadMore).toBeTruthy();
    loadMore.click();
    await waitFor(() => runtime.textContent?.includes('Subagent queued follow-up evidence.') ?? false);
    expect(loadSubagentDetail).toHaveBeenCalledWith('thread-parent-subagents', 'thread-child-review', 5, 200);
    expect(runtime.textContent).toContain('delegated_lifecycle');
    const lifecycleRow = runtime.querySelector('[data-flower-activity-item-id="event-delegated-lifecycle"]') as HTMLElement | null;
    expect(lifecycleRow).toBeTruthy();
    (lifecycleRow?.querySelector('.flower-activity-inline-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('handoff') ?? false);
    expect(runtime.textContent).toContain('handoff');
    expect(runtime.textContent).not.toContain('phase');
    expect(runtime.textContent).toContain('Second page handoff detail.');
    const composer = runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
    expect(composer.disabled).toBe(false);
    const submitButton = runtime.querySelector('.flower-composer-submit') as HTMLButtonElement;
    expect(submitButton.getAttribute('aria-label')).toBe('Send');
    submitButton.click();
    await waitFor(() => true, 20);
    expect(stopThread).not.toHaveBeenCalled();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await waitFor(() => !runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]'));

    (runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-subagents-dropdown')));
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await waitFor(() => !runtime.querySelector('.flower-subagents-dropdown'));

    (runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-subagents-dropdown')));
    (runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]')));
    (runtime.querySelector('[data-floe-geometry-surface="floating-window"] button[aria-label="Close"]') as HTMLButtonElement).click();
    await waitFor(() => !runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]'));

    (runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-subagents-dropdown')));
    (runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]')));
    (runtime.querySelector('button[aria-label="New chat"]') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadID(runtime) === '');
    expect(runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]')).toBeNull();

    (runtime.querySelector('[data-thread-id="thread-parent-subagents"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadID(runtime) === 'thread-parent-subagents');
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-subagents-spawn"]')));
    (runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-subagents-dropdown')));
    (runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]')));

    (runtime.querySelector('[data-thread-id="thread-sibling"] button') as HTMLButtonElement).click();
    await waitFor(() => selectedThreadID(runtime) === 'thread-sibling');
    expect(runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]')).toBeNull();
  });

  it('tails an open running subagent detail without overlapping requests', async () => {
    const parentThread = parentThreadWithRunningSubagent();
    const tailPage = deferred<ReturnType<typeof subagentDetail>>();
    const loadSubagentDetail = vi.fn((_parentID: string, _childID: string, afterOrdinal = 0) => {
      if (afterOrdinal > 0) return tailPage.promise;
      return Promise.resolve(subagentDetail({ has_more: false, next_ordinal: 5 }));
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [parentThread]),
      loadThread: vi.fn(async () => liveBootstrap(parentThread)),
      loadSubagentDetail,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-parent-subagents"] button')));
    (runtime.querySelector('[data-thread-id="thread-parent-subagents"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-subagents-spawn"]')));
    (runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]')));
    vi.useFakeTimers();
    (runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]') as HTMLButtonElement).click();
    await flushMicrotasks();
    expect(loadSubagentDetail).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1500);
    await flushMicrotasks();
    expect(loadSubagentDetail).toHaveBeenCalledTimes(2);
    expect(loadSubagentDetail).toHaveBeenLastCalledWith('thread-parent-subagents', 'thread-child-review', 5, 200);

    await vi.advanceTimersByTimeAsync(1500);
    expect(loadSubagentDetail).toHaveBeenCalledTimes(2);

    tailPage.resolve(subagentDetail({
      has_more: false,
      next_ordinal: 6,
      timeline: [
        {
          ordinal: 6,
          kind: 'assistant_message',
          created_at_ms: 220,
          message: {
            role: 'assistant',
            text: 'Fresh tail detail.',
          },
        },
      ],
      generated_at_ms: 230,
    }));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.textContent).toContain('Fresh tail detail.');
  });

  it('keeps distinct subagent activity rows when detail pages share a run id', async () => {
    const parentThread = parentThreadWithRunningSubagent();
    const sharedRunID = 'subagent:thread-child-review';
    const loadSubagentDetail = vi.fn((_parentID: string, _childID: string, afterOrdinal = 0) => {
      if (afterOrdinal > 0) {
        return Promise.resolve(subagentDetail({
          has_more: false,
          next_ordinal: 7,
          timeline: [],
          activity: activityTimeline({
            run_id: sharedRunID,
            turn_id: 'child-canonical',
            items: [
              activityItem({
                item_id: 'shared-run-first',
                tool_id: 'shared-run-first',
                tool_name: 'subagent.event',
                kind: 'control',
                renderer: 'structured',
                label: 'first shared run activity',
                description: 'First shared run activity.',
                status: 'success',
                payload: { summary: 'First shared run activity.' },
              }),
              activityItem({
                item_id: 'shared-run-second',
                tool_id: 'shared-run-second',
                tool_name: 'subagent.event',
                kind: 'control',
                renderer: 'structured',
                label: 'second shared run activity',
                description: 'Second shared run activity.',
                status: 'success',
                payload: { summary: 'Second shared run activity.' },
              }),
            ],
          }),
          generated_at_ms: 230,
        }));
      }
      return Promise.resolve(subagentDetail({
        has_more: true,
        next_ordinal: 5,
        timeline: [],
        activity: activityTimeline({
          run_id: sharedRunID,
          turn_id: 'child-canonical',
          items: [activityItem({
            item_id: 'shared-run-first',
            tool_id: 'shared-run-first',
            tool_name: 'subagent.event',
            kind: 'control',
            renderer: 'structured',
            label: 'first shared run activity',
            description: 'First shared run activity.',
            status: 'success',
            payload: { summary: 'First shared run activity.' },
          })],
        }),
        generated_at_ms: 180,
      }));
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [parentThread]),
      loadThread: vi.fn(async () => liveBootstrap(parentThread)),
      loadSubagentDetail,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-parent-subagents"] button')));
    (runtime.querySelector('[data-thread-id="thread-parent-subagents"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-subagents-spawn"]')));
    (runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]')));
    (runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="shared-run-first"]')));

    const loadMore = Array.from(runtime.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Load more')) as HTMLButtonElement;
    expect(loadMore).toBeTruthy();
    loadMore.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="shared-run-second"]')));

    expect(runtime.querySelector('[data-flower-activity-item-id="shared-run-first"]')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-activity-item-id="shared-run-second"]')).toBeTruthy();
  });

  it('pauses manual subagent detail pagination while live tail is in flight', async () => {
    const parentThread = parentThreadWithRunningSubagent();
    const tailPage = deferred<ReturnType<typeof subagentDetail>>();
    const loadSubagentDetail = vi.fn((_parentID: string, _childID: string, afterOrdinal = 0) => {
      if (afterOrdinal > 0) return tailPage.promise;
      return Promise.resolve(subagentDetail({ has_more: true, next_ordinal: 5 }));
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [parentThread]),
      loadThread: vi.fn(async () => liveBootstrap(parentThread)),
      loadSubagentDetail,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-parent-subagents"] button')));
    (runtime.querySelector('[data-thread-id="thread-parent-subagents"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-subagents-spawn"]')));
    (runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]')));
    vi.useFakeTimers();
    (runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]') as HTMLButtonElement).click();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(1500);
    await flushMicrotasks();
    expect(loadSubagentDetail).toHaveBeenCalledTimes(2);

    const loadMore = Array.from(runtime.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Load more')) as HTMLButtonElement;
    expect(loadMore.disabled).toBe(true);
    loadMore.click();
    await flushMicrotasks();
    expect(loadSubagentDetail).toHaveBeenCalledTimes(2);

    tailPage.resolve(subagentDetail({
      has_more: false,
      next_ordinal: 6,
      timeline: [
        {
          ordinal: 6,
          kind: 'assistant_message',
          created_at_ms: 220,
          message: { role: 'assistant', text: 'Tail completed before manual paging.' },
        },
      ],
      generated_at_ms: 230,
    }));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);
    expect(runtime.textContent).toContain('Tail completed before manual paging.');
  });

  it('stops tailing when the subagent detail reports a terminal status', async () => {
    const parentThread = parentThreadWithRunningSubagent();
    const loadSubagentDetail = vi.fn(async () => subagentDetail({
      summary: {
        ...subagentDetail().summary,
        status: 'completed',
        last_message: 'Child review completed.',
      },
      has_more: false,
      next_ordinal: 5,
    }));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [parentThread]),
      loadThread: vi.fn(async () => liveBootstrap(parentThread)),
      loadSubagentDetail,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-parent-subagents"] button')));
    (runtime.querySelector('[data-thread-id="thread-parent-subagents"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-subagents-spawn"]')));
    (runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]')));
    (runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]')));

    vi.useFakeTimers();
    await vi.advanceTimersByTimeAsync(1500);
    await flushMicrotasks();

    expect(loadSubagentDetail).toHaveBeenCalledTimes(1);
    const floatingWindow = runtime.querySelector('[data-floe-geometry-surface="floating-window"]');
    expect(floatingWindow?.querySelector('.flower-subagent-status-pill')?.textContent).toContain('Completed');
    expect(floatingWindow?.querySelector('.flower-subagent-detail-live-lane .flower-model-status-text')).toBeNull();
  });

  it('ignores stale subagent tail pages after the detail is closed', async () => {
    const parentThread = parentThreadWithRunningSubagent();
    const staleTailPage = deferred<ReturnType<typeof subagentDetail>>();
    const loadSubagentDetail = vi.fn((_parentID: string, _childID: string, afterOrdinal = 0) => {
      if (afterOrdinal > 0) return staleTailPage.promise;
      return Promise.resolve(subagentDetail({ has_more: false, next_ordinal: 5 }));
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [parentThread]),
      loadThread: vi.fn(async () => liveBootstrap(parentThread)),
      loadSubagentDetail,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-parent-subagents"] button')));
    (runtime.querySelector('[data-thread-id="thread-parent-subagents"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-subagents-spawn"]')));
    (runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]')));
    vi.useFakeTimers();
    (runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]') as HTMLButtonElement).click();
    await flushMicrotasks();
    expect(loadSubagentDetail).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1500);
    await flushMicrotasks();
    expect(loadSubagentDetail).toHaveBeenCalledTimes(2);
    (runtime.querySelector('[data-floe-geometry-surface="floating-window"] button[aria-label="Close"]') as HTMLButtonElement).click();
    await flushMicrotasks();
    expect(runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]')).toBeNull();

    staleTailPage.resolve(subagentDetail({
      timeline: [
        {
          ordinal: 6,
          kind: 'assistant_message',
          created_at_ms: 220,
          message: {
            role: 'assistant',
            text: 'Stale tail should not render.',
          },
        },
      ],
      generated_at_ms: 230,
    }));
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(0);

    expect(runtime.textContent).not.toContain('Stale tail should not render.');
  });

  it('closes an open subagent detail when the parent no longer reports that child', async () => {
    const parentThread = thread({
      thread_id: 'thread-parent-subagents',
      title: 'Parent with subagents',
      messages: [
        {
          id: 'm-parent-subagents',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 20,
          blocks: [
            activityTimeline({
              run_id: 'run-subagents',
              turn_id: 'm-parent-subagents',
              items: [activityItem({
                item_id: 'tool-subagents-spawn',
                tool_id: 'tool-subagents-spawn',
                tool_name: 'subagents',
                renderer: 'structured',
                label: 'subagents',
                status: 'running',
                payload: {
                  action: 'spawn',
                  status: 'ok',
                  task_name: 'Review API contract',
                  task_description: 'Review the API boundary.',
                  agent_type: 'reviewer',
                  items: [{
                    task_name: 'Review API contract',
                    task_description: 'Review the API boundary.',
                    agent_type: 'reviewer',
                    status: 'running',
                  }],
                },
              })],
              subagent_actions: {
                'tool-subagents-spawn': {
                  operation: 'subagents',
                  action: 'spawn',
                  delegation_runtime: 'floret',
                  thread_id: 'thread-child-review',
                  subagent_id: 'thread-child-review',
                  task_name: 'Review API contract',
                  task_description: 'Review the API boundary.',
                  agent_type: 'reviewer',
                  status: 'running',
                  updated_at_ms: 120,
                },
              },
            }),
          ],
        },
      ],
    });
    const parentWithoutSubagents = thread({
      thread_id: 'thread-parent-subagents',
      title: 'Parent with subagents',
      messages: [
        {
          id: 'm-parent-subagents',
          role: 'assistant',
          content: 'No active child work remains.',
          status: 'complete',
          created_at_ms: 20,
        },
      ],
      updated_at_ms: 30,
    });
    let listed = parentThread;
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [listed]),
      loadThread: vi.fn(async () => liveBootstrap(listed)),
      loadSubagentDetail: vi.fn(async () => subagentDetail()),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-parent-subagents"] button')));
    (runtime.querySelector('[data-thread-id="thread-parent-subagents"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-subagents-spawn"]')));
    (runtime.querySelector('.flower-chat-header-actions button[title^="Open subagents"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]')));
    (runtime.querySelector('[data-flower-subagent-thread-id="thread-child-review"]') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]')));

    listed = parentWithoutSubagents;
    (runtime.querySelector('[data-thread-id="thread-parent-subagents"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('No active child work remains.') ?? false);

    expect(runtime.querySelector('[data-flower-subagent-detail-id="thread-child-review"]')).toBeNull();
  });

  it('prioritizes read-only child state over waiting input submission', async () => {
    const submitInput = vi.fn(async () => liveBootstrap(thread({ status: 'running' })));
    const waitingChild = thread({
      thread_id: 'thread-child-waiting',
      title: 'Waiting child',
      status: 'waiting_user',
      read_only_reason: 'Subagent threads are managed by their parent Flower thread thread-parent.',
      input_request: inputRequest(),
      messages: [
        {
          id: 'm-child-waiting',
          role: 'assistant',
          content: 'Need parent steering.',
          status: 'complete',
          created_at_ms: 20,
          blocks: [{ type: 'markdown', content: 'Need parent steering.' }],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingChild]),
      loadThread: vi.fn(async () => {
        const bootstrap = liveBootstrap(waitingChild);
        const request = inputRequest();
        return {
          ...bootstrap,
          live_state: {
            ...bootstrap.live_state,
            input_requests: {
              [request.prompt_id]: request,
            },
          },
        };
      }),
      submitInput,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-child-waiting"] button')));
    (runtime.querySelector('[data-thread-id="thread-child-waiting"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer-readonly-chip')));

    const continueButton = Array.from(runtime.querySelectorAll('button'))
      .find((button) => button.textContent?.includes('Continue')) as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    continueButton.click();
    await waitFor(() => true, 20);
    expect(submitInput).not.toHaveBeenCalled();
    expect(runtime.textContent).toContain('Subagent threads are managed by their parent Flower thread thread-parent.');
  });

  it('renders file activity actions and unified patch lines inline', async () => {
    const previewFile = vi.fn(async () => {});
    const browseFolder = vi.fn(async () => {});
    const activityThread = thread({
      thread_id: 'thread-file-activity',
      title: 'File activity',
      messages: [
        {
          id: 'm-file',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 20,
          blocks: [
            {
              type: 'markdown',
              content: 'I will edit the file.',
            },
            activityTimeline({
              file_actions: {
                edit_app: {
                  action_id: 'edit_app',
                  display_name: 'app.ts',
                  can_preview: true,
                  can_browse_directory: true,
                },
              },
              items: [activityItem({
                item_id: 'tool-write',
                tool_id: 'tool-write',
                tool_name: 'file.write',
                renderer: 'file',
                label: 'app.ts#dcbdf9b8c27f',
                payload: {
                  operation: 'write',
                  display_name: 'app.ts',
                  file_action_id: 'edit_app',
                  change_type: 'update',
                  additions: 1,
                  deletions: 1,
                  unified_diff: [
                    '--- a/src/app.ts',
                    '+++ b/src/app.ts',
                    '@@ -1,1 +1,1 @@',
                    '-const value = 1;',
                    '+const value = 2;',
                  ].join('\n'),
                },
              })],
            }),
            {
              type: 'markdown',
              content: 'Done.',
            },
          ],
        },
      ],
    });
    const host = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [activityThread]),
      loadThread: vi.fn(async () => liveBootstrap(activityThread)),
      openFilePreview: previewFile,
      openFileBrowser: browseFolder,
    });

    await waitFor(() => Boolean(host.querySelector('[data-thread-id="thread-file-activity"] button')));
    (host.querySelector('[data-thread-id="thread-file-activity"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(host.querySelector('[data-flower-activity-item-id="tool-write"]')));

    expect(host.textContent).toContain('I will edit the file.');
    expect(host.textContent).toContain('Done.');
    expect(host.textContent).not.toContain('#dcbdf9b8c27f');
    expect(host.querySelectorAll('.flower-activity-inline-line > .flower-activity-file-actions button')).toHaveLength(2);
    const preview = host.querySelector('button[aria-label="Preview app.ts"]') as HTMLButtonElement | null;
    const browser = host.querySelector('button[aria-label="Browse folder for app.ts"]') as HTMLButtonElement | null;
    expect(preview?.disabled).toBe(false);
    expect(browser?.disabled).toBe(false);

    const toggle = host.querySelector('[data-flower-activity-item-id="tool-write"] .flower-activity-inline-button') as HTMLButtonElement;
    toggle.click();
    await waitFor(() => Boolean(host.querySelector('.flower-activity-file-diff-line-del')));
    expect(host.querySelector('.flower-activity-file-diff-line-del')?.textContent).toContain('-const value = 1;');
    expect(host.querySelector('.flower-activity-file-diff-line-add')?.textContent).toContain('+const value = 2;');

    preview?.click();
    browser?.click();
    expect(previewFile).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-file-activity',
      message_id: 'm-file',
      block_index: 1,
      item_id: 'tool-write',
      action_id: 'edit_app',
    }));
    expect(browseFolder).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-file-activity',
      message_id: 'm-file',
      block_index: 1,
      item_id: 'tool-write',
      action_id: 'edit_app',
    }));
  });

  it('renders streaming assistant output with bottom model status and a wide transcript stack', async () => {
    const streamingThread = thread({
      thread_id: 'thread-streaming',
      title: 'Streaming answer',
      created_at_ms: 5_000,
      updated_at_ms: 5_200,
      status: 'running',
      model_io_status: modelIOStatus({ phase: 'streaming', run_id: 'run-streaming' }),
      messages: [
        {
          id: 'm-user-streaming',
          role: 'user',
          content: 'Stream this',
          status: 'complete',
          created_at_ms: 5_000,
        },
        {
          id: 'm-assistant-streaming',
          role: 'assistant',
          content: '',
          status: 'streaming',
          active_cursor: true,
          created_at_ms: 5_200,
          blocks: [
            { type: 'thinking', content: 'Checking the workspace.' },
            { type: 'markdown', content: 'Streaming partial answer' },
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [streamingThread]),
      loadThread: vi.fn(async () => liveBootstrap(streamingThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-streaming"] button')));
    (runtime.querySelector('[data-thread-id="thread-streaming"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-model-status-indicator')));

    expect(runtime.querySelector('.flower-transcript-stack')).toBeTruthy();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-model-status-indicator')).toBeNull();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-streaming-cursor')).toBeNull();
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-block-stack-assistant')).toBeTruthy();
    expect(Array.from(runtime.querySelectorAll('[data-flower-message-role="assistant"] .flower-message-bubble-plain'))
      .some((node) => node.textContent?.includes('Streaming partial answer'))).toBe(true);
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-message-bubble-framed')).toBeNull();
    expect(runtime.querySelector('[data-flower-message-role="user"] .flower-message-bubble-framed')).toBeTruthy();
    expect(runtime.querySelector('.flower-model-status-indicator')).toBeTruthy();
    expectModelStatusIndicator(runtime);
    expect(runtime.textContent).toContain('Streaming partial answer');
  });

  it('renders short model IO streaming phases before the same live batch clears them', async () => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      window.setTimeout(() => callback(performance.now()), 0);
      return 1;
    });

    const runID = 'run-short-model-io';
    const liveThread = thread({
      thread_id: 'thread-short-model-io',
      title: 'Short model IO',
      created_at_ms: 5_300,
      updated_at_ms: 5_320,
      status: 'running',
      messages: [
        {
          id: 'm-short-user',
          role: 'user',
          content: 'Run a short tool stream',
          status: 'complete',
          created_at_ms: 5_300,
        },
        {
          id: 'm-short-assistant',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 5_320,
          blocks: [
            { type: 'markdown', content: '' },
          ],
        },
      ],
    });
    const modelIOEvent = (
      seq: number,
      status: FlowerLiveEvent<'model_io.updated'>['payload']['status'],
    ): FlowerLiveEvent<'model_io.updated'> => ({
      schema_version: 1,
      seq,
      endpoint_id: 'test-runtime',
      thread_id: liveThread.thread_id,
      run_id: runID,
      at_unix_ms: 5_300 + seq,
      kind: 'model_io.updated',
      payload: { status },
    });
    const shortBatch: readonly FlowerLiveEvent[] = [
      {
        schema_version: 1,
        seq: 1,
        endpoint_id: 'test-runtime',
        thread_id: liveThread.thread_id,
        run_id: runID,
        at_unix_ms: 5_301,
        kind: 'run.started',
        payload: {
          run_id: runID,
          message_id: 'm-short-assistant',
          status: 'running',
        },
      },
      modelIOEvent(2, {
        phase: 'waiting_response',
        run_id: runID,
        step_index: 1,
        updated_at_ms: 5_302,
      }),
      modelIOEvent(3, {
        phase: 'streaming',
        run_id: runID,
        step_index: 1,
        updated_at_ms: 5_303,
      }),
      modelIOEvent(4, {
        phase: 'finalizing',
        run_id: runID,
        step_index: 1,
        updated_at_ms: 5_304,
      }),
      modelIOEvent(5, null),
    ];
    const listThreadLiveEvents = vi.fn(async (_threadID: string, afterSeq: number) => (
      afterSeq === 0
        ? {
            stream_generation: 1,
            events: shortBatch,
            next_cursor: 5,
            retained_from_seq: 1,
          }
        : {
            stream_generation: 1,
            events: [],
            next_cursor: afterSeq,
            retained_from_seq: 1,
          }
    ));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [liveThread]),
      loadThread: vi.fn(async () => liveBootstrap(liveThread, 0)),
      listThreadLiveEvents,
    });
    const observedStatuses: string[] = [];
    const recordModelStatus = () => {
      const text = runtime.querySelector('.flower-model-status-text')?.textContent?.trim() ?? '';
      if (text && observedStatuses.at(-1) !== text) {
        observedStatuses.push(text);
      }
    };
    const observer = new MutationObserver(recordModelStatus);
    observer.observe(runtime, { childList: true, characterData: true, subtree: true });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-short-model-io"] button')));
    (runtime.querySelector('[data-thread-id="thread-short-model-io"] button') as HTMLButtonElement).click();
    await waitFor(() => listThreadLiveEvents.mock.calls.length > 0);

    await waitFor(() => observedStatuses.includes('Thinking...'));
    observer.disconnect();

    expect(observedStatuses).toContain('Thinking...');

    expect(runtime.textContent).not.toContain('Thinking...Thinking...');
  });

  it('shows preparing model status after completed tool activity before the next model request', async () => {
    const toolGapThread = thread({
      thread_id: 'thread-tool-gap-model-status',
      title: 'Tool gap model status',
      created_at_ms: 5_400,
      updated_at_ms: 5_500,
      status: 'running',
      model_io_status: modelIOStatus({ phase: 'preparing', run_id: 'run-tool-gap' }),
      messages: [
        {
          id: 'm-tool-gap',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 5_500,
          blocks: [
            activityTimeline({
              run_id: 'run-tool-gap',
              turn_id: 'm-tool-gap',
              status: 'success',
              severity: 'quiet',
              items: [activityItem({
                item_id: 'tool-gap-done',
                tool_id: 'tool-gap-done',
                tool_name: 'terminal.exec',
                status: 'success',
                severity: 'quiet',
                label: 'npm test',
                renderer: 'terminal',
                payload: { command: 'npm test', exit_code: 0 },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [toolGapThread]),
      loadThread: vi.fn(async () => liveBootstrap(toolGapThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-tool-gap-model-status"] button')));
    (runtime.querySelector('[data-thread-id="thread-tool-gap-model-status"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="tool-gap-done"]')));

    expect(runtime.querySelector('[data-flower-activity-item-id="tool-gap-done"]')?.getAttribute('data-flower-activity-status')).toBe('success');
    expect(runtime.querySelectorAll('.flower-model-status-indicator')).toHaveLength(1);
    expect(runtime.querySelector('[data-flower-message-role="assistant"] .flower-model-status-indicator')).toBeNull();
    expectModelStatusIndicator(runtime, 'Preparing model request...');
  });

  it.each(['success', 'failed', 'canceled', 'waiting_approval', 'waiting_user'] as const)(
    'does not show the bottom model status for %s threads',
    async (status) => {
      const idleThread = thread({
        thread_id: `thread-no-model-status-${status}`,
        title: `No model status ${status}`,
        status,
        messages: [
          {
            id: `m-no-model-status-${status}`,
            role: 'assistant',
            content: 'Visible answer.',
            status: status === 'canceled' ? 'canceled' : status === 'failed' ? 'error' : 'complete',
            created_at_ms: 5_700,
            blocks: [{ type: 'markdown', content: 'Visible answer.' }],
          },
        ],
        ...(status === 'waiting_user' ? { input_request: inputRequest() } : {}),
      });
      const runtime = renderSurfaceWithAdapter({
        ...adapter(true),
        listThreads: vi.fn(async () => [idleThread]),
        loadThread: vi.fn(async () => liveBootstrap(idleThread)),
      });

      await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="thread-no-model-status-${status}"] button`)));
      (runtime.querySelector(`[data-thread-id="thread-no-model-status-${status}"] button`) as HTMLButtonElement).click();
      await waitFor(() => runtime.textContent?.includes('Visible answer.') ?? false);

      expect(runtime.querySelector('.flower-model-status-indicator')).toBeNull();
    },
  );

  it('shows completed Flower activity inline between assistant text blocks', async () => {
    const tool_names = [
      'terminal.exec',
      'terminal.exec',
      'terminal.exec',
      'terminal.exec',
      'terminal.exec',
      'write_todos',
      'task_complete',
    ] as const;
    const toolsThread = thread({
      thread_id: 'thread-tools',
      title: 'Tool activity',
      created_at_ms: 6_000,
      updated_at_ms: 6_500,
      status: 'success',
      messages: [
        {
          id: 'm-tools',
          role: 'assistant',
          content: 'I will check the workspace.\n\nI finished the answer after the audit trail.',
          status: 'complete',
          created_at_ms: 6_500,
          blocks: [
            { type: 'markdown', content: 'I will check the workspace.' },
            activityTimeline({
              run_id: 'run-tools',
              turn_id: 'm-tools',
              items: tool_names.map((tool_name, index) => activityItem({
                item_id: `item-${index}`,
                tool_id: `tool-${index}`,
                tool_name,
                kind: tool_name === 'task_complete' ? 'control' : 'tool',
                status: 'success',
                severity: 'quiet',
                ...(tool_name === 'terminal.exec'
                  ? {
                      label: `npm run check:${index}`,
                      renderer: 'terminal',
                      payload: {
                        command: `npm run check:${index}`,
                        output: `check ${index} ok\n`,
                        exit_code: 0,
                        duration_ms: 1234,
                        process_id: `tp_check_${index}`,
                        truncated: index === 0,
                      },
                    }
                  : tool_name === 'write_todos'
                    ? {
                        label: 'Update todos',
                        renderer: 'todos',
                        payload: { todos: [{ content: 'Verify inline activity', status: 'completed' }] },
                      }
                    : {
                        label: 'task_complete',
                        renderer: 'completion',
                        payload: { result: 'done' },
                      }),
              })),
            }),
            { type: 'markdown', content: 'I finished the answer after the audit trail.' },
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [toolsThread]),
      loadThread: vi.fn(async () => liveBootstrap(toolsThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-tools"] button')));
    (runtime.querySelector('[data-thread-id="thread-tools"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-activity-inline')));

    const transcriptText = runtime.textContent ?? '';
    expect(transcriptText.indexOf('I will check the workspace.')).toBeLessThan(transcriptText.indexOf('npm run check:0'));
    expect(transcriptText.indexOf('npm run check:0')).toBeLessThan(transcriptText.indexOf('I finished the answer after the audit trail.'));
    expect(runtime.querySelector('.flower-tool-activity')).toBeNull();
    expect(runtime.querySelector('.flower-todo-snapshot')).toBeNull();
    expect(runtime.textContent).not.toContain('3 / 3 completed');
    expect(runtime.textContent).not.toContain('Draft final answer');
    expect(runtime.querySelectorAll('.flower-activity-inline-row')).toHaveLength(tool_names.length);
    expect(runtime.textContent).not.toContain('terminal.execterminal.exec');
    expect(runtime.textContent).toContain('Update todos');
    expect(runtime.textContent).toContain('completed 1');
    expect(runtime.textContent).toContain('task_complete');
    const firstTerminalRow = runtime.querySelector('[data-flower-activity-item-id="item-0"]') as HTMLElement | null;
    expect(firstTerminalRow).toBeTruthy();
    expect(firstTerminalRow?.textContent).toContain('npm run check:0');
    (firstTerminalRow?.querySelector('.flower-activity-inline-button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(firstTerminalRow?.querySelector('[data-flower-activity-terminal-panel]')));
    const terminalPanel = firstTerminalRow?.querySelector('[data-flower-activity-terminal-panel]') as HTMLElement | null;
    expect(terminalPanel?.textContent).toContain('npm run check:0');
    expect(terminalPanel?.textContent).toContain('check 0 ok');
    expect(terminalPanel?.textContent).toContain('exit 0');
    expect(terminalPanel?.textContent).toContain('1s');
    expect(terminalPanel?.textContent).toContain('truncated');
    expect(terminalPanel?.querySelector('.flower-activity-inline-detail-key')).toBeNull();
    expect(terminalPanel?.textContent).not.toContain('command');
    expect(terminalPanel?.textContent).not.toContain('process');
    expect(terminalPanel?.querySelector('input')).toBeNull();
  });

  it('reads live terminal output when an expanded running activity has a process id', async () => {
    const readTerminalProcess = vi.fn(async () => {
      if (readTerminalProcess.mock.calls.length <= 1) {
        return {
          process_id: 'tp_live_terminal',
          status: 'running',
          output: 'tick 1\ntick 2\n',
          last_seq: 2,
          total_bytes: 14,
        };
      }
      return {
        process_id: 'tp_live_terminal',
        status: 'running',
        output: '',
        last_seq: 2,
        total_bytes: 14,
      };
    });
    const liveTerminalThread = thread({
      thread_id: 'thread-live-terminal-output',
      title: 'Live terminal output',
      status: 'running',
      active_run_id: 'run-live-terminal',
      messages: [
        {
          id: 'm-live-terminal-output',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 6_700,
          blocks: [
            activityTimeline({
              run_id: 'run-live-terminal',
              turn_id: 'm-live-terminal-output',
              status: 'running',
              items: [activityItem({
                item_id: 'terminal-live',
                tool_id: 'terminal-live',
                tool_name: 'terminal.exec',
                kind: 'tool',
                status: 'running',
                renderer: 'terminal',
                label: 'for i in 1 2; do echo tick:$i; done',
                payload: {
                  command: 'for i in 1 2; do echo tick:$i; done',
                  status: 'running',
                  process_id: 'tp_live_terminal',
                },
              })],
            }),
          ],
        },
      ],
    });
    let deliveredEmptyBlockSet = false;
    const listThreadLiveEvents = vi.fn(async (_threadID: string, cursor: number) => {
      if (!deliveredEmptyBlockSet && cursor < 1 && readTerminalProcess.mock.calls.length > 0) {
        deliveredEmptyBlockSet = true;
        return {
          stream_generation: 1,
          events: [{
            schema_version: 1,
            seq: 1,
            endpoint_id: 'test-runtime',
            thread_id: 'thread-live-terminal-output',
            run_id: 'run-live-terminal',
            turn_id: 'm-live-terminal-output',
            at_unix_ms: 6_710,
            kind: 'message.block_set',
            payload: {
              message_id: 'm-live-terminal-output',
              block_index: 0,
              block: {
                type: 'activity-timeline',
                block: activityTimeline({
                  run_id: 'run-live-terminal',
                  turn_id: 'm-live-terminal-output',
                  status: 'running',
                  items: [activityItem({
                    item_id: 'terminal-live',
                    tool_id: 'terminal-live',
                    tool_name: 'terminal.exec',
                    kind: 'tool',
                    status: 'running',
                    renderer: 'terminal',
                    label: 'for i in 1 2; do echo tick:$i; done',
                    payload: {
                      command: 'for i in 1 2; do echo tick:$i; done',
                      status: 'running',
                      process_id: 'tp_live_terminal',
                      output: '',
                      stdout: '',
                      last_seq: 2,
                      total_bytes: 14,
                    },
                  })],
                }),
              },
            },
          } satisfies FlowerLiveEvent],
          next_cursor: 1,
          retained_from_seq: 1,
        };
      }
      return { stream_generation: 1, events: [], next_cursor: cursor, retained_from_seq: 1 };
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      readTerminalProcess,
      listThreadLiveEvents,
      listThreads: vi.fn(async () => [liveTerminalThread]),
      loadThread: vi.fn(async () => liveBootstrap(liveTerminalThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-live-terminal-output"] button')));
    (runtime.querySelector('[data-thread-id="thread-live-terminal-output"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="terminal-live"]')));
    (runtime.querySelector('[data-flower-activity-item-id="terminal-live"] .flower-activity-inline-button') as HTMLButtonElement).click();

    await waitFor(() => readTerminalProcess.mock.calls.length > 0);
    expect(readTerminalProcess).toHaveBeenCalledWith({
      run_id: 'run-live-terminal',
      process_id: 'tp_live_terminal',
      after_seq: undefined,
      wait_ms: 1000,
      max_bytes: 1000000,
    });
    await waitFor(() => runtime.textContent?.includes('tick 2') ?? false);
    await waitFor(() => readTerminalProcess.mock.calls.length > 1);
    await waitFor(() => deliveredEmptyBlockSet);
    expect(runtime.textContent).toContain('tick 1');
    expect(runtime.textContent).toContain('tick 2');
    expect(runtime.textContent).not.toContain('Listening for output...');
    expect(runtime.querySelector('[data-flower-activity-terminal-panel] input')).toBeNull();
  });

  it('renders expanded web, question, and completion details as product panels', async () => {
    const productDetailsThread = thread({
      thread_id: 'thread-product-activity-details',
      title: 'Product activity details',
      created_at_ms: 6_600,
      updated_at_ms: 6_650,
      status: 'success',
      messages: [
        {
          id: 'm-product-activity-details',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 6_650,
          blocks: [
            activityTimeline({
              run_id: 'run-product-activity-details',
              turn_id: 'm-product-activity-details',
              items: [
                activityItem({
                  item_id: 'item-web',
                  tool_id: 'item-web',
                  tool_name: 'web.search',
                  renderer: 'web_search',
                  label: 'latest release',
                  status: 'success',
                  payload: {
                    query: 'latest release',
                    count: 1,
                    results: [{ title: 'Release notes', url: 'https://example.test/release', snippet: 'Release is ready.' }],
                  },
                }),
                activityItem({
                  item_id: 'item-question',
                  tool_id: 'item-question',
                  tool_name: 'ask_user',
                  renderer: 'question',
                  label: 'Choose target',
                  status: 'success',
                  payload: {
                    questions: [{
                      question: 'Which target should I inspect?',
                      choices: [{ label: 'Local', description: 'This Mac' }],
                    }],
                  },
                }),
                activityItem({
                  item_id: 'item-completion',
                  tool_id: 'item-completion',
                  tool_name: 'task_complete',
                  renderer: 'completion',
                  label: 'task_complete',
                  status: 'success',
                  payload: {
                    result: 'Implemented.',
                    evidence_refs: ['Flower UI test'],
                    next_actions: ['Ship'],
                  },
                }),
              ],
              subagent_actions: {
                'item-subagents': {
                  operation: 'subagents',
                  action: 'wait',
                  delegation_runtime: 'floret',
                  items: [{
                    thread_id: 'thread-child-hidden',
                    subagent_id: 'thread-child-hidden',
                    task_name: 'Review API contract',
                    status: 'completed',
                    started_at_ms: 6_000,
                    updated_at_ms: 6_700,
                  }],
                },
              },
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [productDetailsThread]),
      loadThread: vi.fn(async () => liveBootstrap(productDetailsThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-product-activity-details"] button')));
    (runtime.querySelector('[data-thread-id="thread-product-activity-details"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="item-web"]')));

    for (const itemID of ['item-web', 'item-question', 'item-completion']) {
      const row = runtime.querySelector(`[data-flower-activity-item-id="${itemID}"]`) as HTMLElement;
      (row.querySelector('.flower-activity-inline-button') as HTMLButtonElement).click();
    }

    await waitFor(() => Boolean(runtime.querySelector('.flower-activity-web-panel')));
    expect(runtime.querySelector('.flower-activity-web-panel')?.textContent).toContain('Release notes');
    expect(runtime.querySelector('.flower-activity-question-panel')?.textContent).toContain('Which target should I inspect?');
    expect(runtime.querySelector('.flower-activity-question-panel')?.textContent).toContain('Local');
    expect(runtime.querySelector('.flower-activity-completion-panel')?.textContent).toContain('Implemented.');
    expect(runtime.querySelector('.flower-activity-completion-panel')?.textContent).toContain('Flower UI test');
    expect(runtime.textContent).not.toContain('"results"');
    expect(runtime.textContent).not.toContain('"questions"');
    expect(runtime.textContent).not.toContain('evidence_refs');
  });

  it('renders failed write_todos details as a failure reason without raw fields', async () => {
    const todosThread = thread({
      thread_id: 'thread-failed-todos',
      title: 'Failed todos',
      created_at_ms: 6_700,
      updated_at_ms: 6_750,
      status: 'failed',
      messages: [
        {
          id: 'm-failed-todos',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 6_750,
          blocks: [
            activityTimeline({
              run_id: 'run-failed-todos',
              turn_id: 'm-failed-todos',
              status: 'error',
              items: [
                activityItem({
                  item_id: 'item-failed-todos',
                  tool_id: 'item-failed-todos',
                  tool_name: 'write_todos',
                  renderer: 'todos',
                  label: 'Update todos',
                  status: 'error',
                  severity: 'error',
                  needs_attention: true,
                  payload: {
                    status: 'error',
                    todos: [{ content: 'Keep final review open', status: 'in_progress' }],
                    error: { code: 'UNKNOWN', message: 'Todo update failed', retryable: false },
                  },
                }),
              ],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [todosThread]),
      loadThread: vi.fn(async () => liveBootstrap(todosThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-failed-todos"] button')));
    (runtime.querySelector('[data-thread-id="thread-failed-todos"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="item-failed-todos"]')));

    const row = runtime.querySelector('[data-flower-activity-item-id="item-failed-todos"]') as HTMLElement;
    const button = row.querySelector('.flower-activity-inline-button') as HTMLButtonElement;
    if (button.getAttribute('aria-expanded') !== 'true') {
      button.click();
    }

    await waitFor(() => row.textContent?.includes('Todo update failed') ?? false);
    expect(row.textContent).toContain('Todo update failed');
    expect(row.textContent).toContain('Keep final review open');
    expect(row.textContent).not.toContain('result status');
    expect(row.textContent).not.toContain('error code');
    expect(row.textContent).not.toContain('UNKNOWN');
    expect(row.textContent).not.toContain('kind');
    expect(row.textContent).not.toContain('tool');
    expect(row.textContent).not.toContain('item-failed-todos');
  });

  it('renders subagent details without legacy ids or debug fields', async () => {
    const subagentsThread = thread({
      thread_id: 'thread-subagent-details',
      title: 'Subagent details',
      created_at_ms: 6_760,
      updated_at_ms: 6_780,
      status: 'success',
      messages: [
        {
          id: 'm-subagent-details',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 6_780,
          blocks: [
            activityTimeline({
              run_id: 'run-subagent-details',
              turn_id: 'm-subagent-details',
              items: [
                activityItem({
                  item_id: 'item-subagents',
                  tool_id: 'item-subagents',
                  tool_name: 'subagents',
                  renderer: 'structured',
                  label: 'subagents',
                  status: 'success',
                  payload: {
                    action: 'wait',
                    status: 'ok',
                    agent_count: 1,
                    items: [{
                      task_name: 'Review API contract',
                      task_description: 'Review the public API boundary.',
                      agent_type: 'reviewer',
                      status: 'completed',
                      last_message: 'Hidden handoff preview',
                      waiting_prompt: 'Hidden waiting prompt',
                      can_close: true,
                    }],
                    final_handoff_report: {
                      summary: 'Delegated subagents finished wait: 1 completed.',
                      reports: [{
                        thread_id: 'thread-child-hidden',
                        task_name: 'Review API contract',
                        agent_type: 'reviewer',
                        status: 'completed',
                        handoff: 'API boundary is consistent.',
                      }],
                    },
                    snapshot: { thread_id: 'legacy-hidden', task_name: 'Legacy snapshot' },
                  },
                }),
              ],
              subagent_actions: {
                'item-subagents': {
                  operation: 'subagents',
                  action: 'wait',
                  delegation_runtime: 'floret',
                  thread_id: 'thread-child-hidden',
                  subagent_id: 'thread-child-hidden',
                  task_name: 'Review API contract',
                  task_description: 'Review the public API boundary.',
                  agent_type: 'reviewer',
                  status: 'completed',
                  updated_at_ms: 1_700_000_000_100,
                  items: [{
                    thread_id: 'thread-child-hidden',
                    subagent_id: 'thread-child-hidden',
                    task_name: 'Review API contract',
                    task_description: 'Review the public API boundary.',
                    agent_type: 'reviewer',
                    status: 'completed',
                    updated_at_ms: 1_700_000_000_100,
                  }],
                },
              },
            }),
          ],
        },
      ],
    });
    const loadSubagentDetail = vi.fn(async () => subagentDetail());
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [subagentsThread]),
      loadThread: vi.fn(async () => liveBootstrap(subagentsThread)),
      loadSubagentDetail,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-subagent-details"] button')));
    (runtime.querySelector('[data-thread-id="thread-subagent-details"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="item-subagents"]')));

    const row = runtime.querySelector('[data-flower-activity-item-id="item-subagents"]') as HTMLElement;
    (row.querySelector('.flower-activity-inline-button') as HTMLButtonElement).click();

    await waitFor(() => row.textContent?.includes('Review API contract') ?? false);
    expect(row.textContent).toContain('Review API contract');
    expect(row.textContent).toContain('Review the public API boundary.');
    expect(row.textContent).not.toContain('Agent:');
    expect(row.textContent).not.toContain('Open messages');
    expect(row.textContent).not.toContain('Completed');
    expect(row.textContent).not.toContain('API boundary is consistent.');
    expect(row.textContent).not.toContain('thread-child-hidden');
    expect(row.textContent).not.toContain('Hidden handoff preview');
    expect(row.textContent).not.toContain('Hidden waiting prompt');
    expect(row.textContent).not.toContain('can_close');
    expect(row.textContent).not.toContain('legacy-hidden');
    expect(row.textContent).not.toContain('Legacy snapshot');

    const openButton = row.querySelector('.flower-activity-subagents-open') as HTMLButtonElement;
    expect(openButton.getAttribute('aria-label')).toBe('Open subagent messages for Review API contract');
    expect(openButton.textContent).toBe('');
    openButton.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-subagent-detail-id="thread-child-hidden"]')));
    expect(loadSubagentDetail).toHaveBeenCalledWith('thread-subagent-details', 'thread-child-hidden', 0, 200);
    expect(selectedThreadID(runtime)).toBe('thread-subagent-details');
  });

  it('renders approval controls in the composer while preserving the activity audit row', async () => {
    const approveThread = thread({
      thread_id: 'thread-inline-approval',
      title: 'Inline approval',
      created_at_ms: 6_800,
      updated_at_ms: 6_900,
      status: 'waiting_approval',
      approval_actions: [{
        action_id: 'appr-terminal',
        origin: 'main_tool',
        run_id: 'run-inline-approval',
        tool_id: 'tool-needs-approval',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        version: 1,
        requested_at_ms: 6_850,
        can_approve: true,
        expected_seq: 12,
        summary: {
          label: 'pwd; sleep 15; date',
          description: 'Review this command before it runs.',
          command: 'pwd; sleep 15; date',
          cwd: '/repo',
          effects: ['shell'],
        },
      }],
      messages: [
        {
          id: 'm-inline-approval',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 6_900,
          blocks: [
            activityTimeline({
              run_id: 'run-inline-approval',
              turn_id: 'm-inline-approval',
              status: 'waiting',
              severity: 'blocking',
              needs_attention: true,
              items: [activityItem({
                item_id: 'tool-needs-approval',
                tool_id: 'tool-needs-approval',
                tool_name: 'terminal.exec',
                kind: 'tool',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                requires_approval: true,
                approval_state: 'requested',
                label: 'pwd; sleep 15; date',
                renderer: 'terminal',
                payload: { command: 'pwd; sleep 15; date' },
              }), activityItem({
                item_id: 'tool-queued-sibling',
                tool_id: 'tool-queued-sibling',
                tool_name: 'terminal.exec',
                kind: 'tool',
                status: 'pending',
                severity: 'quiet',
                label: 'curl -sL https://search.example.test',
                renderer: 'terminal',
                payload: { command: 'curl -sL https://search.example.test' },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [approveThread]),
      loadThread: vi.fn(async () => ({
        ...liveBootstrap({
          ...approveThread,
          approval_actions: [],
        }, 12),
        live_state: {
          ...liveBootstrap(approveThread, 12).live_state,
          approval_actions: {
            'appr-terminal': approveThread.approval_actions![0]!,
          },
        },
      })),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-inline-approval"] button')));
    (runtime.querySelector('[data-thread-id="thread-inline-approval"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer [data-flower-composer-approval="true"][data-flower-approval-action-id="appr-terminal"]')));

    const composer = runtime.querySelector('.flower-composer') as HTMLElement;
    expect(composer.querySelector('textarea')).toBeNull();
    expect(composer.textContent).toContain('pwd; sleep 15; date');
    expect(composer.textContent).toContain('Flower wants to execute a shell command');
    const row = runtime.querySelector('[data-flower-activity-item-id="tool-needs-approval"]') as HTMLElement;
    expect(row?.textContent).toContain('pwd; sleep 15; date');
    expect(row?.textContent).not.toContain('terminal.exec');
    expect(row?.getAttribute('data-flower-activity-status')).toBe('waiting');
    const queuedRow = runtime.querySelector('[data-flower-activity-item-id="tool-queued-sibling"]') as HTMLElement;
    expect(queuedRow?.textContent).toContain('curl -sL https://search.example.test');
    expect(queuedRow?.getAttribute('data-flower-activity-status')).toBe('pending');
    expect(queuedRow?.textContent).toContain('Pending');
    expect(queuedRow?.textContent).not.toContain('Running');
    expect(runtime.querySelector('.flower-transcript-stack > .flower-approval-stack')).toBeNull();
  });

  it('uses the composer as the primary surface for delegated approvals', async () => {
    const delegatedAction = {
      action_id: 'dappr-terminal',
      origin: 'delegated_subagent' as const,
      tool_name: 'terminal.exec',
      state: 'requested' as const,
      status: 'pending' as const,
      revision: 1,
      version: 3,
      surface_epoch: 7,
      surface_role: 'primary_action' as const,
      scope: 'thread_delegated_wait',
      requested_at_ms: 7_250,
      can_approve: true,
      expected_seq: 18,
      delegated_ref: {
        parent_thread_id: 'thread-delegated-approval',
        parent_run_id: 'run-parent-delegated',
        parent_turn_id: 'm-delegated-approval',
        subagent_id: 'thread-child-review',
        child_thread_id: 'thread-child-review',
        child_run_id: 'run-child-review',
        child_tool_call_id: 'tool-child-shell',
        approval_id: 'approval-child-shell',
      },
      delivery_state: 'waiting_decision' as const,
      child_execution_state: 'pending' as const,
      summary: {
        label: 'Subtask command',
        description: 'Subtask Review API contract requests approval.',
        command: 'npm test -- --runInBand',
        cwd: '/repo',
        effects: ['shell'],
      },
    };
    const delegatedThread = thread({
      thread_id: 'thread-delegated-approval',
      title: 'Delegated approval',
      status: 'waiting_approval',
      approval_actions: [delegatedAction],
      messages: [
        {
          id: 'm-delegated-approval',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 7_250,
          blocks: [
            activityTimeline({
              run_id: 'run-parent-delegated',
              turn_id: 'm-delegated-approval',
              status: 'waiting',
              severity: 'blocking',
              needs_attention: true,
              items: [activityItem({
                item_id: 'tool-child-shell',
                tool_id: 'tool-child-shell',
                tool_name: 'terminal.exec',
                kind: 'tool',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                requires_approval: true,
                approval_state: 'requested',
                label: 'npm test',
                renderer: 'terminal',
                payload: { command: 'npm test' },
              })],
            }),
          ],
        },
      ],
    });
    const submitApproval = vi.fn(async () => undefined);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [delegatedThread]),
      loadThread: vi.fn(async () => ({
        ...liveBootstrap({
          ...delegatedThread,
          approval_actions: [],
        }, 18),
        live_state: {
          ...liveBootstrap(delegatedThread, 18).live_state,
          approval_actions: {
            'dappr-terminal': delegatedAction,
          },
        },
      })),
      submitApproval,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-delegated-approval"] button')));
    (runtime.querySelector('[data-thread-id="thread-delegated-approval"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer [data-flower-composer-approval="true"][data-flower-approval-action-id="dappr-terminal"]')));

    const primaryCard = runtime.querySelector('.flower-composer [data-flower-approval-action-id="dappr-terminal"]') as HTMLElement;
    expect(runtime.querySelector('.flower-composer textarea')).toBeNull();
    expect(runtime.querySelector('[data-flower-thread-approval-panel] [data-flower-approval-action-id="dappr-terminal"]')).toBeNull();
    expect(primaryCard.textContent).toContain('npm test -- --runInBand');
    writeTextToClipboardMock.mockResolvedValueOnce(undefined);
    const copyButton = primaryCard.querySelector('.flower-approval-copy-btn') as HTMLButtonElement | null;
    expect(copyButton).toBeTruthy();
    copyButton?.click();
    await waitFor(() => writeTextToClipboardMock.mock.calls.length === 1);
    expect(writeTextToClipboardMock).toHaveBeenCalledWith('npm test -- --runInBand');
    expect(copyButton?.getAttribute('data-copied')).toBe('true');

    const row = runtime.querySelector('[data-flower-activity-item-id="tool-child-shell"]') as HTMLElement | null;
    expect(row?.querySelector('[data-flower-approval-action-id="dappr-terminal"]')).toBeNull();
    const approve = Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-actions button'))
      .find((button) => button.textContent?.trim() === 'Approve');
    expect(approve).toBeTruthy();
    approve?.click();

    await waitFor(() => submitApproval.mock.calls.length === 1);
    expect(submitApproval).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: 'thread-delegated-approval',
      origin: 'delegated_subagent',
      action_id: 'dappr-terminal',
      version: 3,
      surface_epoch: 7,
      idempotency_key: 'dappr-terminal:approve:3:7',
      delegated_ref: delegatedAction.delegated_ref,
    }));
  });

  it('shows the oldest composer approval with a compact queue count', async () => {
    const firstApproval = {
      action_id: 'appr-first',
      origin: 'main_tool' as const,
      run_id: 'run-queue-approval',
      tool_id: 'tool-first',
      tool_name: 'terminal.exec',
      state: 'requested' as const,
      status: 'pending' as const,
      revision: 1,
      version: 1,
      requested_at_ms: 7_100,
      can_approve: true,
      expected_seq: 21,
      summary: {
        label: 'First command',
        command: 'npm test',
        effects: ['shell'],
      },
    };
    const secondApproval = {
      ...firstApproval,
      action_id: 'appr-second',
      tool_id: 'tool-second',
      requested_at_ms: 7_200,
      expected_seq: 22,
      summary: {
        label: 'Second command',
        command: 'npm run lint',
        effects: ['shell'],
      },
    };
    const approvalThread = thread({
      thread_id: 'thread-approval-queue',
      title: 'Approval queue',
      status: 'waiting_approval',
      approval_actions: [secondApproval, firstApproval],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [approvalThread]),
      loadThread: vi.fn(async () => ({
        ...liveBootstrap({
          ...approvalThread,
          approval_actions: [],
        }, 22),
        live_state: {
          ...liveBootstrap(approvalThread, 22).live_state,
          approval_actions: {
            'appr-first': firstApproval,
            'appr-second': secondApproval,
          },
        },
      })),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-approval-queue"] button')));
    (runtime.querySelector('[data-thread-id="thread-approval-queue"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer [data-flower-approval-action-id="appr-first"]')));

    const composer = runtime.querySelector('.flower-composer') as HTMLElement;
    expect(composer.textContent).toContain('npm test');
    expect(composer.textContent).not.toContain('npm run lint');
    expect(composer.textContent).toContain('Flower wants to execute a shell command');
  });

  it('refreshes canonical thread state when an approval decision is stale', async () => {
    const pendingThread = thread({
      thread_id: 'thread-stale-approval',
      title: 'Stale approval',
      status: 'waiting_approval',
      approval_actions: [{
        action_id: 'appr-stale',
        origin: 'main_tool',
        run_id: 'run-stale-approval',
        tool_id: 'tool-stale-approval',
        tool_name: 'terminal.exec',
        state: 'requested',
        status: 'pending',
        revision: 1,
        version: 1,
        requested_at_ms: 7_100,
        can_approve: true,
        expected_seq: 12,
        summary: {
          label: 'terminal.exec',
          description: 'Review this command before it runs.',
          effects: ['shell'],
        },
      }],
      messages: [
        {
          id: 'm-stale-approval',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 7_100,
          blocks: [
            activityTimeline({
              run_id: 'run-stale-approval',
              turn_id: 'm-stale-approval',
              status: 'waiting',
              severity: 'blocking',
              needs_attention: true,
              items: [activityItem({
                item_id: 'tool-stale-approval',
                tool_id: 'tool-stale-approval',
                tool_name: 'terminal.exec',
                kind: 'tool',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                requires_approval: true,
                approval_state: 'requested',
                label: 'npm test',
                renderer: 'terminal',
                payload: { command: 'npm test' },
              })],
            }),
          ],
        },
      ],
    });
    const resolvedThread = {
      ...pendingThread,
      status: 'running' as const,
      approval_actions: [],
      messages: pendingThread.messages.map((message) => ({
        ...message,
        blocks: message.blocks?.map((block) => block.type === 'activity-timeline'
          ? {
              ...block,
              summary: {
                ...block.summary,
                status: 'running' as const,
                needs_attention: false,
                attention_reasons: [],
                counts: { running: 1, approval: 1 },
              },
              items: block.items.map((item) => ({
                ...item,
                status: 'running' as const,
                needs_attention: false,
                approval_state: 'approved' as const,
              })),
            }
          : block),
      })),
    };
    const loadThread = vi.fn(async () => {
      if (loadThread.mock.calls.length <= 1) {
        return {
          ...liveBootstrap({
            ...pendingThread,
            approval_actions: [],
          }, 13),
          live_state: {
            ...liveBootstrap(pendingThread, 13).live_state,
            approval_actions: {
              'appr-stale': pendingThread.approval_actions![0]!,
            },
          },
        };
      }
      return liveBootstrap({
        ...resolvedThread,
        approval_actions: [],
      }, 13);
    });
    const submitApproval = vi.fn(async () => {
      throw new Error('approval no longer pending');
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [pendingThread]),
      loadThread,
      submitApproval,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-stale-approval"] button')));
    (runtime.querySelector('[data-thread-id="thread-stale-approval"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-approval-action-id="appr-stale"]')));
    const approve = Array.from(runtime.querySelectorAll<HTMLButtonElement>('button'))
      .find((button) => button.textContent?.trim() === 'Approve');
    expect(approve).toBeTruthy();
    approve?.click();

    await waitFor(() => submitApproval.mock.calls.length === 1);
    await waitFor(() => loadThread.mock.calls.length >= 2);
    expect(flowerSurfaceNotifications()).toContainEqual(expect.objectContaining({
      tone: 'error',
      title: 'Flower could not send.',
      message: 'approval no longer pending',
    }));
    expect(runtime.querySelector('.flower-composer-error')).toBeNull();
    await waitFor(() => runtime.querySelector('[data-flower-approval-action-id="appr-stale"]') === null);
  });

  it('renders terminal command and output details from tool activity items', async () => {
    const terminalThread = thread({
      thread_id: 'thread-terminal-output',
      title: 'Terminal output',
      created_at_ms: 6_600,
      updated_at_ms: 6_700,
      status: 'success',
      messages: [
        {
          id: 'm-terminal-output',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 6_700,
          blocks: [
            activityTimeline({
              run_id: 'run-terminal-output',
              turn_id: 'm-terminal-output',
              items: [activityItem({
                item_id: 'terminal-real',
                tool_id: 'terminal-real',
                tool_name: 'terminal.exec',
                kind: 'tool',
                label: 'terminal.exec',
                renderer: 'terminal',
                payload: {
                  command: 'curl -s https://example.com',
                  exit_code: 0,
                  stdout: 'example response',
                  stderr: '',
                },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [terminalThread]),
      loadThread: vi.fn(async () => liveBootstrap(terminalThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-terminal-output"] button')));
    (runtime.querySelector('[data-thread-id="thread-terminal-output"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-activity-inline-row').length === 1);

    expect(runtime.querySelector('[data-flower-activity-item-id="terminal-real"]')).toBeTruthy();
    expect(runtime.textContent).toContain('curl -s https://example.com');
    (runtime.querySelector('[data-flower-activity-item-id="terminal-real"] .flower-activity-inline-button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('example response') ?? false);
    expect(runtime.textContent).toContain('example response');
  });

  it('allows approved terminal activity rows that required approval to expand', async () => {
    const terminalThread = thread({
      thread_id: 'thread-approved-terminal-output',
      title: 'Approved terminal output',
      created_at_ms: 6_710,
      updated_at_ms: 6_820,
      status: 'success',
      messages: [
        {
          id: 'm-approved-terminal-output',
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: 6_820,
          blocks: [
            activityTimeline({
              run_id: 'run-approved-terminal-output',
              turn_id: 'm-approved-terminal-output',
              items: [activityItem({
                item_id: 'terminal-approved',
                tool_id: 'terminal-approved',
                tool_name: 'terminal.exec',
                kind: 'tool',
                label: 'curl -s https://example.com/weather',
                renderer: 'terminal',
                requires_approval: true,
                approval_state: 'approved',
                payload: {
                  command: 'curl -s https://example.com/weather',
                  process_id: 'tp_approved_terminal',
                  exit_code: 0,
                  stdout: 'weather response',
                },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [terminalThread]),
      loadThread: vi.fn(async () => liveBootstrap(terminalThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-approved-terminal-output"] button')));
    (runtime.querySelector('[data-thread-id="thread-approved-terminal-output"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-activity-item-id="terminal-approved"]')));

    const row = runtime.querySelector('[data-flower-activity-item-id="terminal-approved"]') as HTMLElement;
    const button = row.querySelector('.flower-activity-inline-button') as HTMLButtonElement;
    expect(row.textContent).toContain('curl -s https://example.com/weather');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(row.querySelector('.flower-activity-inline-chevron')).toBeTruthy();

    button.click();
    await waitFor(() => row.textContent?.includes('weather response') ?? false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(row.textContent).toContain('approved');
    expect(row.textContent).toContain('weather response');
  });

  it('keeps currently waiting approval activity rows read-only', async () => {
    const approvalAction = {
      action_id: 'appr-terminal-readonly',
      origin: 'main_tool' as const,
      run_id: 'run-terminal-readonly',
      tool_id: 'terminal-readonly',
      tool_name: 'terminal.exec',
      state: 'requested' as const,
      status: 'pending' as const,
      revision: 1,
      version: 1,
      requested_at_ms: 6_840,
      can_approve: true,
      expected_seq: 14,
      summary: {
        label: 'curl -s https://example.com/pending',
        command: 'curl -s https://example.com/pending',
        effects: ['shell'],
      },
    };
    const terminalThread = thread({
      thread_id: 'thread-waiting-terminal-readonly',
      title: 'Waiting terminal output',
      created_at_ms: 6_830,
      updated_at_ms: 6_840,
      status: 'waiting_approval',
      approval_actions: [approvalAction],
      messages: [
        {
          id: 'm-terminal-readonly',
          role: 'assistant',
          content: '',
          status: 'streaming',
          created_at_ms: 6_840,
          blocks: [
            activityTimeline({
              run_id: 'run-terminal-readonly',
              turn_id: 'm-terminal-readonly',
              status: 'waiting',
              severity: 'blocking',
              needs_attention: true,
              items: [activityItem({
                item_id: 'terminal-readonly',
                tool_id: 'terminal-readonly',
                tool_name: 'terminal.exec',
                kind: 'tool',
                label: 'curl -s https://example.com/pending',
                renderer: 'terminal',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                requires_approval: true,
                approval_state: 'requested',
                payload: {
                  command: 'curl -s https://example.com/pending',
                  stdout: 'should not open from the activity row',
                },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [terminalThread]),
      loadThread: vi.fn(async () => liveBootstrap(terminalThread, 14)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-terminal-readonly"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-terminal-readonly"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-approval-action-id="appr-terminal-readonly"]')));

    const row = runtime.querySelector('[data-flower-activity-item-id="terminal-readonly"]') as HTMLElement;
    const button = row.querySelector('.flower-activity-inline-button') as HTMLButtonElement;
    expect(row.textContent).toContain('curl -s https://example.com/pending');
    expect(button.getAttribute('aria-expanded')).toBeNull();
    expect(row.querySelector('.flower-activity-inline-chevron')).toBeNull();

    button.click();
    expect(row.textContent).not.toContain('should not open from the activity row');
    expect(runtime.querySelector('.flower-composer [data-flower-approval-action-id="appr-terminal-readonly"]')).toBeTruthy();
  });

  it('refreshes inline activity when message block fields change in place', async () => {
    const runningActivity = activityTimeline({
      run_id: 'run-refresh-block',
      turn_id: 'm-refresh-block',
      status: 'running',
      severity: 'normal',
      needs_attention: true,
      items: [activityItem({
        item_id: 'tool-refresh',
        tool_id: 'tool-refresh',
        tool_name: 'terminal.exec',
        status: 'running',
        severity: 'normal',
        needs_attention: true,
        started_at_unix_ms: 6_000,
        label: 'npm test',
        renderer: 'terminal',
        payload: { command: 'npm test' },
      })],
    });
    const completeActivity = activityTimeline({
      run_id: 'run-refresh-block',
      turn_id: 'm-refresh-block',
      status: 'success',
      severity: 'quiet',
      needs_attention: false,
      items: [activityItem({
        item_id: 'tool-refresh',
        tool_id: 'tool-refresh',
        tool_name: 'terminal.exec',
        status: 'success',
        severity: 'quiet',
        needs_attention: false,
        started_at_unix_ms: 6_000,
        ended_at_unix_ms: 7_250,
        label: 'npm test',
        renderer: 'terminal',
        payload: { command: 'npm test', exit_code: 0 },
      })],
    });
    const runningThread = thread({
      thread_id: 'thread-refresh-block',
      title: 'Refresh block',
      created_at_ms: 6_000,
      updated_at_ms: 6_100,
      status: 'idle',
      messages: [
        {
          id: 'm-refresh-block',
          role: 'assistant',
          content: 'Running tests.',
          status: 'complete',
          created_at_ms: 6_100,
          blocks: [
            { type: 'markdown', content: 'Running tests.' },
            runningActivity,
          ],
        },
      ],
    });
    const completeThread = {
      ...runningThread,
      updated_at_ms: 6_200,
      status: 'success' as const,
      messages: [
        {
          id: 'm-refresh-block',
          role: 'assistant' as const,
          content: 'Running tests.\n\nTests passed.',
          status: 'complete' as const,
          created_at_ms: 6_100,
          blocks: [
            { type: 'markdown' as const, content: 'Running tests.' },
            completeActivity,
            { type: 'markdown' as const, content: 'Tests passed.' },
          ],
        },
      ],
    };
    let listSnapshot: readonly FlowerThreadSnapshot[] = [runningThread];
    const loadThread = vi.fn(async () => liveBootstrap(loadThread.mock.calls.length === 1 ? runningThread : completeThread));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => listSnapshot),
      loadThread,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-refresh-block"] button')));
    (runtime.querySelector('[data-thread-id="thread-refresh-block"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-activity-inline-row')?.getAttribute('data-flower-activity-status') === 'running');

    listSnapshot = [completeThread];
    (runtime.querySelector('.flower-thread-refresh-button') as HTMLButtonElement).click();

    await waitFor(() => runtime.querySelector('.flower-activity-inline-row')?.getAttribute('data-flower-activity-status') === 'success');
    expect(runtime.textContent).toContain('Done');
    expect(runtime.textContent).toContain('1s');
    expect(runtime.textContent).toContain('Tests passed.');
    expect(loadThread.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps waiting activity visible even if a timeline summary is marked digest', async () => {
    const waitingThread = thread({
      thread_id: 'thread-waiting-activity',
      title: 'Waiting activity',
      created_at_ms: 6_700,
      updated_at_ms: 6_900,
      status: 'waiting_user',
      messages: [
        {
          id: 'm-waiting',
          role: 'assistant',
          content: 'I need one choice.',
          status: 'complete',
          created_at_ms: 6_900,
          blocks: [
            { type: 'markdown', content: 'I need one choice.' },
            activityTimeline({
              run_id: 'run-waiting',
              turn_id: 'm-waiting',
              status: 'success',
              severity: 'quiet',
              needs_attention: true,
              items: [activityItem({
                item_id: 'tool-ask',
                tool_id: 'tool-ask',
                tool_name: 'ask_user',
                kind: 'control',
                label: 'Requested input',
                description: 'Choose a target before continuing.',
                renderer: 'question',
                status: 'waiting',
                severity: 'blocking',
                needs_attention: true,
                attention_reasons: ['waiting'],
                payload: {
                  reason_code: 'needs_user_choice',
                  required_from_user: ['target'],
                  questions: [{
                    id: 'target',
                    header: 'Target',
                    question: 'Choose a target before continuing.',
                  }],
                  contains_secret: false,
                },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [waitingThread]),
      loadThread: vi.fn(async () => liveBootstrap(waitingThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-waiting-activity"] button')));
    (runtime.querySelector('[data-thread-id="thread-waiting-activity"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.textContent?.includes('Requested input') ?? false);

    expect(runtime.querySelectorAll('.flower-activity-inline-row')).toHaveLength(1);
    expect(runtime.querySelector('.flower-activity-inline-button')?.getAttribute('aria-expanded')).toBe('true');
  });

  it.each([
    {
      name: 'running',
      status: 'running' as FlowerActivityStatus,
      severity: 'normal' as const,
    },
    {
      name: 'error',
      status: 'error' as FlowerActivityStatus,
      severity: 'error' as const,
      description: 'stderr includes a failing test.',
    },
    {
      name: 'approval',
      status: 'waiting' as FlowerActivityStatus,
      severity: 'blocking' as const,
      requires_approval: true,
      approval_state: 'requested' as const,
    },
  ])('keeps $name activity visible even if a timeline summary is marked digest', async (scenario) => {
    const attentionThread = thread({
      thread_id: `thread-${scenario.name}-activity`,
      title: `${scenario.name} activity`,
      created_at_ms: 6_910,
      updated_at_ms: 6_950,
      status: scenario.status === 'running' ? 'running' : scenario.status === 'error' ? 'failed' : 'waiting_user',
      messages: [
        {
          id: `m-${scenario.name}`,
          role: 'assistant',
          content: `Working on ${scenario.name}.`,
          status: scenario.status === 'error' ? 'error' : 'complete',
          created_at_ms: 6_950,
          blocks: [
            { type: 'markdown', content: `Working on ${scenario.name}.` },
            activityTimeline({
              run_id: `run-${scenario.name}`,
              turn_id: `m-${scenario.name}`,
              status: 'success',
              severity: 'quiet',
              needs_attention: true,
              items: [activityItem({
                item_id: `item-${scenario.name}`,
                tool_id: `tool-${scenario.name}`,
                tool_name: scenario.requires_approval ? 'terminal.exec' : 'shell.exec',
                kind: 'tool',
                label: `npm run check:${scenario.name}`,
                renderer: 'terminal',
                status: scenario.status,
                severity: scenario.severity,
                needs_attention: true,
                requires_approval: scenario.requires_approval ?? false,
                approval_state: scenario.approval_state,
                description: scenario.description,
                payload: {
                  command: `npm run check:${scenario.name}`,
                  ...(scenario.description ? { stderr: scenario.description } : {}),
                },
              })],
            }),
          ],
        },
      ],
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [attentionThread]),
      loadThread: vi.fn(async () => liveBootstrap(attentionThread)),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="thread-${scenario.name}-activity"] button`)));
    (runtime.querySelector(`[data-thread-id="thread-${scenario.name}-activity"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-activity-inline-row').length === 1);

    expect(runtime.querySelectorAll('.flower-activity-inline-row')).toHaveLength(1);
    if (scenario.requires_approval) {
      expect(runtime.querySelector('.flower-activity-inline-button')?.getAttribute('aria-expanded')).toBeNull();
    }
  });
});
