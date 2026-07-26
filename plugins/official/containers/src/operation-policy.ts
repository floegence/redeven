export type MutationOutcome = 'committed' | 'not_committed' | 'unknown' | undefined;

export type SubmissionFailurePolicy =
  | { retryAllowed: true; phase: 'finished' }
  | { retryAllowed: false; phase: 'submission_unknown' };

export type CancellationFailurePolicy =
  | { retryAllowed: true; phase: 'running'; message: string }
  | { retryAllowed: false; phase: 'cancel_outcome_unknown'; message: string };

export function mutationOutcome(error: unknown): MutationOutcome {
  if (!error || typeof error !== 'object') return undefined;
  const value = Reflect.get(error, 'mutationOutcome');
  return value === 'committed' || value === 'not_committed' || value === 'unknown' ? value : undefined;
}

export function submissionFailurePolicy(outcome: MutationOutcome): SubmissionFailurePolicy {
  return outcome === 'not_committed'
    ? { retryAllowed: true, phase: 'finished' }
    : { retryAllowed: false, phase: 'submission_unknown' };
}

export function cancellationFailurePolicy(outcome: MutationOutcome): CancellationFailurePolicy {
  if (outcome === 'not_committed') {
    return {
      retryAllowed: true,
      phase: 'running',
      message: 'Cancellation was not submitted. The operation is still being observed.',
    };
  }
  return {
    retryAllowed: false,
    phase: 'cancel_outcome_unknown',
    message: 'Cancellation outcome is uncertain. Observation continues until the Host reports a terminal status.',
  };
}
