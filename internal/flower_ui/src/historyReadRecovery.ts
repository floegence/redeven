import { FlowerReadDeadlineError, withFlowerReadDeadline } from './requestDeadline';

const HISTORY_READ_RETRY_DELAYS = [200, 600, 1200, 2500, 5000, 10000] as const;

// Bound pressure, not the lifetime of a still-authorized visible read.
export function historyReadRetryDelay(attempt: number): number {
  return HISTORY_READ_RETRY_DELAYS[Math.min(attempt, HISTORY_READ_RETRY_DELAYS.length - 1)];
}

export function recoverableHistoryRead(error: unknown): boolean {
  if (error instanceof FlowerReadDeadlineError) return true;
  const failure = error as { status?: number; code?: string } | null;
  if (!failure) return false;
  if (failure.status !== undefined && failure.status > 0) return failure.status === 408 || failure.status === 429 || failure.status >= 500 && failure.status <= 599;
  return ['transport', 'network_error', 'connection_closed', 'transport_unavailable', 'timeout', 'operation_failed', 'closed', 'going_away', 'history_source_changed'].includes(failure.code ?? '');
}

export async function recoverHistoryRead<T>(read: (attempt: number) => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const result = await read(attempt);
      signal.throwIfAborted();
      return result;
    } catch (error) {
      signal.throwIfAborted();
      if (!recoverableHistoryRead(error)) throw error;
      const delay = historyReadRetryDelay(attempt);
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, delay);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      });
    }
  }
}

// Reads remain owned by their visible demand until it is cancelled. Elapsed
// time cannot establish transport failure while the session remains alive.
export function recoverHistoryRequest<T>(read: (signal: AbortSignal) => Promise<T>, timeoutMessage: string, signal: AbortSignal): Promise<T> {
  return recoverHistoryRead(() => withFlowerReadDeadline(read, timeoutMessage, signal, 0), signal);
}
