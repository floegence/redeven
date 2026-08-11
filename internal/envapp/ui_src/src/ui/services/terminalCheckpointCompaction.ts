import {
  createGhosttyCheckpointActor,
  type GhosttyAuthoritativeCheckpoint,
  type GhosttyCheckpointActor,
} from '@floegence/floeterm-terminal-web';

export type TerminalCheckpointChunk = Readonly<{
  sequence: number;
  data: Uint8Array;
  geometryGeneration: number;
  cols: number;
  rows: number;
}>;

type TerminalCheckpointActorLike = Pick<
  GhosttyCheckpointActor,
  'start' | 'append' | 'capture' | 'dispose'
>;

export type TerminalCheckpointCompactorState = 'idle' | 'ready' | 'failed' | 'disposed';

export type TerminalCheckpointCompactor = Readonly<{
  configure(options: Readonly<{
    sessionId: string;
    historyGeneration: number;
    cols: number;
    rows: number;
    initialSequence?: number;
    checkpoint?: GhosttyAuthoritativeCheckpoint;
  }>): void;
  append(chunks: readonly TerminalCheckpointChunk[]): void;
  settle(): Promise<void>;
  getState(): TerminalCheckpointCompactorState;
  reset(): void;
  dispose(): void;
}>;

export function createTerminalCheckpointCompactor(options: Readonly<{
  captureEveryBytes?: number;
  createActor?: () => TerminalCheckpointActorLike;
  commit: (sessionId: string, checkpoint: GhosttyAuthoritativeCheckpoint) => Promise<void>;
  onFailure?: (error: Error) => void;
}>): TerminalCheckpointCompactor {
  const captureEveryBytes = options.captureEveryBytes ?? 4 * 1024 * 1024;
  if (!Number.isSafeInteger(captureEveryBytes) || captureEveryBytes <= 0) {
    throw new Error('terminal checkpoint capture budget must be a positive safe integer');
  }

  let state: TerminalCheckpointCompactorState = 'idle';
  let actor: TerminalCheckpointActorLike | null = null;
  let actorGeneration = 0;
  let sessionId = '';
  let bytesSinceCapture = 0;
  let tail = Promise.resolve();

  const fail = (current: TerminalCheckpointActorLike, generation: number, value: unknown): void => {
    if (actor !== current || actorGeneration !== generation || state === 'disposed') return;
    const error = value instanceof Error ? value : new Error(String(value));
    actor = null;
    bytesSinceCapture = 0;
    state = 'failed';
    current.dispose();
    options.onFailure?.(error);
  };

  const resetActor = (): void => {
    actorGeneration += 1;
    actor?.dispose();
    actor = null;
    bytesSinceCapture = 0;
    tail = Promise.resolve();
  };

  return {
    configure(configureOptions) {
      if (state === 'disposed') return;
      resetActor();
      sessionId = String(configureOptions.sessionId ?? '').trim();
      const current = (options.createActor ?? createGhosttyCheckpointActor)();
      const generation = actorGeneration;
      actor = current;
      state = 'ready';
      tail = current.start({
        cols: configureOptions.checkpoint?.cols ?? configureOptions.cols,
        rows: configureOptions.checkpoint?.rows ?? configureOptions.rows,
        parserEpoch: configureOptions.checkpoint?.parserEpoch ?? configureOptions.historyGeneration,
        ...(configureOptions.checkpoint
          ? { checkpoint: configureOptions.checkpoint }
          : { initialSequence: configureOptions.initialSequence ?? 0 }),
      }).catch(error => fail(current, generation, error));
    },

    append(chunks) {
      const current = actor;
      if (!current || state !== 'ready' || chunks.length === 0) return;
      const generation = actorGeneration;
      let owned: TerminalCheckpointChunk[];
      try {
        owned = chunks.map(chunk => ({ ...chunk, data: chunk.data.slice() }));
      } catch (error) {
        fail(current, generation, error);
        return;
      }
      const byteLength = owned.reduce((total, chunk) => total + chunk.data.byteLength, 0);
      tail = tail.then(async () => {
        if (actor !== current || actorGeneration !== generation || state !== 'ready') return;
        current.append(owned);
        bytesSinceCapture += byteLength;
        if (bytesSinceCapture < captureEveryBytes) return;
        const checkpoint = await current.capture(owned[owned.length - 1]!.sequence);
        if (actor !== current || actorGeneration !== generation || state !== 'ready') return;
        await options.commit(sessionId, checkpoint);
        if (actor === current && actorGeneration === generation && state === 'ready') {
          bytesSinceCapture = 0;
        }
      }).catch(error => fail(current, generation, error));
    },

    settle: () => tail,
    getState: () => state,
    reset() {
      if (state === 'disposed') return;
      resetActor();
      state = 'idle';
    },
    dispose() {
      if (state === 'disposed') return;
      resetActor();
      state = 'disposed';
    },
  };
}
