import '../index.css';
import './flower-feature.css';

import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FlowerComputerStage } from '../../../../flower_ui/src/FlowerComputerStage';
import { activityItem, activityTimeline, adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

const FRAME_REF = `computer://browser-main/${'a'.repeat(64)}`;
const ONE_PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

describe('Flower computer stage', () => {
  it('keeps decoded pixels during status updates and replacement frame loading', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const png = () => new Blob([Uint8Array.from(atob(ONE_PIXEL_PNG), (value) => value.charCodeAt(0))], { type: 'image/png' });
    let finishFrame: (blob: Blob) => void = () => undefined;
    const loadFrame = vi.fn(() => new Promise<Blob>((resolve) => { finishFrame = resolve; }));
    const [status, setStatus] = createSignal<'running' | 'success'>('running');
    const [frame, setFrame] = createSignal(FRAME_REF);
    const [owner, setOwner] = createSignal('thread');
    const dispose = render(() => <FlowerComputerStage
      snapshot={{ item: activityItem({ item_id: 'frame', status: status() }), status: status(), targetID: 'browser-main', target: 'Managed browser', action: 'Screenshot', location: 'local', safety: '' }}
      threadID={owner()} frameRef={frame()} loadFrame={loadFrame}
      copy={{ title: 'Computer', close: 'Close', noFrame: 'Loading', retry: 'Retry' }} onClose={() => undefined}
    />, host);
    try {
      await waitFor(() => loadFrame.mock.calls.length === 1);
      finishFrame(png());
      await waitFor(() => (host.querySelector('img') as HTMLImageElement | null)?.naturalWidth === 1);
      const originalURL = host.querySelector('img')!.src;
      setStatus('success');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(loadFrame).toHaveBeenCalledTimes(1);
      expect(host.querySelector('img')!.src).toBe(originalURL);
      setFrame(`computer://browser-main/${'b'.repeat(64)}`);
      await waitFor(() => loadFrame.mock.calls.length === 2);
      expect(host.querySelector('img')!.src).toBe(originalURL);
      finishFrame(png());
      await waitFor(() => host.querySelector('img')?.src !== originalURL);
      expect((host.querySelector('img') as HTMLImageElement).naturalWidth).toBe(1);
      expect(host.innerText.trim()).toBe('');
      setOwner('another-thread');
      await waitFor(() => loadFrame.mock.calls.length === 3);
      expect(host.querySelector('img')).toBeNull();
    } finally { dispose(); host.remove(); }
  });

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
            renderer: 'structured', status: 'running', label: 'Reading test page',
            target_refs: [{ kind: 'computer_frame', label: 'Redeven Managed Browser', resource_ref: FRAME_REF }],
            payload: { operation: 'screenshot', status: 'success' },
          })],
        })],
      }],
    });
    const loadComputerFrame = vi.fn(async () => new Blob([
      Uint8Array.from(atob(ONE_PIXEL_PNG), (value) => value.charCodeAt(0)),
    ], { type: 'image/png' })).mockRejectedValueOnce(new Error('FRAME_UNAVAILABLE'));
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      loadComputerFrame,
      listThreads: vi.fn(async () => [current]),
      loadThread: vi.fn(async () => liveBootstrap(current, 1)),
    }, { focusThreadRequest: { request_id: 'focus-computer-stage', thread_id: threadID } });

    await waitFor(() => runtime.querySelector('.flower-computer-stage') !== null);
    await waitFor(() => loadComputerFrame.mock.calls.length === 1);
    await waitFor(() => runtime.querySelector('.flower-computer-stage-no-frame button') !== null);
    (runtime.querySelector('.flower-computer-stage-no-frame button') as HTMLButtonElement).click();
    await waitFor(() => (runtime.querySelector('.flower-computer-stage-frame') as HTMLImageElement | null)?.naturalWidth === 1);
    expect(runtime.querySelector('.flower-computer-stage')?.getAttribute('role')).toBe('dialog');
    expect(runtime.querySelector('.flower-computer-stage-header')).toBeNull();
    expect(runtime.querySelector('.flower-computer-stage-footer')).toBeNull();
    expect(runtime.querySelector('.flower-computer-stage-frame')).not.toBeNull();
    expect(loadComputerFrame).toHaveBeenCalledWith(expect.objectContaining({
      thread_id: threadID, target_id: 'browser-main', resource_ref: FRAME_REF, sha256: 'a'.repeat(64),
    }));
    expect(loadComputerFrame).toHaveBeenCalledTimes(2);
    (runtime.querySelector('.flower-computer-stage-close') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('.flower-computer-stage') === null);
  });
});
