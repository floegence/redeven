import type { FlowerTurnLaunchFailure } from './contracts/flowerSurfaceContracts';

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

export function createFlowerClientTurnID(): string {
  if (typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') {
    throw new Error('Secure Flower turn identity generation is unavailable.');
  }
  return `client_${crypto.randomUUID()}`;
}

export function flowerTurnAdmissionUncertainFailure(
  error: unknown,
  threadID: string,
  turnID: string,
): FlowerTurnLaunchFailure {
  const tid = trim(threadID);
  const acceptedTurnID = trim(turnID);
  if (!tid || !acceptedTurnID) {
    throw new Error('Flower turn admission uncertainty requires thread and turn identity.');
  }
  const failure = new Error(error instanceof Error ? error.message : trim(error) || 'Flower turn admission response was unavailable.') as Error & { cause?: unknown };
  failure.cause = error;
  return Object.assign(failure, {
    uncertain_admission: { thread_id: tid, turn_id: acceptedTurnID },
  });
}

export function flowerTurnAdmissionUncertainIdentity(
  error: unknown,
): Readonly<{ thread_id: string; turn_id: string }> | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = (error as Partial<FlowerTurnLaunchFailure>).uncertain_admission;
  const threadID = trim(candidate?.thread_id);
  const turnID = trim(candidate?.turn_id);
  return threadID && turnID ? { thread_id: threadID, turn_id: turnID } : null;
}
