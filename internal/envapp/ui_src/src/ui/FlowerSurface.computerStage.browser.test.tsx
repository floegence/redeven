import '../index.css';
import './flower-feature.css';

import { describe, expect, it, vi } from 'vitest';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const FRAME_REF = `computer://browser-main/${'a'.repeat(64)}`;
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Flower computer stage', () => {
  it('resolves opaque computer frames into an image in the floating stage', async () => {
    const threadID = 'computer-stage-thread';
    const current = thread({
      thread_id: threadID,
      title: 'Open test page',
      status: 'running',
      messages: [{
        id: 'computer-message', turn_id: 'computer-turn', run_id: 'computer-run', role: 'assistant', content: '', status: 'streaming', created_at_ms: 10,
        blocks: [activityTimeline({
          thread_id: threadID, run_id: 'computer-run', turn_id: 'computer-turn', status: 'running',
          items: [activityItem({
            item_id: 'computer-screenshot', tool_id: 'computer-screenshot', tool_name: 'computer.screenshot',
            renderer: 'computer', status: 'running', label: 'Reading test page',
            payload: {
              target_id: 'browser-main', target_name: 'Redeven Managed Browser',
              action_summary: 'Reading test page', execution_location: 'local', after_frame: FRAME_REF,
            },
          })],
        })],
      }],
    });
    const loadComputerFrame = vi.fn(async () => new Blob([
      Uint8Array.from(atob(ONE_PIXEL_PNG), (value) => value.charCodeAt(0)),
    ], { type: 'image/png' }));
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      loadComputerFrame,
      listThreads: vi.fn(async () => [current]),
      loadThread: vi.fn(async () => liveBootstrap(current, 1)),
    }, { focusThreadRequest: { request_id: 'focus-computer-stage', thread_id: threadID } });

    await waitFor(() => runtime.querySelector('.flower-computer-stage') !== null);
    await waitFor(() => loadComputerFrame.mock.calls.length === 1);
    await waitFor(() => (runtime.querySelector('.flower-computer-stage-frame') as HTMLImageElement | null)?.naturalWidth === 1);
    expect(runtime.querySelector('.flower-computer-stage')?.getAttribute('role')).toBe('dialog');
    expect(runtime.querySelector('.flower-computer-stage-target')?.textContent).toContain('Redeven Managed Browser');
    expect(runtime.querySelector('.flower-computer-stage-frame')).not.toBeNull();
    expect(loadComputerFrame).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: threadID, target_id: 'browser-main', resource_ref: FRAME_REF, sha256: 'a'.repeat(64),
    }));
  });
});
