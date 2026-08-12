import type { FlowerThreadSnapshot, FlowerThreadStatus } from './contracts/flowerSurfaceContracts';

export type ThreadStoreSummary = Readonly<{ thread_id: string; title?: string; status?: FlowerThreadStatus; revision: number }>;
export type ThreadStoreDetail = Readonly<{ thread_id: string; revision: number; messages: readonly unknown[]; status?: FlowerThreadStatus; snapshot?: FlowerThreadSnapshot }>;
export type ThreadStoreEvent = Readonly<{ thread_id: string; revision: number; id: string; kind: 'turn_state' | 'timeline_event'; payload: Readonly<{ status?: FlowerThreadStatus }> }>;
export type ThreadStoreOperationKind = 'send' | 'resolve' | 'cancel' | 'retry';
export type ThreadStoreOperation = Readonly<{ thread_id: string; request_id: string; kind: ThreadStoreOperationKind }>;

type MutableDetail = { thread_id: string; revision: number; messages: readonly unknown[]; status?: FlowerThreadStatus };

export function createThreadStore() {
  const summaries = new Map<string, ThreadStoreSummary>();
  const details = new Map<string, MutableDetail>();
  let selectedThreadId = '';
  let selectionGeneration = 0;
  const resyncThreads = new Set<string>();
  const operations = new Map<string, ThreadStoreOperation>();
  const mergeStatus = (current: FlowerThreadStatus | undefined, next: FlowerThreadStatus | undefined) => {
    if (!next) return current;
    const priority: Record<FlowerThreadStatus, number> = {
      idle: 0, running: 1, waiting_approval: 2, waiting_user: 3,
      success: 0, failed: 0, canceled: 0, read_only: 0,
    };
    if (!current || priority[next] >= priority[current] || next === 'success' || next === 'failed' || next === 'canceled') return next;
    return current;
  };
  return {
    seedSummary(summary: Omit<ThreadStoreSummary, 'revision'> & { revision?: number }) { summaries.set(summary.thread_id, { ...summary, revision: summary.revision ?? 0 }); },
    selectThread(threadId: string) { selectedThreadId = threadId.trim(); selectionGeneration += 1; return selectionGeneration; },
    selectedThreadId: () => selectedThreadId,
    selectionGeneration: () => selectionGeneration,
    detail(threadId: string): ThreadStoreDetail | undefined { return details.get(threadId.trim()); },
    applySnapshot(snapshot: FlowerThreadSnapshot, revision: number): boolean {
      const id = snapshot.thread_id.trim();
      if (!id || id !== selectedThreadId) return false;
      const previous = details.get(id);
      if (previous && revision < previous.revision) return false;
      const messages = snapshot.messages.length > 0 ? [...snapshot.messages] : previous?.messages ?? [];
      details.set(id, { thread_id: id, revision, messages, status: mergeStatus(previous?.status, snapshot.status), snapshot: { ...snapshot, messages } });
      return true;
    },
    snapshot(threadId: string): FlowerThreadSnapshot | undefined { return details.get(threadId.trim())?.snapshot; },
    applyDetail(detail: ThreadStoreDetail): boolean {
      if (detail.thread_id.trim() !== selectedThreadId) return false;
      const previous = details.get(detail.thread_id);
      if (previous && detail.revision < previous.revision) return false;
      details.set(detail.thread_id, { ...detail, status: mergeStatus(previous?.status, detail.status), messages: [...detail.messages] });
      return true;
    },
    applySummary(summary: Omit<ThreadStoreSummary, 'title'> & { title?: string; messages?: readonly unknown[] }): boolean {
      const id = summary.thread_id.trim();
      const previousSummary = summaries.get(id);
      if (previousSummary && summary.revision < previousSummary.revision) return false;
      summaries.set(id, { ...summary, revision: summary.revision });
      const previousDetail = details.get(id);
      if (previousDetail && summary.revision < previousDetail.revision) return true;
      details.set(id, { thread_id: id, revision: summary.revision, messages: summary.messages && summary.messages.length > 0 ? [...summary.messages] : previousDetail?.messages ?? [], status: mergeStatus(previousDetail?.status, summary.status) });
      return true;
    },
    applyEvent(event: ThreadStoreEvent): 'applied' | 'ignored' | 'resync' {
      const id = event.thread_id.trim();
      const previous = details.get(id);
      if (!previous || event.revision <= previous.revision) return 'ignored';
      if (event.revision !== previous.revision + 1) { resyncThreads.add(id); return 'resync'; }
      details.set(id, { ...previous, revision: event.revision, status: mergeStatus(previous.status, event.payload.status) });
      return 'applied';
    },
    needsResync(threadId: string) { return resyncThreads.has(threadId.trim()); },
    setOperation(operation: ThreadStoreOperation) {
      const id = operation.thread_id.trim();
      if (!id) return;
      operations.set(id, { ...operation, thread_id: id });
    },
    clearOperation(threadId: string) { operations.delete(threadId.trim()); },
    operation(threadId: string): ThreadStoreOperation | undefined { return operations.get(threadId.trim()); },
  };
}
