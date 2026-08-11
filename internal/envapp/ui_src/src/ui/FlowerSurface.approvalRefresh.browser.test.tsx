import '../index.css';

import { describe, expect, it, vi } from 'vitest';

import type { FlowerLiveEvent } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  deferred,
  flowerSurfaceNotifications,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

function approvalScenario(suffix: string) {
  const action = {
    action_id: `appr-${suffix}`,
    origin: 'main_tool' as const,
    run_id: `run-${suffix}`,
    tool_id: `tool-${suffix}`,
    tool_name: 'terminal.exec',
    state: 'requested' as const,
    status: 'pending' as const,
    revision: 1,
    version: 1,
    surface_epoch: 1,
    surface_role: 'primary_action' as const,
    requested_at_ms: 9_000,
    can_approve: true,
    expected_seq: 10,
    queue_generation: 1,
    queue_order: 1,
    batch_index: 0,
    batch_size: 1,
    summary: { label: 'Approval command', command: 'npm test', effects: ['shell'] },
  };
  return {
    action,
    snapshot: thread({
      thread_id: `thread-${suffix}`,
      title: 'Approval recovery',
      status: 'waiting_approval',
      active_run_id: action.run_id,
      approval_actions: [action],
      approval_queue: {
        generation: 1,
        revision: 1,
        current_action_id: action.action_id,
        current_position: 1,
        total: 1,
        unresolved_count: 1,
      },
    }),
  };
}

describe('Flower approval refresh browser behavior', () => {
  it('exits approval mode on the first frame while the rejection receipt is blocked', async () => {
    const approvalAction = {
      action_id: 'appr-browser-handoff',
      origin: 'main_tool' as const,
      run_id: 'run-browser-handoff',
      tool_id: 'tool-browser-handoff',
      tool_name: 'terminal.exec',
      state: 'requested' as const,
      status: 'pending' as const,
      revision: 1,
      version: 1,
      surface_epoch: 1,
      surface_role: 'primary_action' as const,
      requested_at_ms: 9_000,
      can_approve: true,
      expected_seq: 10,
      queue_generation: 1,
      queue_order: 1,
      batch_index: 0,
      batch_size: 1,
      summary: {
        label: 'Browser handoff command',
        command: 'npm run test:browser',
        effects: ['shell'],
      },
    };
    const approvalThread = thread({
      thread_id: 'thread-browser-handoff',
      title: 'Browser approval handoff',
      status: 'waiting_approval',
      active_run_id: approvalAction.run_id,
      approval_actions: [approvalAction],
      approval_queue: {
        generation: 1,
        revision: 1,
        current_action_id: approvalAction.action_id,
        current_position: 1,
        total: 1,
        unresolved_count: 1,
      },
    });
    const receipt = deferred<{ ok: boolean; current_cursor: number }>();
    let projectionAllowed = false;
    let projectionDelivered = false;
    const listThreadLiveEvents = vi.fn(async (_threadID: string, afterSeq: number) => {
      if (projectionAllowed && !projectionDelivered) {
        projectionDelivered = true;
        return {
          stream_generation: 1,
          events: [{
            schema_version: 1,
            seq: 11,
            endpoint_id: 'test-runtime',
            thread_id: approvalThread.thread_id,
            run_id: approvalAction.run_id,
            at_unix_ms: 9_010,
            kind: 'approval.resolved',
            payload: {
              action: { ...approvalAction, state: 'approved', status: 'resolved', can_approve: false, resolved_at_ms: 9_010 },
              approval_queue: { generation: 1, revision: 2, current_action_id: '', current_position: 0, total: 1, unresolved_count: 0 },
            },
          }] satisfies FlowerLiveEvent[],
          next_cursor: 11,
          retained_from_seq: 1,
        };
      }
      return { stream_generation: 1, events: [], next_cursor: afterSeq, retained_from_seq: 1 };
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [approvalThread]),
      loadThread: vi.fn(async () => liveBootstrap(approvalThread, 10)),
      listThreadLiveEvents,
      submitApproval: vi.fn(() => receipt.promise),
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-browser-handoff"] button')));
    (runtime.querySelector('[data-thread-id="thread-browser-handoff"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer [data-flower-approval-action-id="appr-browser-handoff"]')));

    const composer = runtime.querySelector('.flower-composer') as HTMLElement;
    const buttons = Array.from(composer.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'));
    const reject = buttons.find((button) => button.textContent?.trim() === 'Reject')!;
    reject.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(composer.querySelector('[data-flower-approval-action-id="appr-browser-handoff"]')).toBeNull();
    expect(composer.querySelector('textarea')).not.toBeNull();
    expect(composer.getAttribute('data-flower-bottom-mode')).toBe('chat');
    expect(composer.getAttribute('aria-busy')).toBeNull();
    expect(composer.querySelector('[data-flower-primary-action="stop"]')).not.toBeNull();
    expect(runtime.textContent).not.toContain('Flower could not finish this reply.');

    receipt.resolve({ ok: true, current_cursor: 11 });
    projectionAllowed = true;
    await waitFor(() => listThreadLiveEvents.mock.calls.length > 1);
    expect(composer.querySelector('textarea')).not.toBeNull();
    expect(composer.querySelector('[data-flower-approval-action-id="appr-browser-handoff"]')).toBeNull();
  });

  it('restores the canonical card only when the decision failed and remains requested', async () => {
    const { action, snapshot } = approvalScenario('request-failed');
    const loadThread = vi.fn(async () => liveBootstrap(snapshot, 10));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [snapshot]),
      loadThread,
      submitApproval: vi.fn(async () => { throw new Error('approval transport failed'); }),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${snapshot.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${snapshot.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector(`[data-flower-approval-action-id="${action.action_id}"]`)));
    const reject = Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'))
      .find((button) => button.textContent?.trim() === 'Reject')!;
    reject.click();
    expect(runtime.querySelector(`[data-flower-approval-action-id="${action.action_id}"]`)).toBeNull();

    await waitFor(() => loadThread.mock.calls.length === 2);
    await waitFor(() => Boolean(runtime.querySelector(`[data-flower-approval-action-id="${action.action_id}"]`)));
    expect(Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'))
      .every((button) => !button.disabled)).toBe(true);
    expect(flowerSurfaceNotifications()).toEqual([
      expect.objectContaining({ tone: 'error', message: 'approval transport failed' }),
    ]);
  });

  it('restores a failed decision after switching A to B and back without reviving a settled card', async () => {
    const { action, snapshot } = approvalScenario('background-failure');
    const background = thread({
      thread_id: 'thread-background-during-approval',
      title: 'Background thread',
      status: 'idle',
      messages: [],
    });
    const receipt = deferred<{ ok: boolean; current_cursor: number }>();
    const loadThread = vi.fn(async (threadID: string) => liveBootstrap(
      threadID === snapshot.thread_id ? snapshot : background,
      threadID === snapshot.thread_id ? 10 : 3,
    ));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [snapshot, background]),
      loadThread,
      submitApproval: vi.fn(() => receipt.promise),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${snapshot.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${snapshot.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector(`[data-flower-approval-action-id="${action.action_id}"]`)));
    const reject = Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'))
      .find((button) => button.textContent?.trim() === 'Reject')!;
    reject.click();
    expect(runtime.querySelector(`[data-flower-approval-action-id="${action.action_id}"]`)).toBeNull();

    (runtime.querySelector(`[data-thread-id="${background.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('#redeven-flower-surface')?.getAttribute('data-flower-selected-thread-id') === background.thread_id);
    receipt.reject(new Error('approval failed in background'));
    await waitFor(() => loadThread.mock.calls.filter(([threadID]) => threadID === snapshot.thread_id).length >= 2);

    (runtime.querySelector(`[data-thread-id="${snapshot.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector(`[data-flower-approval-action-id="${action.action_id}"]`)));
    expect(Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'))
      .every((button) => !button.disabled)).toBe(true);
    expect(runtime.querySelector('.flower-composer')?.getAttribute('aria-busy')).toBeNull();
  });

  it('treats a lost response as settled when canonical bootstrap is already rejected', async () => {
    const { action, snapshot } = approvalScenario('response-lost');
    const settled = {
      ...snapshot,
      status: 'running' as const,
      approval_actions: [],
      approval_queue: { ...snapshot.approval_queue!, current_action_id: '', current_position: 0, unresolved_count: 0, revision: 2 },
    };
    const loadThread = vi.fn(async () => (
      loadThread.mock.calls.length === 1 ? liveBootstrap(snapshot, 10) : liveBootstrap(settled, 11)
    ));
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [snapshot]),
      loadThread,
      submitApproval: vi.fn(async () => { throw new Error('response connection closed'); }),
    });

    await waitFor(() => Boolean(runtime.querySelector(`[data-thread-id="${snapshot.thread_id}"] button`)));
    (runtime.querySelector(`[data-thread-id="${snapshot.thread_id}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector(`[data-flower-approval-action-id="${action.action_id}"]`)));
    const reject = Array.from(runtime.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'))
      .find((button) => button.textContent?.trim() === 'Reject')!;
    reject.click();

    await waitFor(() => loadThread.mock.calls.length === 2);
    expect(runtime.querySelector(`[data-flower-approval-action-id="${action.action_id}"]`)).toBeNull();
    expect(runtime.querySelector('.flower-composer textarea')).not.toBeNull();
    expect(flowerSurfaceNotifications()).toEqual([]);
  });

  it('keeps one actionable approval card mounted while stale summaries remain unchanged', async () => {
    const primaryAction = {
      action_id: 'appr-browser-primary',
      origin: 'main_tool' as const,
      run_id: 'run-browser-approval-refresh',
      tool_id: 'tool-browser-primary',
      tool_name: 'terminal.exec',
      state: 'requested' as const,
      status: 'pending' as const,
      revision: 1,
      version: 1,
      surface_epoch: 1,
      surface_role: 'primary_action' as const,
      requested_at_ms: 10_000,
      can_approve: true,
      expected_seq: 50,
      queue_generation: 1,
      queue_order: 1,
      batch_index: 0,
      batch_size: 2,
      summary: {
        label: 'Primary browser command',
        command: 'curl -fsS https://example.test/primary',
        effects: ['shell'],
      },
    };
    const locatorAction = {
      ...primaryAction,
      action_id: 'appr-browser-locator',
      tool_id: 'tool-browser-locator',
      surface_role: 'locator' as const,
      can_approve: false,
      expected_seq: 51,
      queue_order: 2,
      batch_index: 1,
      summary: {
        label: 'Queued browser command',
        command: 'curl -fsS https://example.test/queued',
        effects: ['shell'],
      },
    };
    const approvalThread = thread({
      thread_id: 'thread-browser-approval-refresh',
      title: 'Browser approval refresh',
      status: 'waiting_approval',
      approval_actions: [primaryAction, locatorAction],
      approval_queue: {
        generation: 1,
        revision: 2,
        current_action_id: primaryAction.action_id,
        current_position: 1,
        total: 2,
        unresolved_count: 2,
      },
    });
    const staleSummary = {
      ...approvalThread,
      status: 'running' as const,
      messages: [],
      approval_actions: undefined,
      approval_queue: undefined,
    };
    const backgroundThread = thread({
      thread_id: 'thread-browser-background',
      title: 'Browser background run',
      status: 'running',
      messages: [],
    });
    const listThreads = vi.fn(async () => [staleSummary, backgroundThread]);
    const loadThread = vi.fn(async () => liveBootstrap(approvalThread, 51));
    let eventPhase: 'stable' | 'promote' | 'resolve' = 'stable';
    let promotionDelivered = false;
    let resolutionDelivered = false;
    const listThreadLiveEvents = vi.fn(async (_threadID: string, afterSeq: number) => {
      if (eventPhase === 'promote' && !promotionDelivered) {
        promotionDelivered = true;
        return {
          stream_generation: 1,
          events: [{
            schema_version: 1,
            seq: 52,
            endpoint_id: 'test-runtime',
            thread_id: approvalThread.thread_id,
            run_id: primaryAction.run_id,
            at_unix_ms: 10_100,
            kind: 'approval.resolved',
            payload: {
              action: { ...primaryAction, state: 'approved', status: 'resolved', can_approve: false, resolved_at_ms: 10_100 },
              approval_queue: { generation: 1, revision: 3, current_action_id: locatorAction.action_id, current_position: 2, total: 2, unresolved_count: 1 },
            },
          }, {
            schema_version: 1,
            seq: 53,
            endpoint_id: 'test-runtime',
            thread_id: approvalThread.thread_id,
            run_id: locatorAction.run_id,
            at_unix_ms: 10_101,
            kind: 'approval.requested',
            payload: {
              action: { ...locatorAction, surface_role: 'primary_action', can_approve: true, expires_at_ms: 70_101 },
              approval_queue: { generation: 1, revision: 3, current_action_id: locatorAction.action_id, current_position: 2, total: 2, unresolved_count: 1 },
            },
          }] satisfies FlowerLiveEvent[],
          next_cursor: 53,
          retained_from_seq: 1,
        };
      }
      if (eventPhase === 'resolve' && !resolutionDelivered) {
        resolutionDelivered = true;
        return {
          stream_generation: 1,
          events: [{
            schema_version: 1,
            seq: 54,
            endpoint_id: 'test-runtime',
            thread_id: approvalThread.thread_id,
            run_id: locatorAction.run_id,
            at_unix_ms: 10_200,
            kind: 'approval.resolved',
            payload: {
              action: { ...locatorAction, state: 'approved', status: 'resolved', can_approve: false, resolved_at_ms: 10_200 },
              approval_queue: { generation: 1, revision: 4, current_action_id: '', current_position: 0, total: 2, unresolved_count: 0 },
            },
          }] satisfies FlowerLiveEvent[],
          next_cursor: 54,
          retained_from_seq: 1,
        };
      }
      return {
        stream_generation: 1,
        events: [],
        next_cursor: afterSeq,
        retained_from_seq: 1,
      };
    });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads,
      loadThread,
      listThreadLiveEvents,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-browser-approval-refresh"] button')));
    (runtime.querySelector('[data-thread-id="thread-browser-approval-refresh"] button') as HTMLButtonElement).click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-approval-action-id="appr-browser-primary"]')));

    const initialCard = runtime.querySelector('[data-flower-approval-action-id="appr-browser-primary"]') as HTMLElement;
    let detachCount = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const removed of record.removedNodes) {
          if (removed === initialCard || removed instanceof Element && removed.contains(initialCard)) detachCount += 1;
        }
      }
    });
    observer.observe(runtime, { childList: true, subtree: true });

    await new Promise((resolve) => window.setTimeout(resolve, 4_000));
    observer.disconnect();

    expect(runtime.querySelector('[data-flower-approval-action-id="appr-browser-primary"]')).toBe(initialCard);
    expect(runtime.querySelectorAll('.flower-composer [data-flower-composer-approval="true"]')).toHaveLength(1);
    expect(runtime.querySelector('.flower-composer textarea')).toBeNull();
    expect(initialCard.textContent).toContain('1 / 2');
    expect(detachCount).toBe(0);
    expect(listThreads).toHaveBeenCalledTimes(1);
    expect(listThreadLiveEvents.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(loadThread).toHaveBeenCalledTimes(1);

    const composer = runtime.querySelector('.flower-composer') as HTMLElement;
    eventPhase = 'promote';

    await waitFor(
      () => Boolean(runtime.querySelector('[data-flower-approval-action-id="appr-browser-locator"]')),
      7_000,
    );
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(runtime.querySelector('[data-flower-approval-action-id="appr-browser-primary"]')).toBeNull();
    expect(runtime.querySelectorAll('.flower-composer [data-flower-composer-approval="true"]')).toHaveLength(1);
    expect(runtime.querySelector('[data-flower-approval-action-id="appr-browser-locator"]')?.textContent).toContain('2 / 2');
    expect(composer.querySelectorAll('[data-flower-composer-approval="true"]')).toHaveLength(1);

    const promotedCard = runtime.querySelector('[data-flower-approval-action-id="appr-browser-locator"]') as HTMLElement;
    let finalDetachCount = 0;
    const finalObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const removed of record.removedNodes) {
          if (removed === promotedCard || removed instanceof Element && removed.contains(promotedCard)) finalDetachCount += 1;
        }
      }
    });
    finalObserver.observe(runtime, { childList: true, subtree: true });
    eventPhase = 'resolve';

    await waitFor(
      () => runtime.querySelector('[data-flower-approval-action-id="appr-browser-locator"]') === null,
      7_000,
    );
    await new Promise((resolve) => window.setTimeout(resolve, 750));
    finalObserver.disconnect();
    expect(finalDetachCount).toBe(1);
    expect(runtime.querySelectorAll('.flower-composer [data-flower-composer-approval="true"]')).toHaveLength(0);
  });
});
