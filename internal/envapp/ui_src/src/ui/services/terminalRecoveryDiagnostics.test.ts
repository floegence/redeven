// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getDebugConsoleClientEventRingSnapshot,
  resetDebugConsoleCaptureForTests,
} from './debugConsoleCapture';
import {
  markTerminalRecoveryMilestone,
  publishTerminalRecoveryEvent,
  resetTerminalRecoveryDiagnosticsForTests,
  startTerminalRecoveryTrace,
  terminalRecoveryDiagnosticsQuery,
} from './terminalRecoveryDiagnostics';

afterEach(() => {
  resetTerminalRecoveryDiagnosticsForTests();
  resetDebugConsoleCaptureForTests();
  vi.restoreAllMocks();
});

describe('terminalRecoveryDiagnostics', () => {
  it('correlates runtime, surface, coordinator, and history generations without exposing session identity', () => {
    vi.spyOn(performance, 'now').mockReturnValue(125);
    const trace = startTerminalRecoveryTrace('private-session-id', 'panel');

    publishTerminalRecoveryEvent(trace, 'baseline_ready', {
      runtime_attach_generation: 6,
      coordinator_attach_generation: 4,
      history_generation: 8,
      history_page_count: 2,
      history_chunk_count: 6,
      history_bytes: 512,
      covered_through_sequence: 12,
    });

    const event = getDebugConsoleClientEventRingSnapshot().events.at(-1);
    expect(event?.trace_id).toBe('terminal-recovery-terminal-001-1');
    expect(event?.detail).toMatchObject({
      schema_version: 1,
      session_ref: 'terminal-001',
      surface_generation: 1,
      runtime_attach_generation: 6,
      coordinator_attach_generation: 4,
      history_generation: 8,
    });
    expect(JSON.stringify(event)).not.toContain('private-session-id');

    expect(startTerminalRecoveryTrace('private-session-id', 'workbench')).toMatchObject({
      sessionRef: 'terminal-001',
      surfaceGeneration: 2,
    });
  });

  it('emits renderer-local performance marks with sanitized detail', () => {
    const mark = vi.spyOn(performance, 'mark').mockImplementation(() => ({}) as PerformanceMark);
    const clearMarks = vi.spyOn(performance, 'clearMarks');
    const trace = startTerminalRecoveryTrace('private-session-id', 'panel');

    markTerminalRecoveryMilestone(trace, 'interactive', {
      runtime_attach_generation: 5,
      coordinator_attach_generation: 3,
      history_generation: 7,
    });

    expect(mark).toHaveBeenCalledWith('redeven:terminal:interactive:terminal-recovery-terminal-001-1', {
      detail: expect.objectContaining({
        session_ref: 'terminal-001',
        surface_generation: 1,
        runtime_attach_generation: 5,
        coordinator_attach_generation: 3,
        history_generation: 7,
      }),
    });
    expect(clearMarks).not.toHaveBeenCalled();
    expect(JSON.stringify(mark.mock.calls)).not.toContain('private-session-id');
  });

  it('retains interleaved surface milestones for trace-scoped consumers', () => {
    const mark = vi.spyOn(performance, 'mark').mockImplementation(() => ({}) as PerformanceMark);
    const panelTrace = startTerminalRecoveryTrace('private-session-id', 'panel');
    const workbenchTrace = startTerminalRecoveryTrace('private-session-id', 'workbench');

    markTerminalRecoveryMilestone(panelTrace, 'baseline-parser-committed');
    markTerminalRecoveryMilestone(workbenchTrace, 'baseline-parser-committed');

    expect(mark).toHaveBeenCalledTimes(2);
    expect(mark.mock.calls.map((call) => call[1]?.detail)).toEqual([
      expect.objectContaining({ variant: 'panel', surface_generation: 1 }),
      expect.objectContaining({ variant: 'workbench', surface_generation: 2 }),
    ]);
    expect(terminalRecoveryDiagnosticsQuery(panelTrace, 'history_fetch_failed')).toBe(
      'terminal-001 1 history_fetch_failed',
    );
    expect(terminalRecoveryDiagnosticsQuery(workbenchTrace, 'history_contract_missing')).toBe(
      'terminal-001 2 history_contract_missing',
    );
  });
});
