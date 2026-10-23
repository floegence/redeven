import type { FlowerSurfaceAdapter, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';

const THREAD_LIST_PAGE_TIMEOUT_MS = 10_000;

// Each delivered page proves progress. A stalled page aborts its transport while
// already delivered conversations remain available to the user.
export async function loadFlowerThreadList(
  adapter: Pick<FlowerSurfaceAdapter, 'listThreads'>,
  onPage?: (threads: readonly FlowerThreadSnapshot[]) => void,
  signal?: AbortSignal,
): Promise<readonly FlowerThreadSnapshot[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectWait: (error: unknown) => void = () => undefined;
  const abort = () => { controller.abort(signal?.reason); rejectWait(controller.signal.reason); };
  const progress = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      const error = Object.assign(new Error('Conversations could not be loaded in time.'), { code: 'flower_thread_list_timeout' });
      controller.abort(error);
      rejectWait(error);
    }, THREAD_LIST_PAGE_TIMEOUT_MS);
  };
  try {
    signal?.throwIfAborted();
    const interrupted = new Promise<never>((_, reject) => { rejectWait = reject; });
    signal?.addEventListener('abort', abort, { once: true });
    progress();
    return await Promise.race([adapter.listThreads({ signal: controller.signal, onPage: threads => {
      controller.signal.throwIfAborted();
      progress();
      onPage?.(threads);
    } }), interrupted]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
