// @vitest-environment jsdom

import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { FlowerMessageImage } from '../../../../flower_ui/src/chat/FlowerMessageImage';

import { createLocalizedFlowerSurfaceCopy } from '../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { createTestI18nHelpers } from './i18n/locales/testDictionaries';
import type { EnvAppTranslationKey } from './i18n/locales';
import {
  adapter,
  liveBootstrap,
  renderSurfaceWithAdapterProps,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

afterEach(() => vi.unstubAllGlobals());

describe('Flower message attachment previews', () => {
  it('loads visible images through the adapter and releases their Blob URL on disposal', async () => {
    const createObjectURL = vi.fn(() => 'blob:attachment-image');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = revokeObjectURL;
    });
    let enterViewport: () => void = () => undefined;
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        enterViewport = () => callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      observe() {}
      disconnect = disconnect;
    });
    const load = vi.fn(async (_url: string, _signal: AbortSignal) => new Blob(['image'], { type: 'image/png' }));
    const host = document.createElement('div');
    document.body.append(host);
    const dispose = render(() => <FlowerMessageImage src="/_redeven_proxy/api/ai/uploads/upl_image?thread_id=thread_1&turn_id=turn_1"
      alt="image.png" name="image.png" unavailableLabel="暂时无法预览" load={load} onOpen={() => undefined} />, host);
    try {
      expect(load).not.toHaveBeenCalled();
      await Promise.resolve(); // Observe the inserted loading shell.
      enterViewport();
      await waitFor(() => Boolean(host.querySelector('img')));
      expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:attachment-image');
      expect(load).toHaveBeenCalledTimes(1);
    } finally {
      dispose();
      host.remove();
    }
    expect(load.mock.calls[0][1].aborted).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:attachment-image');
    expect(disconnect).toHaveBeenCalled();
  });

  it('reports image and text preview failures without attributing them to model capability', async () => {
    const i18n = createTestI18nHelpers('zh-CN');
    const copy = createLocalizedFlowerSurfaceCopy({
      locale: 'zh-CN',
      t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
      tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params),
    });
    const threadID = 'thread-attachment-preview';
    const conversation = thread({
      thread_id: threadID,
      messages: [{
        id: 'message-attachment-preview',
        turn_id: 'turn-attachment-preview',
        role: 'user',
        content: '',
        status: 'complete',
        created_at_ms: 1,
        blocks: [
          { type: 'image', src: '/api/ai/uploads/image?thread_id=thread-a&turn_id=turn-a', alt: 'image.png' },
          { type: 'file', name: 'notes.txt', size: 12, mimeType: 'text/plain; charset=utf-8', url: '/api/ai/uploads/text?thread_id=thread-a&turn_id=turn-a' },
          { type: 'file', name: 'locked.txt', size: 12, mimeType: 'text/plain; charset=utf-8', url: '/api/ai/uploads/text-locked?thread_id=thread-a&turn_id=turn-a' },
        ],
      }],
    });
    const loadMessageAttachment = vi.fn(async ({ url }: { url: string }) => {
      if (url.includes('text-locked')) throw new Error('Attachment preview failed with HTTP 423.');
      if (url.includes('/image?')) throw new Error('Attachment preview failed with HTTP 423.');
      return new NodeBlob(['plain text attachment'], { type: 'text/plain; charset=utf-8' }) as Blob;
    });
    const surface = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: async () => [conversation],
      loadThread: async () => liveBootstrap(conversation, 1),
      loadMessageAttachment,
    }, { copy });

    await waitFor(() => Boolean(surface.querySelector(`[data-thread-id="${threadID}"] button`)));
    (surface.querySelector(`[data-thread-id="${threadID}"] button`) as HTMLButtonElement).click();
    await waitFor(() => Boolean(surface.querySelector('[data-image-fallback="true"]')));
    expect(surface.querySelector('[data-image-fallback="true"]')?.textContent).toContain('暂时无法预览');
    expect(surface.querySelector('[data-image-fallback="true"] svg')?.getAttribute('data-file-icon-type')).toBe('image');
    expect(surface.querySelector('[data-image-fallback="true"]')?.textContent).not.toContain('当前所选模型无法使用附件');
    expect(loadMessageAttachment).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('/image?') }));

    (surface.querySelector('a.flower-message-file') as HTMLAnchorElement).click();
    await waitFor(() => Boolean(document.querySelector('.flower-attachment-preview-text, .flower-attachment-preview-error')));
    expect(document.querySelector('.flower-attachment-preview-error')?.textContent).toBeUndefined();
    expect(document.querySelector('.flower-attachment-preview-text')?.textContent).toBe('plain text attachment');

    (surface.querySelectorAll('a.flower-message-file')[1] as HTMLAnchorElement).click();
    await waitFor(() => Boolean(document.querySelector('.flower-attachment-preview-error')));
    expect(document.querySelector('.flower-attachment-preview-error')?.textContent).toContain('暂时无法预览');
    expect(document.querySelector('.flower-attachment-preview-error')?.textContent).not.toContain('当前所选模型无法使用附件');
  });
});
