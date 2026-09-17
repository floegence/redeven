// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./controlplaneApi', () => ({ getLocalRuntime: async () => ({ mode: 'local' }) }));

import { connectNotesEventStream } from './notesApi';
import { connectWorkbenchLayoutEventStream } from './workbenchLayoutApi';
import { connectDiagnosticsStream } from './diagnosticsApi';
import { subscribeContainerOperation, subscribeContainerOperationEvents } from './containerResourcesApi';
import { connectPluginMarketEventStream } from '../plugins/pluginApi';
import { createManagedServiceOperationController, type ManagedOperation } from '../pages/managedServiceOperationController';
import { clearLocalAccessResumeToken, writeLocalAccessResumeToken } from './localAccessAuth';

const operation: ManagedOperation = {
  operation_id: 'operation-1', service_id: 'service-1', action: 'start',
  state: 'running', stage: 'starting', progress_current: 0, progress_total: 3,
};
const terminal = { ...operation, state: 'succeeded' };
type Listener = (event: any) => void;
const adapters = [
  { name: 'notes', path: '/notes/events?after_seq=6', event: 'message', payload: { seq: 7, type: 'topic.updated' },
    connect: (signal: AbortSignal, onEvent: Listener) => connectNotesEventStream({ afterSeq: 6, signal, onEvent }) },
  { name: 'workbench', path: '/workbench/layout/events?after_seq=6', event: 'message', payload: { seq: 7, type: 'layout.updated', payload: {} },
    connect: (signal: AbortSignal, onEvent: Listener) => connectWorkbenchLayoutEventStream({ afterSeq: 6, signal, onEvent }) },
  { name: 'diagnostics', path: '/debug/diagnostics/stream?limit=200', event: 'diagnostics_event', payload: { key: 'evt-7', event: { trace_id: 'trace-7' } },
    connect: (signal: AbortSignal, onEvent: Listener) => connectDiagnosticsStream({ signal, onEvent }) },
  { name: 'plugin market', path: '/plugins/market/catalog/events?after_seq=6', event: 'message', payload: { seq: 7, state: 'ready', generation: 41, stale: false },
    connect: (signal: AbortSignal, onEvent: Listener) => connectPluginMarketEventStream({ afterSeq: 6, signal, onEvent }) },
  { name: 'container progress', path: '/container-resource-operations/operation-1/events?after_sequence=6', event: 'operation', payload: { sequence: 7, operation_id: 'operation-1', type: 'progress' },
    connect: (signal: AbortSignal, onEvent: Listener) => subscribeContainerOperationEvents('operation-1', onEvent, signal, 6) },
  { name: 'container operation', path: '/container-resource-operations/operation-1/events', event: 'message', payload: { operation_id: 'operation-1' },
    connect: (signal: AbortSignal, onEvent: Listener) => subscribeContainerOperation('operation-1', onEvent, signal) },
];

describe('background event stream request policy', () => {
  beforeEach(() => writeLocalAccessResumeToken('test-resume-token'));
  afterEach(() => {
    clearLocalAccessResumeToken();
    vi.unstubAllGlobals();
  });

  for (const adapter of adapters) {
    it(`${adapter.name} keeps authentication, messages, and resumed cursors at low priority`, async () => {
      const onEvent = vi.fn();
      const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
        if (!url.includes('/events') && !url.includes('/stream')) {
          return new Response(JSON.stringify({ data: terminal }));
        }
        expect(url).toBe(`/_redeven_proxy/api${adapter.path}`);
        expect(init).toMatchObject({ priority: 'low', method: 'GET', credentials: 'same-origin', cache: 'no-store' });
        expect(new Headers(init?.headers).get('Accept')).toBe('text/event-stream');
        expect(new Headers(init?.headers).get('X-Redeven-Access-Resume')).toBe('test-resume-token');
        const bytes = new TextEncoder().encode(`: keepalive\n\nevent: ${adapter.event}\ndata: ${JSON.stringify(adapter.payload)}\n\n`);
        return new Response(new ReadableStream({ start(controller) {
          controller.enqueue(bytes.slice(0, 19));
          controller.enqueue(bytes.slice(19));
          controller.close();
        } }));
      });
      vi.stubGlobal('fetch', fetchMock);
      // Each reconnect receives a fresh abort signal while preserving the caller's cursor.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const controller = new AbortController();
        await adapter.connect(controller.signal, onEvent);
        const streamCall = [...fetchMock.mock.calls].reverse().find(([url]) => url === `/_redeven_proxy/api${adapter.path}`);
        expect(streamCall?.[1]?.signal).toBe(controller.signal);
        controller.abort();
        expect(streamCall?.[1]?.signal?.aborted).toBe(true);
      }
      expect(onEvent).toHaveBeenCalledTimes(2);
      expect(onEvent.mock.lastCall?.[0]).toMatchObject(adapter.name === 'container operation' ? terminal : adapter.payload);
    });

    it(`${adapter.name} propagates cancellation without reconnecting internally`, async () => {
      const controller = new AbortController();
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
      }));
      vi.stubGlobal('fetch', fetchMock);
      const onEvent = vi.fn();
      const result = adapter.connect(controller.signal, onEvent);
      const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
      controller.abort();
      await rejected;
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(onEvent).not.toHaveBeenCalled();
    });
  }

  it('tracks managed service progress with authenticated low priority and releases its reader', async () => {
    const cancelled = vi.fn();
    const fetchMock = vi.fn(async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(terminal)}\n\n`));
    }, cancel: cancelled })));
    vi.stubGlobal('fetch', fetchMock);
    const onOperationUpdated = vi.fn();
    const controller = createManagedServiceOperationController({
      streamFailedMessage: () => 'Stream failed', timedOutMessage: () => 'Timed out', onOperationUpdated,
    });
    try {
      await expect(controller.track(operation)).resolves.toEqual(terminal);
      const [url, init] = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0];
      expect(url).toBe('/_redeven_proxy/api/managed-web-service-operations/operation-1/events');
      expect(init).toMatchObject({ priority: 'low', credentials: 'same-origin', cache: 'no-store', method: 'GET' });
      expect(new Headers(init.headers).get('X-Redeven-Access-Resume')).toBe('test-resume-token');
      expect(onOperationUpdated).toHaveBeenLastCalledWith(terminal);
      expect(cancelled).toHaveBeenCalledOnce();
    } finally {
      controller.dispose();
    }
  });

  it('aborts managed service observation on disposal without cancelling the operation', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = createManagedServiceOperationController({ streamFailedMessage: () => 'Stream failed', timedOutMessage: () => 'Timed out' });
    const result = controller.track(operation);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    controller.dispose();
    await rejected;
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
