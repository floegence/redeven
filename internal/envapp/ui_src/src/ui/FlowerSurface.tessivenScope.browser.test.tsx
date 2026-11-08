import '../index.css';
import './flower-feature.css';
import { beforeEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { createSignal } from 'solid-js';
import type { FlowerLiveStreamEnvelope } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

beforeEach(() => page.viewport(1100, 820));

it.each(['full', 'companion'] as const)('keeps a Tessiven conversation out of %s history and direct navigation', async presentation => {
  const ordinary = thread({ thread_id: 'ordinary', title: 'Everyday conversation' });
  const dedicated = thread({ thread_id: 'canvas-thread', title: 'Canvas private conversation', tessiven_canvas_id: 'commerce',
    messages: [{ id: 'answer', role: 'assistant', content: 'Canvas-only answer', status: 'complete', created_at_ms: 1 }] });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [ordinary, dedicated],
    loadThread: async id => liveBootstrap(id === ordinary.thread_id ? ordinary : dedicated) }, {
    presentation, companionOpen: true, focusThreadRequest: { request_id: 'direct-canvas', thread_id: dedicated.thread_id },
  });
  await waitFor(() => runtime.textContent?.includes('Conversation could not load.') === true);
  expect(runtime.textContent).not.toContain('Canvas-only answer');
  expect(runtime.querySelector('[data-flower-thread-id="canvas-thread"]')).toBeNull();
  await page.screenshot({ path: `__screenshots__/tessiven-isolation-${presentation}.png` });
});

it.each([false, true])('rejects canvas live content before and after metadata admission (listed: %s)', async listed => {
  const ordinary = thread({ thread_id: 'ordinary', title: 'Everyday conversation' });
  const dedicated = thread({ thread_id: 'canvas-live', title: 'Canvas private conversation', tessiven_canvas_id: 'commerce',
    messages: [{ id: 'answer', role: 'assistant', content: 'Canvas-only live answer', status: 'complete', created_at_ms: 1 }] });
  let releaseRead!: () => void;
  const pendingRead = new Promise<void>(resolve => { releaseRead = resolve; });
  let readStarted = false;
  let emit: ((event: FlowerLiveStreamEnvelope | null) => void) | undefined;
  const [focus, setFocus] = createSignal<{ request_id: string; thread_id: string }>();
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [ordinary],
    loadThread: async () => { readStarted = true; await pendingRead; return liveBootstrap(dedicated); },
    async *connectLiveStream({ signal }) {
      yield { schema_version: 3, kind: 'ready', baseline_complete: true, summaries: listed ? [ordinary, dedicated] : [ordinary] };
      while (!signal.aborted) {
        const event = await new Promise<FlowerLiveStreamEnvelope | null>(resolve => { emit = resolve; signal.addEventListener('abort', () => resolve(null), { once: true }); });
        if (!event) return;
        emit = undefined;
        yield event;
      }
    },
  }, { get focusThreadRequest() { return focus(); } });
  const push = async (version: number) => {
    await waitFor(() => emit !== undefined);
    const send = emit!;
    emit = undefined;
    send({ schema_version: 3, kind: 'thread.batch', thread_id: dedicated.thread_id, current: liveBootstrap(dedicated, version).current });
    await waitFor(() => emit !== undefined);
  };
  await waitFor(() => emit !== undefined);
  setFocus({ request_id: 'direct-canvas-live', thread_id: dedicated.thread_id });
  await waitFor(() => readStarted);
  await push(2);
  expect(runtime.textContent).not.toContain('Canvas-only live answer');
  releaseRead();
  await waitFor(() => runtime.textContent?.includes('Conversation could not load.') === true);
  await push(3);
  expect(runtime.textContent).not.toContain('Canvas-only live answer');
  expect(runtime.querySelector('[data-flower-thread-id="canvas-live"]')).toBeNull();
});
