export type WorkbenchRenderTransactionReason = 'theme' | 'mode';

export type WorkbenchRenderTransaction = Readonly<{
  id: number;
  reason: WorkbenchRenderTransactionReason;
  frameCount: number;
}>;

export const REDEVEN_WORKBENCH_RENDER_TRANSACTION_EVENT = 'redeven:workbench-render-transaction';

let workbenchRenderTransactionSeq = 0;

function normalizeFrameCount(value: number | undefined): number {
  const frameCount = Number(value ?? 1);
  if (!Number.isFinite(frameCount)) {
    return 1;
  }
  return Math.min(4, Math.max(1, Math.trunc(frameCount)));
}

function isWorkbenchRenderTransactionReason(value: unknown): value is WorkbenchRenderTransactionReason {
  return value === 'theme' || value === 'mode';
}

function normalizeWorkbenchRenderTransaction(value: unknown): WorkbenchRenderTransaction | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<WorkbenchRenderTransaction>;
  if (!isWorkbenchRenderTransactionReason(candidate.reason)) {
    return null;
  }
  return {
    id: Number.isFinite(Number(candidate.id)) ? Number(candidate.id) : 0,
    reason: candidate.reason,
    frameCount: normalizeFrameCount(candidate.frameCount),
  };
}

export function requestWorkbenchRenderTransaction(
  reason: WorkbenchRenderTransactionReason,
  options?: Readonly<{ frameCount?: number }>,
): WorkbenchRenderTransaction | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const transaction: WorkbenchRenderTransaction = {
    id: ++workbenchRenderTransactionSeq,
    reason,
    frameCount: normalizeFrameCount(options?.frameCount),
  };

  window.dispatchEvent(new CustomEvent(REDEVEN_WORKBENCH_RENDER_TRANSACTION_EVENT, {
    detail: transaction,
  }));
  return transaction;
}

export function subscribeWorkbenchRenderTransactions(
  listener: (transaction: WorkbenchRenderTransaction) => void,
): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const handleTransaction = (event: Event) => {
    const transaction = normalizeWorkbenchRenderTransaction((event as CustomEvent<unknown>).detail);
    if (!transaction) {
      return;
    }
    listener(transaction);
  };

  window.addEventListener(REDEVEN_WORKBENCH_RENDER_TRANSACTION_EVENT, handleTransaction);
  return () => {
    window.removeEventListener(REDEVEN_WORKBENCH_RENDER_TRANSACTION_EVENT, handleTransaction);
  };
}
