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
        : url.pathname.endsWith('/upl_archive')
          ? { bytes: new Uint8Array([1, 2, 3]), mime_type: 'application/zip' }
        : { bytes: new TextEncoder().encode(text), mime_type: 'text/plain' } };
    });
    const unexpectedBridgeCall = () => { throw new Error('Unexpected Desktop bridge call.'); };
    const loader = createLocalEnvironmentFlowerSurfaceAdapter({
      requestRuntimeFlower,
    cancelRuntimeFlowerRead: vi.fn(),
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
        { type: 'file', name: 'project.zip', mimeType: 'application/zip', size: 3, url: url('upl_archive') },
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
    const message = surface.querySelector('[data-flower-message-id="attachment-message"]')!;
    expect(message.querySelector('.flower-message-bubble-user')).toBeNull();
    expect(thumbnail.closest('.flower-message-images')).not.toBeNull();
    expect(message.querySelectorAll('.flower-message-resources .flower-message-file')).toHaveLength(2);
    expect(thumbnail.getBoundingClientRect().height).toBeLessThanOrEqual(120);
    expect(thumbnail.src.startsWith('blob:')).toBe(true);
    expect(surface.querySelector('[data-image-fallback]')).toBeNull();
    const archive = surface.querySelectorAll('a.flower-message-file')[1] as HTMLElement;
    expect(archive.querySelector('svg')?.getAttribute('data-file-icon-kind')).toBe('archive');
    expect(archive.querySelector('svg')?.getBoundingClientRect().width).toBe(24);
    await userEvent.click(surface.querySelector('.flower-message-image')!);
    await waitFor(() => Boolean(document.querySelector<HTMLImageElement>('.flower-attachment-preview-surface img')?.naturalWidth));
    await userEvent.click(document.querySelector<HTMLButtonElement>('.flower-attachment-preview-window [aria-label="Close"]')!);
    await waitFor(() => !document.querySelector('.flower-attachment-preview-window'));
    await userEvent.click(surface.querySelector('a.flower-message-file')!);
    await waitFor(() => document.querySelector('.flower-attachment-preview-text')?.textContent === text);
    expect(document.querySelector('.flower-attachment-preview-error')).toBeNull();
    expect(requestRuntimeFlower).toHaveBeenCalledTimes(3);
    await page.screenshot({ path: './__screenshots__/flower-message-attachment-preview.png' });
    await userEvent.click(document.querySelector<HTMLButtonElement>('.flower-attachment-preview-window [aria-label="Close"]')!);
    await waitFor(() => !document.querySelector('.flower-attachment-preview-window'));
    await userEvent.click(archive);
    await waitFor(() => Boolean(document.querySelector('.flower-attachment-preview-state svg')));
    const fallbackIcon = document.querySelector<SVGSVGElement>('.flower-attachment-preview-state svg')!;
    expect(fallbackIcon.getAttribute('data-file-icon-kind')).toBe('archive');
    expect(fallbackIcon.getAttribute('data-file-icon-size')).toBe('detailed');
    expect(fallbackIcon.getBoundingClientRect().width).toBe(40);
    expect(requestRuntimeFlower).toHaveBeenCalledTimes(4);
    await userEvent.click(document.querySelector<HTMLButtonElement>('.flower-attachment-preview-window [aria-label="Close"]')!);
    await waitFor(() => !document.querySelector('.flower-attachment-preview-window'));
  });
});
