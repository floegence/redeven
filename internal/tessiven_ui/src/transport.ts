import { TESSIVEN_API, type TessivenTransport } from './types';

const EVENT_STREAM_RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000] as const;

function waitForReconnect(signal: AbortSignal, delayMs: number): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve(true);
    }, delayMs);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      resolve(false);
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function createTessivenTransport(
  request: TessivenTransport['request'],
  events: (
    path: string,
    signal: AbortSignal,
  ) => AsyncIterable<{ event?: string; data: string }>,
): TessivenTransport {
  return {
    request,
    subscribe(changed, error) {
      const controller = new AbortController();
      void (async () => {
        let failures = 0;
        let errorReported = false;
        while (!controller.signal.aborted) {
          try {
            // The host owns session transport. A successful connection always
            // invalidates snapshots; no cursor journal or background discovery.
            for await (const frame of events(
              `${TESSIVEN_API}/events`,
              controller.signal,
            )) {
              if (controller.signal.aborted) return;
              failures = 0;
              errorReported = false;
              if (frame.event === 'changed') changed();
            }
            if (controller.signal.aborted) return;
            throw new Error('Tessiven event stream ended');
          } catch (cause) {
            if (controller.signal.aborted) return;
            failures += 1;
            if (failures >= 3 && !errorReported) {
              errorReported = true;
              error(cause);
            }
          }

          const delay = EVENT_STREAM_RECONNECT_DELAYS_MS[
            Math.min(failures - 1, EVENT_STREAM_RECONNECT_DELAYS_MS.length - 1)
          ];
          if (!await waitForReconnect(controller.signal, delay)) return;
        }
      })();
      return () => controller.abort();
    },
  };
}
