import '../index.css';

import { describe, expect, it, vi } from 'vitest';

import type { FlowerLiveEvent } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  deferred,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('Flower approval refresh browser behavior', () => {
  it('shows first-frame decision feedback without detaching the approval card', async () => {
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
    const card = composer.querySelector('[data-flower-approval-action-id="appr-browser-handoff"]') as HTMLElement;
    const buttons = Array.from(composer.querySelectorAll<HTMLButtonElement>('.flower-composer-approval-decision'));
    const approve = buttons.find((button) => button.textContent?.trim() === 'Approve')!;
    approve.focus();
    const focusedBorder = getComputedStyle(composer).borderColor;
    const focusedShadow = getComputedStyle(composer).boxShadow;
    let earlyDetachCount = 0;
    let earlyTextareaMountCount = 0;
    let blankComposerMutations = 0;
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const removed of record.removedNodes) {
          if (!projectionAllowed && (removed === card || removed instanceof Element && removed.contains(card))) {
            earlyDetachCount += 1;
          }
        }
      }
      if (!projectionAllowed && composer.querySelector('textarea')) earlyTextareaMountCount += 1;
      if (!composer.querySelector('[data-flower-composer-approval="true"]') && !composer.querySelector('textarea')) {
        blankComposerMutations += 1;
      }
    });
    observer.observe(composer, { childList: true, subtree: true });

    approve.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(composer.querySelector('[data-flower-approval-action-id="appr-browser-handoff"]')).toBe(card);
    expect(card.isConnected).toBe(true);
    expect(buttons.every((button) => button.disabled)).toBe(true);
    expect(approve.getAttribute('aria-busy')).toBe('true');
    expect(approve.getAttribute('data-loading')).toBe('true');
    expect(approve.querySelector('[data-floe-button-spinner="true"]')).not.toBeNull();
    expect(approve.textContent?.trim()).toBe('Approve');
    expect(composer.getAttribute('data-flower-approval-handoff-phase')).toBe('submitting');
    expect(getComputedStyle(composer).borderColor).toBe(focusedBorder);
    expect(getComputedStyle(composer).boxShadow).toBe(focusedShadow);
    expect(earlyDetachCount).toBe(0);
    expect(earlyTextareaMountCount).toBe(0);

    receipt.resolve({ ok: true, current_cursor: 11 });
    await waitFor(() => composer.getAttribute('data-flower-approval-handoff-phase') === 'awaiting_projection');
    expect(composer.querySelector('[data-flower-approval-action-id="appr-browser-handoff"]')).toBe(card);

    projectionAllowed = true;
    await waitFor(() => composer.querySelector('[data-flower-approval-action-id="appr-browser-handoff"]') === null);
    observer.disconnect();
    expect(composer.querySelector('textarea')).not.toBeNull();
    expect(earlyDetachCount).toBe(0);
    expect(earlyTextareaMountCount).toBe(0);
    expect(blankComposerMutations).toBe(0);
  });

  it('keeps one actionable approval card mounted while stale summaries continue polling', async () => {
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
    expect(listThreads.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(loadThread).toHaveBeenCalledTimes(1);

    const composer = runtime.querySelector('.flower-composer') as HTMLElement;
    let blankPromotionFrames = 0;
    const promotionObserver = new MutationObserver(() => {
      if (composer.querySelectorAll('[data-flower-composer-approval="true"]').length === 0) blankPromotionFrames += 1;
    });
    promotionObserver.observe(composer, { childList: true, subtree: true });
    eventPhase = 'promote';

    await waitFor(() => Boolean(runtime.querySelector('[data-flower-approval-action-id="appr-browser-locator"]')));
    promotionObserver.disconnect();
    expect(runtime.querySelector('[data-flower-approval-action-id="appr-browser-primary"]')).toBeNull();
    expect(runtime.querySelectorAll('.flower-composer [data-flower-composer-approval="true"]')).toHaveLength(1);
    expect(runtime.querySelector('[data-flower-approval-action-id="appr-browser-locator"]')?.textContent).toContain('2 / 2');
    expect(blankPromotionFrames).toBe(0);

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

    await waitFor(() => runtime.querySelector('[data-flower-approval-action-id="appr-browser-locator"]') === null);
    await new Promise((resolve) => window.setTimeout(resolve, 750));
    finalObserver.disconnect();
    expect(finalDetachCount).toBe(1);
    expect(runtime.querySelectorAll('.flower-composer [data-flower-composer-approval="true"]')).toHaveLength(0);
  });
});
