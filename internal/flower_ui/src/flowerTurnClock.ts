import type { FlowerRuntimeTurn } from './contracts/flowerSurfaceContracts';

/** Browser-only sample from an already received current view. Never persisted or sent. */
export type FlowerTurnClockSample = Readonly<{ turnID: string; serverMS: number; monotonicMS: number }>;

export function sampleFlowerTurnClock(turnID: string | undefined, sampledAt: number | undefined, previous?: FlowerTurnClockSample, now = performance.now()): FlowerTurnClockSample | undefined {
  if (!turnID) return undefined;
  const prior = previous?.turnID === turnID ? previous : undefined;
  if (sampledAt === undefined || !Number.isSafeInteger(sampledAt) || sampledAt <= 0 || prior && sampledAt <= prior.serverMS) return prior;
  return { turnID, serverMS: sampledAt, monotonicMS: prior ? Math.min(now, prior.monotonicMS + sampledAt - prior.serverMS) : now };
}

/** Total elapsed time includes waits; only canonical terminal facts settle it. */
export function flowerTurnElapsedMS(turn: FlowerRuntimeTurn | undefined, sample: FlowerTurnClockSample | undefined, now: number): number | undefined {
  if (!turn) return undefined;
  if (turn.ended_at && turn.outcome) return turn.elapsed_ms;
  if (sample?.turnID !== turn.turn_id) return undefined;
  const started = Date.parse(turn.started_at);
  if (!Number.isFinite(started) || sample.serverMS < started) return undefined;
  return Math.max(0, sample.serverMS - started + now - sample.monotonicMS);
}
