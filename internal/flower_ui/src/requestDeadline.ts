// The request may have reached storage before its response is lost. A deadline
// releases UI ownership without retrying the command or claiming cancellation.
export class FlowerRequestDeadlineError extends Error {}
export class FlowerReadDeadlineError extends Error {}

export async function withFlowerRequestDeadline<T>(operation: () => Promise<T>, timeoutMessage: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new FlowerRequestDeadlineError(timeoutMessage)), 120_000);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// Reads release their UI owner after a bounded wait. An aborted wait does not
// assert that a transport or a separately running mutation was cancelled.
export async function withFlowerReadDeadline<T>(read: () => Promise<T>, timeoutMessage: string, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancel: (() => void) | undefined;
  try {
    if (signal?.aborted) throw new DOMException('Read was superseded.', 'AbortError');
    return await Promise.race([
      Promise.resolve().then(() => {
        if (signal?.aborted) throw new DOMException('Read was superseded.', 'AbortError');
        return read();
      }),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new FlowerReadDeadlineError(timeoutMessage)), 15_000);
        cancel = () => reject(new DOMException('Read was superseded.', 'AbortError'));
        signal?.addEventListener('abort', cancel, { once: true });
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (cancel) signal?.removeEventListener('abort', cancel);
  }
}
