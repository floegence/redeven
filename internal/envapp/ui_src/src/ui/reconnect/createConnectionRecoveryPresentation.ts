import type { ConnectionRecoverySnapshot, ReconnectFailure } from './createRuntimeReconnectController';

export type ConnectionRecoveryStepID =
  | 'interrupted'
  | 'desktop_transport'
  | 'runtime_probe'
  | 'protocol_connect'
  | 'secure_session'
  | 'completed';

export type ConnectionRecoveryStep = Readonly<{
  id: ConnectionRecoveryStepID;
  status: 'pending' | 'active' | 'complete' | 'failed';
  attempt_count: number;
  next_retry_at_unix_ms?: number;
}>;

export type ConnectionRecoveryPresentation = Readonly<{
  steps: readonly ConnectionRecoveryStep[];
  completed_step_count: number;
  progress_percent: number;
  active_step: ConnectionRecoveryStepID;
  failure?: ReconnectFailure;
  diagnostic_text: string;
}>;

function failedStepID(snapshot: ConnectionRecoverySnapshot): ConnectionRecoveryStepID {
  const desktopFailure = snapshot.desktop_transport?.phase === 'failed';
  if (desktopFailure) return 'desktop_transport';
  if (
    snapshot.failure?.code === 'authentication_failed'
    || snapshot.failure?.code === 'secure_session_failed'
  ) {
    return 'secure_session';
  }
  if (snapshot.protocol_connected) return 'secure_session';
  if (snapshot.protocol_attempt_count > 0) return 'protocol_connect';
  return 'runtime_probe';
}

function stepStatus(
  snapshot: ConnectionRecoverySnapshot,
  id: ConnectionRecoveryStepID,
): ConnectionRecoveryStep['status'] {
  if (snapshot.state === 'failed' && failedStepID(snapshot) === id) return 'failed';
  switch (id) {
    case 'interrupted':
      return 'complete';
    case 'desktop_transport':
      if (snapshot.desktop_transport?.phase === 'ready' && snapshot.desktop_transport.recovered_at_unix_ms) return 'complete';
      if (snapshot.phase === 'desktop_transport') return 'active';
      return 'pending';
    case 'runtime_probe':
      if (snapshot.availability_status === 'online' || snapshot.protocol_connected) return 'complete';
      if (snapshot.phase === 'runtime_probe') return 'active';
      return 'pending';
    case 'protocol_connect':
      if (snapshot.protocol_connected) return 'complete';
      if (snapshot.phase === 'protocol_connect') return 'active';
      return 'pending';
    case 'secure_session':
      if (snapshot.secure_session === 'ready') return 'complete';
      if (snapshot.phase === 'secure_session') return 'active';
      return 'pending';
    case 'completed':
      return snapshot.state === 'succeeded' ? 'complete' : 'pending';
  }
}

function stepAttemptCount(snapshot: ConnectionRecoverySnapshot, id: ConnectionRecoveryStepID): number {
  switch (id) {
    case 'desktop_transport': return snapshot.desktop_transport?.attempt_count ?? 0;
    case 'runtime_probe': return snapshot.runtime_probe_attempt_count;
    case 'protocol_connect': return snapshot.protocol_attempt_count;
    default: return 0;
  }
}

function activeStepID(snapshot: ConnectionRecoverySnapshot): ConnectionRecoveryStepID {
  if (snapshot.state === 'failed') return failedStepID(snapshot);
  switch (snapshot.phase) {
    case 'desktop_transport': return 'desktop_transport';
    case 'runtime_probe': return 'runtime_probe';
    case 'protocol_connect': return 'protocol_connect';
    case 'secure_session': return 'secure_session';
    case 'completed': return 'completed';
    default: return 'interrupted';
  }
}

export function createConnectionRecoveryPresentation(
  snapshot: ConnectionRecoverySnapshot,
): ConnectionRecoveryPresentation {
  const stepIDs: ConnectionRecoveryStepID[] = [
    'interrupted',
    ...(snapshot.desktop_transport ? ['desktop_transport' as const] : []),
    'runtime_probe',
    'protocol_connect',
    'secure_session',
    'completed',
  ];
  const steps = stepIDs.map((id) => ({
    id,
    status: stepStatus(snapshot, id),
    attempt_count: stepAttemptCount(snapshot, id),
    ...(id === activeStepID(snapshot) && snapshot.next_retry_at_unix_ms
      ? { next_retry_at_unix_ms: snapshot.next_retry_at_unix_ms }
      : {}),
  } satisfies ConnectionRecoveryStep));
  const completedStepCount = steps.filter((step) => step.status === 'complete').length;
  return Object.freeze({
    steps: Object.freeze(steps),
    completed_step_count: completedStepCount,
    progress_percent: Math.round((completedStepCount / steps.length) * 100),
    active_step: activeStepID(snapshot),
    ...(snapshot.failure ? { failure: snapshot.failure } : {}),
    diagnostic_text: JSON.stringify({
      generation: snapshot.generation,
      revision: snapshot.revision,
      state: snapshot.state,
      phase: snapshot.phase,
      started_at_unix_ms: snapshot.started_at_unix_ms,
      recovered_at_unix_ms: snapshot.recovered_at_unix_ms,
      runtime_probe_attempt_count: snapshot.runtime_probe_attempt_count,
      protocol_attempt_count: snapshot.protocol_attempt_count,
      availability_status: snapshot.availability_status,
      secure_session: snapshot.secure_session,
      failure: snapshot.failure,
      desktop_transport: snapshot.desktop_transport,
    }, null, 2),
  });
}
