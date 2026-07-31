import type { FlowerTurnLaunchFailure } from './contracts/flowerSurfaceContracts';

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

export function createFlowerClientRequestID(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('Secure Flower request identity generation is unavailable.');
  }
  return `client_${crypto.randomUUID()}`;
}

export function flowerTurnAdmissionUncertainFailure(
  error: unknown,
  clientRequestID: string,
  identity: Readonly<{ thread_id?: string; queue_id?: string; turn_id?: string }> = {},
): FlowerTurnLaunchFailure {
  const requestID = trim(clientRequestID);
  if (!requestID) {
    throw new Error('Flower turn admission uncertainty requires client request identity.');
  }
  const failure = new Error(error instanceof Error ? error.message : trim(error) || 'Flower turn admission response was unavailable.') as Error & { cause?: unknown };
  failure.cause = error;
  const source = error && typeof error === 'object'
    ? error as { code?: unknown; status?: unknown; failureKind?: unknown }
    : {};
  const code = trim(source.code);
  const status = Number(source.status);
  const failureKind = trim(source.failureKind);
  return Object.assign(failure, {
    ...(code ? { code } : {}),
    ...(Number.isFinite(status) && status >= 0 ? { status } : {}),
    ...(failureKind ? { failureKind } : {}),
    uncertain_admission: {
      client_request_id: requestID,
      ...(trim(identity.thread_id) ? { thread_id: trim(identity.thread_id) } : {}),
      ...(trim(identity.queue_id) ? { queue_id: trim(identity.queue_id) } : {}),
      ...(trim(identity.turn_id) ? { turn_id: trim(identity.turn_id) } : {}),
    },
  });
}

export function flowerTurnAdmissionUncertainIdentity(
  error: unknown,
): Readonly<{ client_request_id: string; thread_id?: string; queue_id?: string; turn_id?: string }> | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = (error as Partial<FlowerTurnLaunchFailure>).uncertain_admission;
  const clientRequestID = trim(candidate?.client_request_id);
  const threadID = trim(candidate?.thread_id);
  const queueID = trim(candidate?.queue_id);
  const turnID = trim(candidate?.turn_id);
  return clientRequestID ? {
    client_request_id: clientRequestID,
    ...(threadID ? { thread_id: threadID } : {}),
    ...(queueID ? { queue_id: queueID } : {}),
    ...(turnID ? { turn_id: turnID } : {}),
  } : null;
}
