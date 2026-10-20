// The request may have reached storage before its response is lost. A deadline
// releases UI ownership without retrying the command or claiming cancellation.
export class FlowerRequestDeadlineError extends Error {}
export class FlowerReadDeadlineError extends Error {}

export async function withFlowerRequestDeadline<T>(operation: () => Promise<T>, timeoutMessage: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    signal?.throwIfAborted();
    return await Promise.race([Promise.resolve().then(() => { signal?.throwIfAborted(); return operation(); }), new Promise<T>((_, reject) => {
      cancel = () => reject(new DOMException('Command wait was superseded.', 'AbortError'));
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => reject(new FlowerRequestDeadlineError(timeoutMessage)), 120_000);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) signal?.removeEventListener('abort', cancel);
  }
}

// One read deadline owns both the bounded wait and transport cancellation.
export async function withFlowerReadDeadline<T>(read: (signal: AbortSignal) => Promise<T>, timeoutMessage: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    if (signal?.aborted) throw new DOMException('Read was superseded.', 'AbortError');
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return read(controller.signal);
      }),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          const error = new FlowerReadDeadlineError(timeoutMessage);
          reject(error);
          controller.abort(error);
        }, 15_000);
        cancel = () => {
          const error = new DOMException('Read was superseded.', 'AbortError');
          reject(error);
          controller.abort(error);
        };
        signal?.addEventListener('abort', cancel, { once: true });
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) signal?.removeEventListener('abort', cancel);
  }
}
