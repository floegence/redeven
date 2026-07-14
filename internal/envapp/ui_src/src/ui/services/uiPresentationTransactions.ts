import type { UIFirstSelectionEvent } from '@floegence/floe-webapp-core';

export type UIPresentationTransactionEvent = Readonly<{
  surface: string;
  source: string;
  target: string;
  phase: UIFirstSelectionEvent<unknown, unknown>['phase'];
  transactionKey: string;
  startedAt: number;
  timestamp: number;
  elapsedMs: number;
}>;

type UIPresentationTransactionListener = (event: UIPresentationTransactionEvent) => void;

const listeners = new Set<UIPresentationTransactionListener>();
let recorderSequence = 0;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function subscribeUIPresentationTransactions(listener: UIPresentationTransactionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishUIPresentationTransaction(event: UIPresentationTransactionEvent): void {
  for (const listener of listeners) listener(event);
}

export function createUIPresentationEventRecorder<T, M>(options: Readonly<{
  surface: string;
  source: string | ((event: UIFirstSelectionEvent<T, M>) => string);
  target?: (value: T) => string;
}>): (event: UIFirstSelectionEvent<T, M>) => void {
  const recorderID = ++recorderSequence;
  const surface = compact(options.surface) || 'unknown';

  return (event) => {
    const source = compact(typeof options.source === 'function' ? options.source(event) : options.source) || 'unknown';
    const target = compact(options.target?.(event.value) ?? event.value) || 'unknown';
    const presentationEvent: UIPresentationTransactionEvent = {
      surface,
      source,
      target,
      phase: event.phase,
      transactionKey: `${recorderID}:${event.transactionId}`,
      startedAt: event.startedAt,
      timestamp: event.timestamp,
      elapsedMs: event.elapsedMs,
    };
    publishUIPresentationTransaction(presentationEvent);
  };
}
