export type LiveTransportConnect<T> = (input: Readonly<{ signal: AbortSignal }>) => AsyncIterable<T>;

export type LiveTransport<T> = Readonly<{
  connectionEpoch: () => number;
  start(input: Readonly<{
    connect: LiveTransportConnect<T>;
    onCurrent: (value: T, connectionEpoch: number) => void;
    onTerminalError: (error: unknown) => void;
  }>): () => void;
}>;

const RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000, 10_000] as const;

export function createLiveTransport<T>(): LiveTransport<T> {
  let epoch = 0;
  let stopCurrent: (() => void) | undefined;
  return {
    connectionEpoch: () => epoch,
    start(input) {
      stopCurrent?.();
      const controller = new AbortController();
      let stopped = false;
      let reconnectAttempt = 0;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        controller.abort();
        if (stopCurrent === stop) stopCurrent = undefined;
      };
      stopCurrent = stop;
      const wait = (delayMs: number) => new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, delayMs);
        controller.signal.addEventListener('abort', () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      void (async () => {
        while (!stopped && !controller.signal.aborted) {
          const connectionEpoch = ++epoch;
          const connectedAt = Date.now();
          try {
            for await (const value of input.connect({ signal: controller.signal })) {
              if (stopped || controller.signal.aborted || connectionEpoch !== epoch) return;
              input.onCurrent(value, connectionEpoch);
            }
            if (Date.now() - connectedAt >= 30_000) reconnectAttempt = 0;
          } catch (error) {
            if (stopped || controller.signal.aborted || connectionEpoch !== epoch) return;
            const status = Number((error as { status?: unknown })?.status ?? 0);
            const code = String((error as { code?: unknown })?.code ?? '').trim();
            if (status === 401 || status === 403) {
              input.onTerminalError(error);
              return;
            }
            if (status === 429) {
              const retryAfterSeconds = Number((error as { retryAfter?: unknown })?.retryAfter ?? 0);
              if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
                await wait(Math.min(30_000, retryAfterSeconds * 1000));
                continue;
              }
            }
            // Transport failures are retryable. Schema, parsing, and current-
            // view application failures require a product update; retrying the
            // same payload would create a connection storm without recovery.
            if ((!code && status === 0) || (code && code !== 'transport' && code !== 'unexpected_status')) {
              input.onTerminalError(error);
              return;
            }
          }
          const base = RECONNECT_DELAYS_MS[Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
          reconnectAttempt += 1;
          await wait(Math.round(base * (0.8 + Math.random() * 0.4)));
        }
      })();
      return stop;
    },
  };
}
