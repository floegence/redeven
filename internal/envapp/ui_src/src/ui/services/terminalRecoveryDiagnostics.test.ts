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
} from './terminalRecoveryDiagnostics';

afterEach(() => {
  resetTerminalRecoveryDiagnosticsForTests();
  resetDebugConsoleCaptureForTests();
  vi.restoreAllMocks();
});

describe('terminalRecoveryDiagnostics', () => {
  it('separates surface, coordinator, and history generations without exposing session identity', () => {
    vi.spyOn(performance, 'now').mockReturnValue(125);
    const trace = startTerminalRecoveryTrace('private-session-id', 'panel');

    publishTerminalRecoveryEvent(trace, 'baseline_ready', {
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
    const trace = startTerminalRecoveryTrace('private-session-id', 'panel');

    markTerminalRecoveryMilestone(trace, 'interactive', {
      coordinator_attach_generation: 3,
      history_generation: 7,
    });

    expect(mark).toHaveBeenCalledWith('redeven:terminal:interactive', {
      detail: expect.objectContaining({
        session_ref: 'terminal-001',
        surface_generation: 1,
        coordinator_attach_generation: 3,
        history_generation: 7,
      }),
    });
    expect(JSON.stringify(mark.mock.calls)).not.toContain('private-session-id');
  });
});
