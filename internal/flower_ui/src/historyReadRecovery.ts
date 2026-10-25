import { FlowerReadDeadlineError } from './requestDeadline';

export const HISTORY_READ_RETRY_DELAYS = [200, 600, 1200] as const;

export function recoverableHistoryRead(error: unknown): boolean {
  if (error instanceof FlowerReadDeadlineError) return true;
  const failure = error as { status?: number; code?: string } | null;
  if (!failure) return false;
  if (failure.status === 408 || failure.status === 429 || failure.status !== undefined && failure.status >= 500 && failure.status <= 599) return true;
  return ['transport', 'network_error', 'connection_closed', 'transport_unavailable'].includes(failure.code ?? '');
}

export async function recoverHistoryRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try {
      const result = await read();
      signal.throwIfAborted();
      return result;
    } catch (error) {
      signal.throwIfAborted();
      const delay = HISTORY_READ_RETRY_DELAYS[attempt];
      if (!recoverableHistoryRead(error) || delay === undefined) throw error;
      await new Promise<void>((resolve, reject) => {
        const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(signal.reason); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, delay);
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      });
    }
  }
}
