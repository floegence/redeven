import type { FlowerRuntimeCurrentView } from './contracts/flowerSurfaceContracts';
import type { FlowerCompanionTerminalTransition } from './flowerCompanionPresence';

type ActiveRun = Readonly<{
  threadID: string;
  runID: string;
  generation: number;
}>;

export type FlowerCompanionRunObservation = Readonly<{
  changed: boolean;
  terminalTransition?: FlowerCompanionTerminalTransition;
}>;

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function terminalOutcome(
  value: FlowerRuntimeCurrentView['last_outcome'],
): FlowerCompanionTerminalTransition['outcome'] | undefined {
  if (value === 'completed') return 'completed';
  if (value === 'failed') return 'failed';
  if (value === 'cancelled' || value === 'interrupted') return 'canceled';
  return undefined;
}

/**
 * Tracks only typed current views already accepted by FlowerSurface. It gives
 * each observed active turn a process-local generation so a later terminal
 * view can produce one exact companion receipt without adding another stream.
 */
export class FlowerCompanionRunTracker {
  private readonly activeRuns = new Map<string, ActiveRun>();
  private nextGeneration = 0;

  observe(current: FlowerRuntimeCurrentView): FlowerCompanionRunObservation {
    const threadID = trim(current.thread_id);
    const runID = trim(current.turn_id);
    if (!threadID || !runID) return { changed: false };

    if (current.activity === 'active') {
      const previous = this.activeRuns.get(threadID);
      if (previous?.runID === runID) return { changed: false };
      this.activeRuns.set(threadID, {
        threadID,
        runID,
        generation: ++this.nextGeneration,
      });
      return { changed: true };
    }

    const outcome = terminalOutcome(current.last_outcome);
    const active = this.activeRuns.get(threadID);
    if (!outcome || !active || active.runID !== runID) return { changed: false };
    this.activeRuns.delete(threadID);
    return {
      changed: true,
      terminalTransition: {
        thread_id: threadID,
        run_id: runID,
        run_generation: active.generation,
        outcome,
      },
    };
  }

  generationFor(threadID: string, runID: string): number | undefined {
    const active = this.activeRuns.get(trim(threadID));
    return active?.runID === trim(runID) ? active.generation : undefined;
  }
}
