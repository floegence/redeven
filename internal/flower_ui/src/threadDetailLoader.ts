export type ThreadDetailTarget = Readonly<{
  epoch: number;
  activityRevision: number;
  settingsRevision: number;
  runtimeKey: string;
  source: string;
  force?: boolean;
}>;
type Target = ThreadDetailTarget & Readonly<{ cycle: number }>;
type Waiter<T> = { resolve: (value: T | null) => void; release: () => void };
type Batch<T> = { target: Target; waiters: Set<Waiter<T>>; controller: AbortController; finished?: boolean };
type State<T> = { cycle: number; active?: Batch<T>; pending?: Batch<T>; failed?: Target };

function advanced(next: Target, previous: Target): boolean {
  return next.epoch !== previous.epoch || next.cycle > previous.cycle
    || next.activityRevision > previous.activityRevision || next.settingsRevision > previous.settingsRevision
    || (next.activityRevision >= previous.activityRevision && next.settingsRevision >= previous.settingsRevision
      && next.runtimeKey !== previous.runtimeKey);
}
function merge(next: Target, previous: Target): Target {
  if (next.epoch !== previous.epoch) return next;
  return { ...next, force: next.force || previous.force, cycle: Math.max(next.cycle, previous.cycle),
    activityRevision: Math.max(next.activityRevision, previous.activityRevision),
    settingsRevision: Math.max(next.settingsRevision, previous.settingsRevision),
    runtimeKey: next.activityRevision >= previous.activityRevision ? next.runtimeKey : previous.runtimeKey };
}

/** Owns only bounded, ephemeral read demand; ThreadCache owns accepted views. */
export function createThreadDetailLoader<T>(options: Readonly<{
  read: (threadID: string, target: ThreadDetailTarget, signal: AbortSignal) => Promise<T>;
  onError: (threadID: string, target: ThreadDetailTarget, error: unknown) => void;
  onLoading: (threadID: string, loading: boolean, target?: ThreadDetailTarget) => void;
}>) {
  const states = new Map<string, State<T>>();
  let retained = new Set<string>();
  let disposed = false;
  const stateFor = (id: string): State<T> => {
    let state = states.get(id);
    if (!state) { state = { cycle: 0 }; states.set(id, state); }
    return state;
  };
  const prune = (id: string, state: State<T>) => {
    if (!state.active && !state.pending && !retained.has(id) && states.get(id) === state) states.delete(id);
  };
  const settle = (batch: Batch<T>, value: T | null) => {
    for (const waiter of batch.waiters) { waiter.release(); waiter.resolve(value); }
    batch.waiters.clear();
  };
  // This is the only path which dispatches a detail read or drains its successor.
  const drain = (id: string, state: State<T>) => {
    if (state.active || disposed || states.get(id) !== state) return;
    const batch = state.pending;
    state.pending = undefined;
    if (!batch?.waiters.size) { options.onLoading(id, false); prune(id, state); return; }
    state.active = batch;
    options.onLoading(id, true, batch.target);
    void Promise.resolve().then(() => {
      batch.controller.signal.throwIfAborted();
      return options.read(id, batch.target, batch.controller.signal);
    }).then(value => {
      if (batch.controller.signal.aborted || disposed || states.get(id) !== state) return;
      state.failed = undefined;
      batch.finished = true;
      settle(batch, value);
    }, error => {
      if (!batch.controller.signal.aborted && !disposed && states.get(id) === state) {
        state.failed = batch.target;
        options.onError(id, batch.target, error);
      }
      batch.finished = true;
      settle(batch, null);
    }).finally(() => {
      settle(batch, null);
      if (state.active !== batch) return;
      state.active = undefined;
      if (states.get(id) === state) drain(id, state);
    });
  };
  const forget = (id: string) => {
    const state = states.get(id);
    if (!state) return;
    states.delete(id);
    for (const batch of [state.active, state.pending]) {
      if (batch) { batch.controller.abort(); settle(batch, null); }
    }
    options.onLoading(id, false);
  };
  return {
    request(id: string, target: ThreadDetailTarget, signal?: AbortSignal): Promise<T | null> {
      if (disposed || signal?.aborted) return Promise.resolve(null);
      const state = stateFor(id);
      const next = { ...target, cycle: state.cycle };
      if (state.failed && !advanced(next, state.failed)) return Promise.resolve(null);
      let batch = state.active;
      if (!batch || batch.finished || batch.controller.signal.aborted || advanced(next, batch.target)) {
        batch = state.pending;
        if (batch) batch.target = merge(next, batch.target);
        else { batch = { target: next, waiters: new Set(), controller: new AbortController() }; state.pending = batch; }
      }
      const demand = batch;
      return new Promise(resolve => {
        const cancel = () => {
          demand.waiters.delete(waiter);
          waiter.release(); resolve(null);
          if (!demand.waiters.size) demand.controller.abort();
          if (state.pending === demand && !demand.waiters.size) { state.pending = undefined; prune(id, state); }
        };
        const waiter: Waiter<T> = { resolve, release: () => signal?.removeEventListener('abort', cancel) };
        demand.waiters.add(waiter);
        signal?.addEventListener('abort', cancel, { once: true });
        drain(id, state);
      });
    },
    invalidate(id: string) { const state = stateFor(id); state.cycle++; state.failed = undefined; },
    retain(ids: Iterable<string>) { retained = new Set(ids); for (const [id, state] of states) prune(id, state); },
    forget,
    reset() { for (const id of states.keys()) forget(id); },
    dispose() { disposed = true; for (const id of states.keys()) forget(id); },
    size: () => states.size,
  };
}
