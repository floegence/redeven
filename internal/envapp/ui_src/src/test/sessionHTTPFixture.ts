import { fetchServerSentEvents } from '@floegence/floe-webapp-boot';

// Product mapping tests emulate the released lifecycle. Real runtime tests
// separately verify browser connection pools and session cancellation.
export async function bindTestSessionHTTP(fetchImplementation: typeof fetch): Promise<() => void> {
  const { bindSessionHTTP } = await import('../ui/services/sessionHTTP');
  return bindSessionHTTP({
    fetch: fetchImplementation,
    events: (input, options) => fetchServerSentEvents(input, {
      ...options,
      headers: { Accept: 'text/event-stream', ...Object.fromEntries(new Headers(options?.headers)) },
      fetch: fetchImplementation,
    }),
  });
}
