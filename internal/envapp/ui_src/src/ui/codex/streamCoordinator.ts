import { createSignal, onCleanup, untrack, type Accessor } from 'solid-js';

import { connectCodexEventStream } from './api';
import type {
  CodexEvent,
  CodexStreamTransportState,
} from './types';

const STREAM_RETRY_DELAYS_MS = [250, 500, 1000, 2000, 4000];

type StreamBinding = Readonly<{
  threadID: string;
  afterSeq: number;
  resolveAfterSeq: () => number;
  onEvent: (event: CodexEvent) => void;
  onDesynced: (event: CodexEvent) => Promise<void> | void;
}>;

class StreamDesyncedError extends Error {
  event: CodexEvent;

  constructor(event: CodexEvent) {
    super(String(event.transport?.reason ?? '').trim() || 'Live event stream lost continuity.');
    this.name = 'StreamDesyncedError';
    this.event = event;
  }
}

function defaultTransportState(): CodexStreamTransportState {
  return {
    phase: 'idle',
    thread_id: null,
    retry_count: 0,
    last_event_at_unix_ms: null,
    last_disconnect_reason: null,
    last_lagged_dropped_events: 0,
    stream_epoch: null,
    desync_reason: null,
  };
}

function retryDelayMs(retryCount: number): number {
  return STREAM_RETRY_DELAYS_MS[Math.min(Math.max(0, retryCount - 1), STREAM_RETRY_DELAYS_MS.length - 1)] ?? 4000;
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error && typeof error === 'object' && 'name' in error && String((error as { name?: string }).name ?? '') === 'AbortError',
  );
}

function waitWithSignal(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timeoutID = window.setTimeout(() => {
      signal.removeEventListener('abort', handleAbort);
      resolve();
    }, Math.max(0, ms));
    const handleAbort = () => {
      window.clearTimeout(timeoutID);
      signal.removeEventListener('abort', handleAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', handleAbort, { once: true });
  });
}

export function createCodexStreamCoordinator(args?: {
  connectStream?: typeof connectCodexEventStream;
}) {
  const connectStream = args?.connectStream ?? connectCodexEventStream;
  const [transportState, setTransportState] = createSignal<CodexStreamTransportState>(defaultTransportState());
  let bindingGeneration = 0;
  let activeController: AbortController | null = null;

  const stopActiveBinding = (phase: CodexStreamTransportState['phase'] = 'idle') => {
    bindingGeneration += 1;
    if (activeController) {
      activeController.abort();
      activeController = null;
    }
    const previousThreadID = untrack(() => transportState().thread_id);
    setTransportState({
      ...defaultTransportState(),
      phase,
      thread_id: phase === 'idle' ? null : previousThreadID,
    });
  };

  const attach = (binding: StreamBinding | null) => {
    stopActiveBinding(binding ? 'connecting' : 'idle');
    if (!binding) {
      return;
    }

    const generation = bindingGeneration;
    const controller = new AbortController();
    activeController = controller;

    const isCurrentBinding = () => bindingGeneration === generation && activeController === controller && !controller.signal.aborted;

    const runLoop = async () => {
      let retryCount = 0;
      while (isCurrentBinding()) {
        const afterSeq = Math.max(0, Number(binding.resolveAfterSeq() ?? binding.afterSeq) || 0);
        setTransportState((current) => ({
          ...current,
          phase: retryCount > 0 ? 'reconnecting' : 'connecting',
          thread_id: binding.threadID,
          retry_count: retryCount,
          last_disconnect_reason: retryCount > 0 ? current.last_disconnect_reason : null,
          desync_reason: null,
        }));

        try {
          await connectStream({
            threadID: binding.threadID,
            afterSeq,
            signal: controller.signal,
            onEvent: (event) => {
              // Desync is a transport concern, not a transcript delta.
              if (event.type === 'stream_desynced' || String(event.transport?.state ?? '').trim() === 'desynced') {
                throw new StreamDesyncedError(event);
              }
              binding.onEvent(event);
              const lagged = String(event.transport?.state ?? '').trim() === 'lagged';
              setTransportState((current) => ({
                ...current,
                phase: lagged ? 'lagged' : 'live',
                thread_id: binding.threadID,
                retry_count: retryCount,
                last_event_at_unix_ms: Math.max(
                  0,
                  Number(event.stream?.last_event_at_unix_ms ?? Date.now()) || 0,
                ),
                last_disconnect_reason: null,
                last_lagged_dropped_events: lagged
                  ? Math.max(0, Number(event.transport?.dropped_events ?? 0) || 0)
                  : current.last_lagged_dropped_events,
                stream_epoch: typeof event.stream?.stream_epoch === 'number'
                  ? event.stream.stream_epoch
                  : current.stream_epoch,
                desync_reason: null,
              }));
            },
          });
          if (!isCurrentBinding()) {
            return;
          }
          setTransportState((current) => ({
            ...current,
            phase: 'reconnecting',
            thread_id: binding.threadID,
            retry_count: retryCount + 1,
            last_disconnect_reason: 'Live event stream closed. Reconnecting...',
          }));
        } catch (error) {
          if (isAbortError(error) || !isCurrentBinding()) {
            return;
          }
          if (error instanceof StreamDesyncedError) {
            const desyncReason = String(
              error.event.transport?.reason ??
              error.message ??
              'Live event stream lost continuity.',
            ).trim() || 'Live event stream lost continuity.';
            setTransportState((current) => ({
              ...current,
              phase: 'desynced',
              thread_id: binding.threadID,
              retry_count: retryCount,
              last_disconnect_reason: desyncReason,
              desync_reason: desyncReason,
              stream_epoch: typeof error.event.stream?.stream_epoch === 'number'
                ? error.event.stream.stream_epoch
                : current.stream_epoch,
            }));
            await binding.onDesynced(error.event);
            if (!isCurrentBinding()) {
              return;
            }
            retryCount = 0;
            continue;
          }
          const message = error instanceof Error ? error.message : String(error);
          setTransportState((current) => ({
            ...current,
            phase: 'reconnecting',
            thread_id: binding.threadID,
            retry_count: retryCount + 1,
            last_disconnect_reason: String(message ?? '').trim() || 'Live event stream disconnected.',
          }));
        }

        retryCount += 1;
        try {
          await waitWithSignal(retryDelayMs(retryCount), controller.signal);
        } catch {
          return;
        }
      }
    };

    void runLoop();
  };

  onCleanup(() => {
    stopActiveBinding('closed');
  });

  return {
    transportState: transportState as Accessor<CodexStreamTransportState>,
    attach,
    close: () => stopActiveBinding('closed'),
  };
}
