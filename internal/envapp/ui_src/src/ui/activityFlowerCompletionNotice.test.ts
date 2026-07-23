import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FlowerCompanionPresenceProjection } from '../../../../flower_ui/src';
import {
  ActivityFlowerCompletionNoticeController,
  activityFlowerCompletionUpdatesAllowed,
  type ActivityFlowerCompletionNotice,
} from './activityFlowerCompletionNotice';

function presence(overrides: Partial<FlowerCompanionPresenceProjection> = {}): FlowerCompanionPresenceProjection {
  return {
    priority_status: 'idle',
    priority_count: 0,
    attention_count: 0,
    unread_failed_count: 0,
    running_count: 0,
    queued_count: 0,
    unread_canceled_count: 0,
    unread_completed_count: 0,
    ...overrides,
  };
}

const running = () => presence({
  priority_status: 'running',
  priority_count: 1,
  priority_thread_id: 'thread-1',
  priority_run_id: 'run-1',
  priority_run_generation: 7,
  priority_thread_title: 'Refine the companion',
  running_count: 1,
});

describe('ActivityFlowerCompletionNoticeController', () => {
  let changes: Array<ActivityFlowerCompletionNotice | null>;
  let controller: ActivityFlowerCompletionNoticeController;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    changes = [];
    controller = new ActivityFlowerCompletionNoticeController({ onChange: (notice) => changes.push(notice) });
  });

  it('allows updates only for the accessible collapsed companion', () => {
    expect(activityFlowerCompletionUpdatesAllowed(false, 'collapsed')).toBe(true);
    expect(activityFlowerCompletionUpdatesAllowed(false, 'expanded')).toBe(false);
    expect(activityFlowerCompletionUpdatesAllowed(false, 'full_page')).toBe(false);
    expect(activityFlowerCompletionUpdatesAllowed(true, 'collapsed')).toBe(false);
  });

  afterEach(() => {
    controller.dispose();
    vi.useRealTimers();
  });

  it('does not acknowledge initial historical completion or queued-only work', () => {
    controller.update(presence({ priority_status: 'completed', unread_completed_count: 1 }));
    controller.update(presence({ priority_status: 'queued', queued_count: 1 }));
    controller.update(presence({
      terminal_transition: { thread_id: 'thread-1', run_id: 'run-1', run_generation: 7, outcome: 'completed' },
    }));
    expect(changes.filter(Boolean)).toHaveLength(0);
  });

  it('shows one 3.8 second notice for the matching successful running transition', () => {
    controller.update(running());
    controller.update(presence());
    vi.advanceTimersByTime(1_800);
    controller.update(presence({
      terminal_transition: { thread_id: 'thread-1', run_id: 'run-1', run_generation: 7, outcome: 'completed' },
    }));
    expect(changes.at(-1)).toMatchObject({ threadID: 'thread-1', runID: 'run-1', title: 'Refine the companion' });

    vi.advanceTimersByTime(2_000);
    controller.update(presence({
      terminal_transition: { thread_id: 'thread-1', run_id: 'run-1', run_generation: 7, outcome: 'completed' },
    }));
    vi.advanceTimersByTime(1_799);
    expect(changes.at(-1)).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(changes.at(-1)).toBeNull();
  });

  it.each(['failed', 'canceled'] as const)('does not show a notice for %s', (outcome) => {
    controller.update(running());
    controller.update(presence({
      terminal_transition: { thread_id: 'thread-1', run_id: 'run-1', run_generation: 7, outcome },
    }));
    expect(changes.filter(Boolean)).toHaveLength(0);
  });

  it('rejects mismatched, expired, and active-success transitions', () => {
    controller.update(running());
    controller.update(presence({
      terminal_transition: { thread_id: 'thread-1', run_id: 'other-run', run_generation: 7, outcome: 'completed' },
    }));
    vi.advanceTimersByTime(5_001);
    controller.update(presence({
      terminal_transition: { thread_id: 'thread-1', run_id: 'run-1', run_generation: 7, outcome: 'completed' },
    }));
    controller.update(running());
    controller.update(presence({
      priority_status: 'queued',
      queued_count: 1,
      terminal_transition: { thread_id: 'thread-1', run_id: 'run-1', run_generation: 7, outcome: 'completed' },
    }));
    expect(changes.filter(Boolean)).toHaveLength(0);
  });

  it.each([
    presence({ priority_status: 'queued', priority_count: 1, queued_count: 1 }),
    presence({ priority_status: 'unavailable', priority_count: 1 }),
  ])('drops an old candidate when work becomes queued-only or unavailable', (interruption) => {
    controller.update(running());
    controller.update(interruption);
    controller.update(presence());
    controller.update(presence({
      terminal_transition: { thread_id: 'thread-1', run_id: 'run-1', run_generation: 7, outcome: 'completed' },
    }));
    expect(changes.filter(Boolean)).toHaveLength(0);
  });

  it('allows old failed and attention history while no active work remains', () => {
    controller.update(running());
    controller.update(presence({
      priority_status: 'attention',
      attention_count: 1,
      unread_failed_count: 2,
      terminal_transition: { thread_id: 'thread-1', run_id: 'run-1', run_generation: 7, outcome: 'completed' },
    }));
    expect(changes.at(-1)).toMatchObject({ runID: 'run-1' });
  });

  it('does not carry a previous candidate title into a newer run', () => {
    controller.update(running());
    controller.update(presence({
      priority_status: 'running',
      priority_count: 1,
      priority_thread_id: 'thread-2',
      priority_run_id: 'run-2',
      priority_run_generation: 8,
      running_count: 1,
    }));
    controller.update(presence({
      terminal_transition: { thread_id: 'thread-2', run_id: 'run-2', run_generation: 8, outcome: 'completed' },
    }));
    expect(changes.at(-1)).toMatchObject({ threadID: 'thread-2', runID: 'run-2' });
    expect(changes.at(-1)?.title).toBeUndefined();
  });

  it('keeps a newer notice when canceled callbacks from an older generation still run', () => {
    const callbacks: Array<() => void> = [];
    const manualChanges: Array<ActivityFlowerCompletionNotice | null> = [];
    controller.dispose();
    controller = new ActivityFlowerCompletionNoticeController({
      onChange: (notice) => manualChanges.push(notice),
      setTimer: (callback) => {
        callbacks.push(callback);
        return callbacks.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => undefined,
    });
    controller.update(running());
    controller.update(presence({
      terminal_transition: { thread_id: 'thread-1', run_id: 'run-1', run_generation: 7, outcome: 'completed' },
    }));
    const staleNoticeTimer = callbacks[1];
    controller.update(presence({
      priority_status: 'running',
      priority_count: 1,
      priority_thread_id: 'thread-2',
      priority_run_id: 'run-2',
      priority_run_generation: 8,
      running_count: 1,
    }));
    controller.update(presence({
      terminal_transition: { thread_id: 'thread-2', run_id: 'run-2', run_generation: 8, outcome: 'completed' },
    }));
    const currentNoticeTimer = callbacks[3];
    expect(manualChanges.at(-1)).toMatchObject({ runID: 'run-2' });
    staleNoticeTimer();
    expect(manualChanges.at(-1)).toMatchObject({ runID: 'run-2' });
    currentNoticeTimer();
    expect(manualChanges.at(-1)).toBeNull();

    const changesBeforeDispose = manualChanges.length;
    controller.dispose();
    callbacks.forEach((callback) => callback());
    expect(manualChanges).toHaveLength(changesBeforeDispose + 1);
  });
});
