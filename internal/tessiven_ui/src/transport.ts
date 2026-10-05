import { TESSIVEN_API, type TessivenTransport } from './types';

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
        try {
          // The host owns session transport. A successful connection always
          // invalidates snapshots; no cursor journal or background discovery.
          for await (const frame of events(
            `${TESSIVEN_API}/events`,
            controller.signal,
          )) {
            if (controller.signal.aborted) return;
            if (frame.event === 'changed') changed();
          }
          if (!controller.signal.aborted)
            error(new Error('Tessiven event stream ended'));
        } catch (cause) {
          if (!controller.signal.aborted) error(cause);
        }
      })();
      return () => controller.abort();
    },
  };
}
