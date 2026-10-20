import type { FlowerThreadReadStatus } from './contracts/flowerSurfaceContracts';

const RETRY_DELAYS = [500, 1000, 2000, 5000, 10000, 30000];
type PendingRead = {
  presented: number; confirmed: number; failures: number; blocked: boolean;
  request?: object; timer?: ReturnType<typeof setTimeout>;
};

// Presentation is local evidence. Only server replies establish durable read state.
export function createThreadReadSync(options: {
  send: (threadID: string, revision: number) => Promise<FlowerThreadReadStatus>;
  apply: (threadID: string, status: FlowerThreadReadStatus) => void;
  changed: () => void;
  random?: () => number;
}) {
  const threads = new Map<string, PendingRead>();
  let available = true;
  let disposed = false;
  const clearTimer = (state: PendingRead) => {
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = undefined;
  };
  const current = (id: string, state: PendingRead) => !disposed && threads.get(id) === state;
  const retry = (id: string, state: PendingRead) => {
    if (!available || state.blocked || state.presented <= state.confirmed) return;
    const base = RETRY_DELAYS[Math.min(state.failures++, RETRY_DELAYS.length - 1)];
    const delay = Math.min(30000, base * (0.8 + (options.random ?? Math.random)() * 0.4));
    state.timer = setTimeout(() => { state.timer = undefined; pump(id, state); }, delay);
  };
  const pump = (id: string, state: PendingRead) => {
    if (!current(id, state) || !available || state.blocked || state.request || state.timer !== undefined
      || state.presented <= state.confirmed) return;
    const revision = state.presented;
    const request = {};
    state.request = request;
    state.timer = setTimeout(() => {
      if (!current(id, state) || state.request !== request) return;
      state.timer = undefined;
      state.request = undefined;
      retry(id, state);
    }, 15000);
    Promise.resolve().then(() => {
      if (!current(id, state) || state.request !== request) return undefined;
      if (!available) { clearTimer(state); state.request = undefined; return undefined; }
      return options.send(id, revision);
    }).then(status => {
      if (!status) return;
      if (!current(id, state)) return;
      // Even a timed-out response is useful, but it cannot take ownership of a newer request.
      options.apply(id, status);
      state.confirmed = Math.max(state.confirmed, status.read_state.last_seen_activity_revision);
      if (state.request !== request) return;
      clearTimer(state);
      state.request = undefined;
      if (state.confirmed >= revision) { state.failures = 0; pump(id, state); }
      else retry(id, state);
    }).catch(error => {
      if (!current(id, state) || state.request !== request) return;
      clearTimer(state);
      state.request = undefined;
      const status = Number(error?.status);
      if (status === 404) { threads.delete(id); options.changed(); return; }
      state.blocked = status === 401 || status === 403 || status === 423;
      retry(id, state);
    });
  };
  return {
    presentedRevision: (id: string) => threads.get(id)?.presented ?? 0,
    present(id: string, revision: number, confirmed: number) {
      if (disposed || revision <= 0) return;
      let state = threads.get(id);
      if (!state) {
        state = { presented: 0, confirmed: 0, failures: 0, blocked: false };
        threads.set(id, state);
      }
      state.confirmed = Math.max(state.confirmed, confirmed);
      if (revision > state.presented) { state.presented = revision; options.changed(); }
      pump(id, state);
    },
    confirm(id: string, status: FlowerThreadReadStatus) {
      const state = threads.get(id);
      if (!state) return;
      state.confirmed = Math.max(state.confirmed, status.read_state.last_seen_activity_revision);
      if (state.confirmed >= state.presented) {
        clearTimer(state); state.request = undefined; state.failures = 0;
      }
    },
    setAvailable(value: boolean, recovered = false) {
      const resumed = value && !available;
      available = value;
      for (const [id, state] of threads) {
        const unblocked = recovered && state.blocked;
        if (unblocked) state.blocked = false;
        if (!value && !state.request) clearTimer(state);
        if (resumed || unblocked) {
          if (!state.request) clearTimer(state);
          pump(id, state);
        }
      }
    },
    retire(id: string) { const state = threads.get(id); if (state) clearTimer(state); threads.delete(id); },
    reset() { for (const state of threads.values()) clearTimer(state); threads.clear(); options.changed(); },
    dispose() { disposed = true; for (const state of threads.values()) clearTimer(state); threads.clear(); },
  };
}
