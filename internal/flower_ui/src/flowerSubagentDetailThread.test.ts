import { describe, expect, it } from 'vitest';

import type {
  FlowerRuntimeCurrentItem,
  FlowerSubagentDetail,
  FlowerSubagentSummary,
} from './contracts/flowerSurfaceContracts';
import { projectSubagentDetailThread } from './flowerSubagentDetailThread';

const baseSummary: FlowerSubagentSummary = {
  parent_thread_id: 'parent-1',
  thread_id: 'child-1',
  task_name: 'Review boundary', title: 'Review boundary', title_status: 'ready' as const, title_generation: 1,
  agent_type: 'reviewer',
  status: 'running',
  can_send_input: false,
  can_interrupt: false,
  can_close: true,
  created_at_ms: 100,
  updated_at_ms: 500,
};

function item(overrides: Partial<FlowerRuntimeCurrentItem> = {}): FlowerRuntimeCurrentItem {
  return {
    id: 'assistant-turn-1',
    turn_id: 'turn-1',
    run_id: 'run-1',
    ordinal: 1,
    kind: 'assistant',
    text: 'Canonical assistant answer.',
    created_at: new Date(200).toISOString(),
    ...overrides,
  };
}

function detail(overrides: Partial<FlowerSubagentDetail> = {}): FlowerSubagentDetail {
  return {
    summary: baseSummary,
    current: {
      thread_id: 'child-1',
      view_version: 7,
      activity: 'idle',
      turn_id: 'turn-1',
      last_outcome: 'completed',
      items: [item()],
    },
    ...overrides,
  };
}

describe('projectSubagentDetailThread', () => {
  it('retains child history across 300 live tail snapshots and refreshes real facts', () => {
    const source = detail();
    let previous = projectSubagentDetailThread(source);
    const history = previous!.messages[0];
    for (let version = 8; version <= 307; version += 1) {
      previous = projectSubagentDetailThread({ ...source, current: { ...source.current, view_version: version, items: [item(), item({ id: 'tail', text: `Tail ${version}` })] } }, previous);
      expect(previous!.messages[0]).toBe(history);
      expect(previous!.messages[1]!.content).toBe(`Tail ${version}`);
    }
    const replaced = projectSubagentDetailThread({ ...source, current: { ...source.current, items: [item({ run_id: 'replacement', text: 'Changed history' })] } }, previous);
    expect(replaced!.messages[0]).not.toBe(history);
    expect(replaced!.messages[0]!.content).toBe('Changed history');
  });
  it('projects the complete typed Floret current without rebuilding or reordering it', () => {
    const projected = projectSubagentDetailThread(detail({
      current: {
        thread_id: 'child-1',
        view_version: 8,
        activity: 'idle',
        turn_id: 'turn-2',
        last_outcome: 'completed',
        items: [
          item({ id: 'assistant-turn-2', turn_id: 'turn-2', run_id: 'run-2', ordinal: 3, text: 'Second answer.' }),
          item({ id: 'user-turn-1', kind: 'user', ordinal: 2, text: 'Visible follow-up input.' }),
          item(),
        ],
      },
    }));

    expect(projected?.messages.map((entry) => entry.id)).toEqual([
      'assistant-turn-2',
      'user-turn-1',
      'assistant-turn-1',
    ]);
    expect(projected?.messages.map((entry) => entry.content)).toEqual([
      'Second answer.',
      'Visible follow-up input.',
      'Canonical assistant answer.',
    ]);
    expect(projected?.status).toBe('success');
  });

  it('uses current lifecycle state instead of stale summary fallbacks', () => {
    const projected = projectSubagentDetailThread(detail({
      summary: {
        ...baseSummary,
        status: 'running',
        last_message: 'Summary is not conversation history.',
        waiting_prompt: 'Diagnostic waiting prompt.',
      },
      current: {
        thread_id: 'child-1',
        view_version: 9,
        activity: 'idle',
        turn_id: 'turn-1',
        last_outcome: 'failed',
        error: 'Visible failure.',
        items: [],
      },
    }));

    expect(projected?.status).toBe('failed');
    expect(projected?.messages).toEqual([]);
    expect(JSON.stringify(projected)).not.toContain('Summary is not conversation history.');
    expect(JSON.stringify(projected)).not.toContain('Diagnostic waiting prompt.');
  });

  it('rejects missing or conflicting canonical identity', () => {
    expect(projectSubagentDetailThread(detail({
      summary: { ...baseSummary, task_name: '  ' },
    }))).toBeNull();
    expect(projectSubagentDetailThread(detail({
      current: { thread_id: 'other-child', view_version: 1 },
    }))).toBeNull();
    expect(projectSubagentDetailThread(null)).toBeNull();
  });
});
