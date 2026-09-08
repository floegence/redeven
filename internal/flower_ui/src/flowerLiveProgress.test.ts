import { describe, expect, it } from 'vitest';

import type {
  FlowerRunProgressPhase,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { flowerRunProgress } from './flowerLiveProgress';

function thread(overrides: Partial<FlowerThreadSnapshot> = {}): FlowerThreadSnapshot {
  return {
    thread_id: 'thread-live', title: 'Live task', title_status: 'ready', title_generation: 1, model_id: 'model', working_dir: '/',
    settings_revision: 1, created_at_ms: 1, updated_at_ms: 2, status: 'running', active_run_id: 'run-live',
    run_progress: { phase: 'waiting_response', run_id: 'run-live', turn_id: 'turn-live' },
    source_label: 'local', target_labels: [], messages: [],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 1 },
      read_state: { last_seen_activity_revision: 1 },
    },
    ...overrides,
  };
}

describe('flowerRunProgress', () => {
  it.each([
    'preparing',
    'waiting_response',
    'streaming',
    'retrying',
    'finalizing',
    'tool_execution',
  ] as const)('passes through the upstream %s phase', (phase: FlowerRunProgressPhase) => {
    expect(flowerRunProgress(thread({
      run_progress: { phase, run_id: 'run-live', turn_id: 'turn-live' },
    }))).toEqual({
      kind: phase,
      runID: 'run-live',
      turnID: 'turn-live',
      identity: 'thread-live\x1frun-live',
    });
  });

  it('does not infer progress from messages or thread activity', () => {
    expect(flowerRunProgress(thread({ run_progress: null }))).toBeNull();
    expect(flowerRunProgress(thread({ status: 'waiting_approval', run_progress: null }))).toBeNull();
    expect(flowerRunProgress(thread({ status: 'success', active_run_id: undefined, run_progress: null }))).toBeNull();
  });

  it('rejects progress from a different run', () => {
    expect(() => flowerRunProgress(thread({
      active_run_id: 'run-new',
      run_progress: { phase: 'streaming', run_id: 'run-old', turn_id: 'turn-live' },
    }))).toThrow(/active run identity/);
  });
});
