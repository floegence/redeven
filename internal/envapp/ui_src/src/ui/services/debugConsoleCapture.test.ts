// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { redevenV1TypeIds } from '../protocol/redeven_v1/typeIds';
import {
  captureDebugConsoleProtocolCall,
  captureDebugConsoleProtocolNotify,
  getDebugConsoleClientEventRingSnapshot,
  installDebugConsoleBrowserCapture,
  publishDebugConsoleStructuredEvent,
  resetDebugConsoleCaptureForTests,
  setDebugConsoleCaptureEnabled,
  subscribeDebugConsoleClientEvents,
} from './debugConsoleCapture';

afterEach(() => {
  resetDebugConsoleCaptureForTests();
});

describe('debugConsoleCapture', () => {
  it('captures local API fetch request and response payloads', async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: {
        thread: {
          id: 'thread_1',
        },
      },
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-Redeven-Debug-Trace-ID': 'trace-http-1',
      },
    }));
    globalThis.fetch = fetchMock as typeof fetch;

    const events: any[] = [];
    const unsubscribe = subscribeDebugConsoleClientEvents((event) => events.push(event));
    setDebugConsoleCaptureEnabled(true);
    installDebugConsoleBrowserCapture();

    await fetch('http://localhost/_redeven_proxy/api/ai/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        title: 'Inspect request payloads',
      }),
    });

    await new Promise((resolve) => window.setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]?.trace_id).toBe('trace-http-1');
    expect(events[0]?.detail?.request?.payload?.title).toBe('Inspect request payloads');
    expect(events[0]?.detail?.response?.payload?.data?.thread?.id).toBe('thread_1');

    unsubscribe();
    globalThis.fetch = originalFetch;
  });

  it('captures protocol rpc payload and response payloads', async () => {
    const events: any[] = [];
    const unsubscribe = subscribeDebugConsoleClientEvents((event) => events.push(event));
    setDebugConsoleCaptureEnabled(true);

    const response = await captureDebugConsoleProtocolCall({
      typeID: redevenV1TypeIds.ai.sendUserTurn,
      payload: {
        thread_id: 'thread_1',
        text: 'Hello world',
      },
      execute: async () => ({
        message_id: 'msg_1',
        run_id: 'run_1',
      }),
    });

    expect(response.run_id).toBe('run_1');
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('rpc://redeven_v1/ai.sendUserTurn');
    expect(events[0]?.detail?.request?.payload?.thread_id).toBe('thread_1');
    expect(events[0]?.detail?.response?.payload?.run_id).toBe('run_1');

    unsubscribe();
  });

  it('projects terminal input to its byte count without retaining terminal content', async () => {
    const secret = 'terminal-input-secret-99417';
    const encodedSecret = btoa(secret);
    const events: any[] = [];
    const unsubscribe = subscribeDebugConsoleClientEvents((event) => events.push(event));
    setDebugConsoleCaptureEnabled(true);

    await captureDebugConsoleProtocolNotify({
      typeID: redevenV1TypeIds.terminal.input,
      payload: {
        session_id: 'session-sensitive',
        conn_id: 'connection-sensitive',
        data_b64: encodedSecret,
      },
      execute: async () => undefined,
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.detail?.request?.payload).toEqual({
      input_bytes: new TextEncoder().encode(secret).byteLength,
    });
    expect(events[0]?.detail?.response?.payload).toEqual({});
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(encodedSecret);
    expect(serialized).not.toContain('session-sensitive');
    expect(serialized).not.toContain('connection-sensitive');

    unsubscribe();
  });

  it('projects terminal history to recovery metadata without retaining output chunks', async () => {
    const secret = 'terminal-history-secret-5e427';
    const encodedSecret = btoa(secret);
    const events: any[] = [];
    const unsubscribe = subscribeDebugConsoleClientEvents((event) => events.push(event));
    setDebugConsoleCaptureEnabled(true);

    await captureDebugConsoleProtocolCall({
      typeID: redevenV1TypeIds.terminal.history,
      payload: {
        session_id: 'session-sensitive',
        start_seq: 3,
        end_seq: 12,
        history_generation: 7,
        limit_chunks: 256,
        max_bytes: 393_216,
      },
      execute: async () => ({
        chunks: [{ sequence: 3, timestamp_ms: 100, data_b64: encodedSecret }],
        next_start_seq: 4,
        has_more: true,
        first_sequence: 3,
        last_sequence: 3,
        covered_through_sequence: 3,
        snapshot_end_sequence: 12,
        first_retained_sequence: 2,
        history_generation: 7,
        history_reset: false,
        history_truncated: true,
        covered_bytes: 29,
        total_bytes: 256,
      }),
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.detail?.request?.payload).toEqual({
      start_sequence: 3,
      end_sequence: 12,
      history_generation: 7,
      limit_chunks: 256,
      max_bytes: 393_216,
    });
    expect(events[0]?.detail?.response?.payload).toEqual({
      page_count: 1,
      chunk_count: 1,
      next_start_sequence: 4,
      has_more: true,
      first_sequence: 3,
      last_sequence: 3,
      covered_through_sequence: 3,
      snapshot_end_sequence: 12,
      first_retained_sequence: 2,
      history_generation: 7,
      history_reset: false,
      history_truncated: true,
      covered_bytes: 29,
      total_bytes: 256,
    });
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(encodedSecret);
    expect(serialized).not.toContain('session-sensitive');

    unsubscribe();
  });

  it('does not retain terminal content embedded in protocol failure messages', async () => {
    const secret = 'terminal-failure-secret-a767';
    const encodedSecret = btoa(secret);
    const events: any[] = [];
    const unsubscribe = subscribeDebugConsoleClientEvents((event) => events.push(event));
    setDebugConsoleCaptureEnabled(true);

    await expect(captureDebugConsoleProtocolCall({
      typeID: redevenV1TypeIds.terminal.history,
      payload: {
        session_id: 'session-sensitive',
        start_seq: 1,
        end_seq: -1,
      },
      execute: async () => {
        throw new Error(`history failed after ${secret} ${encodedSecret}`);
      },
    })).rejects.toThrow(secret);

    expect(events).toHaveLength(1);
    expect(events[0]?.message).toBe('Terminal history request failed');
    expect(events[0]?.detail?.response?.error_message).toBe('Terminal history request failed');
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(encodedSecret);
    expect(serialized).not.toContain('session-sensitive');

    unsubscribe();
  });

  it('does not retain raw RPC events in the structured ring', async () => {
    const execute = vi.fn(async () => ({ run_id: 'run-disabled' }));

    setDebugConsoleCaptureEnabled(true);
    await captureDebugConsoleProtocolCall({
      typeID: redevenV1TypeIds.ai.sendUserTurn,
      payload: { text: 'raw payload must not be retained' },
      execute,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(getDebugConsoleClientEventRingSnapshot()).toEqual({
      capacity: 160,
      droppedCount: 0,
      events: [],
    });
  });

  it('retains structured events while capture is disabled and replays the bounded ring', () => {
    for (let index = 0; index < 161; index += 1) {
      publishDebugConsoleStructuredEvent({
        created_at: new Date(index).toISOString(),
        source: 'ui',
        scope: 'terminal_recovery',
        kind: 'phase_transition',
        detail: { index },
      });
    }

    const snapshot = getDebugConsoleClientEventRingSnapshot();
    expect(snapshot.capacity).toBe(160);
    expect(snapshot.droppedCount).toBe(1);
    expect(snapshot.events).toHaveLength(160);
    expect(snapshot.events[0]?.detail?.index).toBe(1);
    expect(snapshot.events.at(-1)?.detail?.index).toBe(160);

    const replayed: any[] = [];
    const unsubscribe = subscribeDebugConsoleClientEvents((event) => replayed.push(event));
    expect(replayed).toEqual(snapshot.events);

    publishDebugConsoleStructuredEvent({
      created_at: new Date(162).toISOString(),
      source: 'ui',
      scope: 'terminal_recovery',
      kind: 'degraded',
      detail: { error_code: 'history_fetch_failed' },
    });
    expect(replayed.at(-1)?.kind).toBe('degraded');
    expect(getDebugConsoleClientEventRingSnapshot().droppedCount).toBe(2);

    unsubscribe();
  });

  it('allows callers to subscribe without replaying existing structured events', () => {
    publishDebugConsoleStructuredEvent({
      created_at: new Date(1).toISOString(),
      source: 'ui',
      scope: 'terminal_recovery',
      kind: 'baseline_ready',
    });
    const events: any[] = [];
    const unsubscribe = subscribeDebugConsoleClientEvents(
      (event) => events.push(event),
      { replayExisting: false },
    );

    expect(events).toEqual([]);
    publishDebugConsoleStructuredEvent({
      created_at: new Date(2).toISOString(),
      source: 'ui',
      scope: 'terminal_recovery',
      kind: 'live',
    });
    expect(events.map((event) => event.kind)).toEqual(['live']);

    unsubscribe();
  });
});
