import type { PagedTerminalOutputFailureCode } from '@floegence/floeterm-terminal-web';

import { publishDebugConsoleStructuredEvent } from './debugConsoleCapture';

export type TerminalRecoveryVariant = 'panel' | 'workbench';
export type TerminalRecoveryPhase = 'initializing' | 'attaching' | 'replaying' | 'interactive' | 'failed';
export type TerminalRecoveryMilestone =
  | 'attach-start'
  | 'attach-ack'
  | 'baseline-queued'
  | 'baseline-parser-committed'
  | 'interactive'
  | 'live';
export type TerminalResizeDecision = 'requested' | 'applied' | 'no_op' | 'failed';

export type TerminalRecoveryTrace = Readonly<{
  sessionRef: string;
  variant: TerminalRecoveryVariant;
  surfaceGeneration: number;
  traceID: string;
  startedAtMonotonicMs: number;
}>;

export type TerminalRecoveryEventKind =
  | 'phase_transition'
  | 'attach_ack'
  | 'history_page'
  | 'baseline_ready'
  | 'retry_scheduled'
  | 'degraded'
  | 'blocking'
  | 'resize_decision'
  | 'live';

export type TerminalRecoveryEventDetail = Readonly<{
  runtime_attach_generation?: number;
  coordinator_attach_generation?: number;
  history_generation?: number;
  phase_from?: TerminalRecoveryPhase;
  phase_to?: TerminalRecoveryPhase;
  history_page_count?: number;
  history_chunk_count?: number;
  history_bytes?: number;
  covered_through_sequence?: number;
  snapshot_end_sequence?: number;
  first_retained_sequence?: number;
  history_reset?: boolean;
  history_truncated?: boolean;
  catch_up_gap_sequences?: number;
  retry_attempt?: number;
  retry_delay_ms?: number;
  error_code?: PagedTerminalOutputFailureCode | 'terminal_unavailable';
  recovery_action?: 'retry' | 'update_runtime' | 'reopen_environment';
  resize_decision?: TerminalResizeDecision;
  cols?: number;
  rows?: number;
}>;

const sessionRefs = new Map<string, string>();
const surfaceGenerations = new Map<string, number>();
const activeTraces = new Map<string, TerminalRecoveryTrace>();
let nextSessionRef = 0;

function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function sessionRefFor(sessionID: string): string {
  const existing = sessionRefs.get(sessionID);
  if (existing) return existing;
  nextSessionRef += 1;
  const next = `terminal-${String(nextSessionRef).padStart(3, '0')}`;
  sessionRefs.set(sessionID, next);
  return next;
}

function finiteNonNegativeInteger(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

function eventDetail(trace: TerminalRecoveryTrace, detail: TerminalRecoveryEventDetail): Record<string, unknown> {
  return {
    schema_version: 1,
    session_ref: trace.sessionRef,
    variant: trace.variant,
    surface_generation: trace.surfaceGeneration,
    monotonic_ms: monotonicNow(),
    runtime_attach_generation: finiteNonNegativeInteger(detail.runtime_attach_generation),
    coordinator_attach_generation: finiteNonNegativeInteger(detail.coordinator_attach_generation),
    history_generation: finiteNonNegativeInteger(detail.history_generation),
    phase_from: detail.phase_from,
    phase_to: detail.phase_to,
    history_page_count: finiteNonNegativeInteger(detail.history_page_count),
    history_chunk_count: finiteNonNegativeInteger(detail.history_chunk_count),
    history_bytes: finiteNonNegativeInteger(detail.history_bytes),
    covered_through_sequence: finiteNonNegativeInteger(detail.covered_through_sequence),
    snapshot_end_sequence: finiteNonNegativeInteger(detail.snapshot_end_sequence),
    first_retained_sequence: finiteNonNegativeInteger(detail.first_retained_sequence),
    history_reset: detail.history_reset,
    history_truncated: detail.history_truncated,
    catch_up_gap_sequences: finiteNonNegativeInteger(detail.catch_up_gap_sequences),
    retry_attempt: finiteNonNegativeInteger(detail.retry_attempt),
    retry_delay_ms: finiteNonNegativeInteger(detail.retry_delay_ms),
    error_code: detail.error_code,
    recovery_action: detail.recovery_action,
    resize_decision: detail.resize_decision,
    cols: finiteNonNegativeInteger(detail.cols),
    rows: finiteNonNegativeInteger(detail.rows),
  };
}

export function startTerminalRecoveryTrace(
  sessionID: string,
  variant: TerminalRecoveryVariant,
): TerminalRecoveryTrace {
  const nextGeneration = (surfaceGenerations.get(sessionID) ?? 0) + 1;
  surfaceGenerations.set(sessionID, nextGeneration);
  const sessionRef = sessionRefFor(sessionID);
  const trace: TerminalRecoveryTrace = {
    sessionRef,
    variant,
    surfaceGeneration: nextGeneration,
    traceID: `terminal-recovery-${sessionRef}-${nextGeneration}`,
    startedAtMonotonicMs: monotonicNow(),
  };
  activeTraces.set(sessionID, trace);
  return trace;
}

export function publishTerminalRecoveryEvent(
  trace: TerminalRecoveryTrace,
  kind: TerminalRecoveryEventKind,
  detail: TerminalRecoveryEventDetail = {},
): void {
  const now = monotonicNow();
  publishDebugConsoleStructuredEvent({
    created_at: new Date().toISOString(),
    source: 'ui',
    scope: 'terminal_recovery',
    kind,
    trace_id: trace.traceID,
    duration_ms: Math.max(0, now - trace.startedAtMonotonicMs),
    message: `Terminal recovery ${kind.replaceAll('_', ' ')}`,
    detail: eventDetail(trace, detail),
  });
}

export function markTerminalRecoveryMilestone(
  trace: TerminalRecoveryTrace,
  milestone: TerminalRecoveryMilestone,
  detail: TerminalRecoveryEventDetail = {},
): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  const name = `redeven:terminal:${milestone}:${trace.traceID}`;
  performance.mark(name, {
    detail: eventDetail(trace, detail),
  });
}

export function publishTerminalResizeDecision(
  sessionID: string,
  decision: TerminalResizeDecision,
  cols: number,
  rows: number,
): void {
  const trace = activeTraces.get(sessionID);
  if (!trace) return;
  publishTerminalRecoveryEvent(trace, 'resize_decision', {
    resize_decision: decision,
    cols,
    rows,
  });
}

export function getActiveTerminalRecoveryTrace(sessionID: string): TerminalRecoveryTrace | undefined {
  return activeTraces.get(sessionID);
}

export function terminalRecoveryDiagnosticsQuery(
  sessionID: string,
  errorCode?: PagedTerminalOutputFailureCode | 'terminal_unavailable',
): string {
  const trace = activeTraces.get(sessionID);
  if (!trace) return 'terminal_recovery';
  return [trace.sessionRef, String(trace.surfaceGeneration), errorCode].filter(Boolean).join(' ');
}

export function releaseTerminalRecoveryDiagnostics(sessionID: string): void {
  sessionRefs.delete(sessionID);
  surfaceGenerations.delete(sessionID);
  activeTraces.delete(sessionID);
}

export function resetTerminalRecoveryDiagnosticsForTests(): void {
  sessionRefs.clear();
  surfaceGenerations.clear();
  activeTraces.clear();
  nextSessionRef = 0;
}
