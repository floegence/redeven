import type {
  FlowerRunProgress,
  FlowerRunProgressPhase,
  FlowerProviderRequestProgress,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { trimString } from './flowerSurfaceModel';

export type FlowerLiveProgressKind = FlowerRunProgressPhase;

export type FlowerLiveProgress = Readonly<{
  kind: FlowerLiveProgressKind;
  runID: string;
  turnID: string;
  identity: string;
  retry?: FlowerRunProgress['retry'];
  request?: FlowerProviderRequestProgress;
}>;

export function flowerRunProgress(
  thread: FlowerThreadSnapshot | null | undefined,
): FlowerLiveProgress | null {
  if (!thread || thread.status !== 'running' || !thread.run_progress) return null;
  const runID = trimString(thread.run_progress.run_id);
  const turnID = trimString(thread.run_progress.turn_id);
  if (!runID || !turnID || runID !== trimString(thread.active_run_id)) {
    throw new Error('Flower contract error: run progress does not match the active run identity.');
  }
  return {
    kind: thread.run_progress.phase,
    request: thread.run_progress.request,
    runID,
    turnID,
    identity: [thread.thread_id, runID].join('\x1f'),
    ...(thread.run_progress.retry ? { retry: thread.run_progress.retry } : {}),
  };
}

// Derive countdowns from the authoritative absolute deadline, including after
// reopening a view. The host never schedules or dispatches retries.
export function flowerRetrySeconds(nextAttemptAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(nextAttemptAt) - now) / 1000));
}
