import type { FlowerSurfaceAdapter, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { recoverHistoryRequest } from './historyReadRecovery';

// A page is authorized read-only demand. Preserve delivered rows through a
// transport failure and let the caller cancel; elapsed time is not failure.
export async function loadFlowerThreadList(
  adapter: Pick<FlowerSurfaceAdapter, 'listThreads'>,
  onPage?: (threads: readonly FlowerThreadSnapshot[]) => void,
  signal: AbortSignal = new AbortController().signal,
): Promise<readonly FlowerThreadSnapshot[]> {
  return recoverHistoryRequest(readSignal => adapter.listThreads({ signal: readSignal, onPage: threads => {
    readSignal.throwIfAborted();
    onPage?.(threads);
  } }), 'Conversation read interrupted.', signal);
}
