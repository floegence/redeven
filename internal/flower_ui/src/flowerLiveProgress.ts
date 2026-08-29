import type {
  FlowerRunProgressPhase,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { trimString } from './flowerSurfaceModel';

export type FlowerLiveProgressKind = FlowerRunProgressPhase;

export type FlowerLiveProgress = Readonly<{
  kind: FlowerLiveProgressKind;
  runID: string;
  turnID: string;
  identity: string;
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
    runID,
    turnID,
    identity: [thread.thread_id, runID].join('\x1f'),
  };
}
