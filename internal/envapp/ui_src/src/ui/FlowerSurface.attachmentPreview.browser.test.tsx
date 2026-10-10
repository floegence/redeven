import '../index.css';
import './flower-feature.css';
import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createLocalEnvironmentFlowerSurfaceAdapter, type DesktopSettingsBridge } from '../../../../../desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

describe('Flower admitted attachment browser previews', () => {
  it('decodes image bytes and opens text through the Desktop loader when the model supports text only', async () => {
    await page.viewport(1200, 900);
    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 100;
    const paint = canvas.getContext('2d')!;
    paint.fillStyle = '#23816d';
    paint.fillRect(0, 0, canvas.width, canvas.height);
    const image = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
    const imageBytes = new Uint8Array(await image.arrayBuffer());
    const text = '{"ok":false,"message":"This is attachment content."}';
    const requestRuntimeFlower = vi.fn<DesktopSettingsBridge['requestRuntimeFlower']>(async request => {
      expect(request.method).toBe('GET');
      expect(request.environment_id).toBe('attachment-environment');
      const url = new URL(request.path, 'http://fixture.invalid');
      expect(url.searchParams.get('preview')).toBe('1');
      expect(url.searchParams.get('thread_id')).toBe('attachment-thread');
      expect(url.searchParams.get('turn_id')).toBe('attachment-turn');
      return { ok: true, data: url.pathname.endsWith('/upl_image')
        ? { bytes: imageBytes, mime_type: 'image/png' }
        : { bytes: new TextEncoder().encode(text), mime_type: 'text/plain' } };
    });
    const unexpectedBridgeCall = () => { throw new Error('Unexpected Desktop bridge call.'); };
    const loader = createLocalEnvironmentFlowerSurfaceAdapter({
      requestRuntimeFlower,
      load: unexpectedBridgeCall, save: unexpectedBridgeCall, cancel: unexpectedBridgeCall,
      startRuntimeFlowerStream: unexpectedBridgeCall, cancelRuntimeFlowerStream: unexpectedBridgeCall,
      subscribeRuntimeFlowerStream: unexpectedBridgeCall, prepareRuntimeFlowerAttachment: unexpectedBridgeCall,
      writeRuntimeFlowerAttachmentChunk: unexpectedBridgeCall, commitRuntimeFlowerAttachment: unexpectedBridgeCall,
      cancelRuntimeFlowerAttachment: unexpectedBridgeCall, subscribeRuntimeFlowerAttachmentProgress: unexpectedBridgeCall,
      previewRuntimeFlowerAttachment: unexpectedBridgeCall,
    }, {
      runtimeEnvironmentID: 'attachment-environment',
    }).loadMessageAttachment!;
    const url = (id: string) => `/_redeven_proxy/api/ai/uploads/${id}?thread_id=attachment-thread&turn_id=attachment-turn`;
    const conversation = thread({ thread_id: 'attachment-thread', messages: [{
      id: 'attachment-message', turn_id: 'attachment-turn', role: 'user', content: '', status: 'complete', created_at_ms: 1,
      blocks: [
        { type: 'image', src: url('upl_image'), alt: 'diagram.png' },
        { type: 'file', name: 'notes.txt', mimeType: 'text/plain', size: text.length, url: url('upl_text') },
      ],
    }] });
    const surface = renderSurfaceWithAdapterProps({ ...adapter(true),
      listThreads: async () => [conversation], loadThread: async () => liveBootstrap(conversation, 1),
      loadMessageAttachment: loader,
    }, {});
    await waitFor(() => Boolean(surface.querySelector('[data-thread-id="attachment-thread"] button')));
    surface.querySelector<HTMLButtonElement>('[data-thread-id="attachment-thread"] button')!.click();
    await waitFor(() => Boolean(surface.querySelector<HTMLImageElement>('.flower-message-image img')?.naturalWidth));
    const thumbnail = surface.querySelector<HTMLImageElement>('.flower-message-image img')!;
    expect(thumbnail.naturalWidth).toBe(240);
    expect(thumbnail.src.startsWith('blob:')).toBe(true);
    expect(surface.querySelector('[data-image-fallback]')).toBeNull();
    await userEvent.click(surface.querySelector('.flower-message-image')!);
    await waitFor(() => Boolean(document.querySelector<HTMLImageElement>('.flower-attachment-preview-surface img')?.naturalWidth));
    await userEvent.click(surface.querySelector('a.flower-message-file')!);
    await waitFor(() => document.querySelector('.flower-attachment-preview-text')?.textContent === text);
    expect(document.querySelector('.flower-attachment-preview-error')).toBeNull();
    expect(requestRuntimeFlower).toHaveBeenCalledTimes(3);
    await page.screenshot({ path: './__screenshots__/flower-message-attachment-preview.png' });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => !document.querySelector('.flower-attachment-preview-window'));
  });
});
