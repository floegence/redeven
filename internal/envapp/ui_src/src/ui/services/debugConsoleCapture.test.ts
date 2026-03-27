// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';

import { redevenV1TypeIds } from '../protocol/redeven_v1/typeIds';
import {
  captureDebugConsoleProtocolCall,
  installDebugConsoleBrowserCapture,
  resetDebugConsoleCaptureForTests,
  setDebugConsoleCaptureEnabled,
  subscribeDebugConsoleClientEvents,
} from './debugConsoleCapture';

afterEach(() => {
  resetDebugConsoleCaptureForTests();
});

describe('debugConsoleCapture', () => {
  it('captures gateway fetch request and response payloads', async () => {
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
});
