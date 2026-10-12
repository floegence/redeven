export type LiveTransportConnect<T> = (input: Readonly<{ signal: AbortSignal }>) => AsyncIterable<T>;

export type LiveTransportState = Readonly<{
  status: 'connecting' | 'ready' | 'reconnecting' | 'failed' | 'stopped';
  connectionEpoch: number;
  error?: unknown;
}>;

type LiveTransportInput<T> = Readonly<{
  connect: LiveTransportConnect<T>;
  onCurrent: (value: T, connectionEpoch: number) => void;
  isReady?: (value: T) => boolean;
  onState?: (state: LiveTransportState) => void;
  onBoundary?: () => void;
  onTerminalError: (error: unknown) => void;
}>;

export type LiveTransport<T> = Readonly<{
  connectionEpoch: () => number;
  state: () => LiveTransportState;
  start(input: LiveTransportInput<T>): () => void;
  restart: () => void;
  fail: (error: unknown, connectionEpoch?: number) => void;
}>;

const RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000, 10_000] as const;
const HANDSHAKE_TIMEOUT_MS = 15_000;

type ConnectionAttempt = {
  epoch: number;
  controller: AbortController;
  connectedAt: number;
  handshakeTimer?: number;
};

type TransportOwner<T> = {
  input: LiveTransportInput<T>;
  stopped: boolean;
  reconnectAttempt: number;
  attempt?: ConnectionAttempt;
  retryTimer?: number;
};

export function createLiveTransport<T>(): LiveTransport<T> {
  let epoch = 0;
  let owner: TransportOwner<T> | undefined;
  let state: LiveTransportState = { status: 'stopped', connectionEpoch: epoch };
  const setState = (current: TransportOwner<T>, status: LiveTransportState['status'], error?: unknown) => {
    state = { status, connectionEpoch: epoch, ...(error === undefined ? {} : { error }) };
    current.input.onState?.(state);
  };
  const currentAttempt = (current: TransportOwner<T>, attempt: ConnectionAttempt): boolean => (
    owner === current && !current.stopped && current.attempt === attempt && attempt.epoch === epoch
  );
  const invalidate = (current: TransportOwner<T>) => {
    epoch++;
    if (current.retryTimer !== undefined) window.clearTimeout(current.retryTimer);
    current.retryTimer = undefined;
    const attempt = current.attempt;
    current.attempt = undefined;
    if (attempt?.handshakeTimer !== undefined) window.clearTimeout(attempt.handshakeTimer);
    attempt?.controller.abort();
    current.input.onBoundary?.();
  };
  const fail = (error: unknown, connectionEpoch = epoch) => {
    const current = owner;
    if (!current || current.stopped || connectionEpoch !== epoch || state.status === 'failed') return;
    invalidate(current);
    setState(current, 'failed', error);
    current.input.onTerminalError(error);
  };
  const disconnect = (current: TransportOwner<T>, attempt: ConnectionAttempt, error?: unknown) => {
    if (!currentAttempt(current, attempt)) return;
    const status = Number((error as { status?: unknown })?.status ?? 0);
    const code = String((error as { code?: unknown })?.code ?? '').trim();
    if (error !== undefined && status !== 429 && (status === 401 || status === 403 || status === 423
      || ((!code && status === 0) || (code && code !== 'transport' && code !== 'unexpected_status')))) {
      fail(error, attempt.epoch);
      return;
    }
    if (Date.now() - attempt.connectedAt >= 30_000) current.reconnectAttempt = 0;
    invalidate(current);
    setState(current, 'reconnecting', error);
    const retryAfterSeconds = status === 429 ? Number((error as { retryAfter?: unknown })?.retryAfter ?? 0) : 0;
    let delay: number;
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      delay = Math.min(30_000, retryAfterSeconds * 1000);
    } else {
      const base = RECONNECT_DELAYS_MS[Math.min(current.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
      current.reconnectAttempt++;
      delay = Math.round(base * (0.8 + Math.random() * 0.4));
    }
    const retryEpoch = epoch;
    current.retryTimer = window.setTimeout(() => {
      if (owner !== current || current.stopped || epoch !== retryEpoch) return;
      current.retryTimer = undefined;
      connect(current, true);
    }, delay);
  };
  const connect = (current: TransportOwner<T>, reconnecting = false) => {
    const attempt: ConnectionAttempt = { epoch: ++epoch, controller: new AbortController(), connectedAt: Date.now() };
    current.attempt = attempt;
    setState(current, reconnecting ? 'reconnecting' : 'connecting', state.error);
    if (current.input.isReady) {
      attempt.handshakeTimer = window.setTimeout(() => {
        if (!currentAttempt(current, attempt)) return;
        fail(Object.assign(new Error('Flower live synchronization did not become ready in time.'), {
          code: 'flower_live_handshake_timeout',
        }), attempt.epoch);
      }, HANDSHAKE_TIMEOUT_MS);
    }
    void (async () => {
      try {
        for await (const value of current.input.connect({ signal: attempt.controller.signal })) {
          if (!currentAttempt(current, attempt)) return;
          try {
            current.input.onCurrent(value, attempt.epoch);
            if (!currentAttempt(current, attempt)) return;
            if (state.status !== 'ready' && (!current.input.isReady || current.input.isReady(value))) {
              if (attempt.handshakeTimer !== undefined) window.clearTimeout(attempt.handshakeTimer);
              attempt.handshakeTimer = undefined;
              setState(current, 'ready');
            }
          } catch (error) {
            fail(error, attempt.epoch);
            return;
          }
        }
        disconnect(current, attempt);
      } catch (error) {
        disconnect(current, attempt, error);
      }
    })();
  };
  const stop = (current: TransportOwner<T>) => {
    if (current.stopped) return;
    current.stopped = true;
    if (owner !== current) return;
    invalidate(current);
    setState(current, state.status === 'failed' ? 'failed' : 'stopped', state.error);
    owner = undefined;
  };
  return {
    connectionEpoch: () => epoch,
    state: () => state,
    start(input) {
      if (owner) stop(owner);
      const current: TransportOwner<T> = { input, stopped: false, reconnectAttempt: 0 };
      owner = current;
      connect(current);
      return () => stop(current);
    },
    restart() {
      if (!owner || owner.stopped) return;
      invalidate(owner);
      owner.reconnectAttempt = 0;
      connect(owner);
    },
    fail,
  };
}
