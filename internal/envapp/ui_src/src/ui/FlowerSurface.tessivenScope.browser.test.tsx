import '../index.css';
import './flower-feature.css';
import { beforeEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
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
