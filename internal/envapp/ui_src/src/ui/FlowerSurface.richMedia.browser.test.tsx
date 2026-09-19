import '../index.css';
import './flower-feature.css';
import previewVideo from '../../scripts/fixtures/media/preview.mp4?url';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { page } from 'vitest/browser';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import { markdownMediaEnUS } from '../../../../flower_ui/src/chat/markdown/mediaCopy';
import { adapter, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.navigation.testHarness';

async function imageBlob(): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 440;
  const ctx = canvas.getContext('2d')!;
  const background = ctx.createLinearGradient(0, 0, 960, 440);
  background.addColorStop(0, '#edf3ed'); background.addColorStop(1, '#d4e2e5');
  ctx.fillStyle = background; ctx.fillRect(0, 0, 960, 440);
  ctx.fillStyle = '#274940'; ctx.font = '500 17px system-ui'; ctx.fillText('REDEVEN  /  WORKSPACE', 52, 64);
  ctx.font = '600 42px system-ui'; ctx.fillText('Everything, in view.', 52, 145);
  ctx.font = '20px system-ui'; ctx.fillStyle = '#557168'; ctx.fillText('Your environments. Your tools. One place.', 52, 187);
  for (let index = 0; index < 3; index++) {
    ctx.fillStyle = '#ffffffaa'; ctx.beginPath(); ctx.roundRect(52 + index * 285, 245, 265, 140, 14); ctx.fill();
    ctx.fillStyle = '#65796f'; ctx.font = '16px system-ui'; ctx.fillText(['Environments', 'Running services', 'All systems'][index], 74 + index * 285, 282);
    ctx.fillStyle = '#294f40'; ctx.font = '600 34px system-ui'; ctx.fillText(['3 connected', '12 active', 'Healthy'][index], 74 + index * 285, 338);
  }
  return new Promise(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
}

describe('Flower inline media', () => {
  it('renders an assistant screenshot, file preview, and web link through the real conversation surface', async () => {
    await page.viewport(1200, 950);
    const ref = `computer://browser-main/${'a'.repeat(64)}`;
    const seed = thread({ thread_id: 'rich-media', title: 'Visual report', messages: [{ id: 'reply', role: 'assistant', status: 'complete', turn_id: 'turn-1', created_at_ms: 2,
      content: `Here is the result.\n\n![Workspace overview](${ref})\n\n[Interactive report](/workspace/redeven/report.html)\n\n[Read the guide](https://example.com/guide)` }] });
    const loadComputerFrame = vi.fn(async () => imageBlob());
    const loadMessageFile = vi.fn(async () => new Blob(['<style>body{padding:20px;background:#f5f7f4;color:#213c31}h1{font-size:28px;margin:10px 0}p{color:#64796d}button{background:#315f49;color:white;border:0;border-radius:8px;padding:10px 18px;cursor:pointer}</style><small>WORKSPACE INSIGHTS</small><h1>Ready for your next idea.</h1><p>A self-contained preview, directly in the conversation.</p><button onclick="this.textContent=\'Updated\'">Update report</button>'], { type: 'text/plain; charset=utf-8' }));
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => [seed], loadThread: async () => liveBootstrap(seed, 1), loadComputerFrame, loadMessageFile });
    runtime.style.height = '850px';
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="rich-media"] button')));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="rich-media"] button')!.click();
    await waitFor(() => Boolean(runtime.querySelector('.chat-media-image')));
    expect(loadComputerFrame).toHaveBeenCalledWith(expect.objectContaining({ thread_id: 'rich-media', resource_ref: ref }));
    const preview = runtime.querySelector<HTMLElement>('[data-media-kind="html"]')!;
    preview.scrollIntoView();
    await waitFor(() => Boolean(preview.querySelector('iframe')));
    expect(loadMessageFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/redeven/report.html' }));
    expect(preview.querySelector('iframe')!.sandbox.value).toBe('allow-scripts');
    const image = runtime.querySelector<HTMLImageElement>('.chat-media-image')!;
    await waitFor(() => image.complete && image.naturalWidth > 0);
    for (const element of [image, image.parentElement!, image.closest('.chat-media')!]) {
      expect(getComputedStyle(element).borderWidth).toBe('0px');
    }
    expect(getComputedStyle(image.closest('.chat-media')!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(runtime.querySelector<HTMLAnchorElement>('a[href="https://example.com/guide"]')!.rel).toBe('noopener noreferrer');
    const transcript = runtime.querySelector<HTMLElement>('.flower-chat-transcript')!;
    transcript.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
    transcript.scrollTop = 0;
    await page.screenshot({ path: './__screenshots__/redeven-flower-rich-media.png' });
    await page.viewport(390, 844);
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    transcript.scrollTop = 0;
    await waitFor(() => image.getBoundingClientRect().width <= 390);
    expect(image.getBoundingClientRect().top).toBeGreaterThanOrEqual(transcript.getBoundingClientRect().top);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    await page.screenshot({ path: './__screenshots__/redeven-flower-rich-media-mobile.png' });
  });

  it('keeps media nodes and their resource resolution stable through streaming and completion', async () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const prefix = '![Clip](/project/demo.mp4)\n\n```html preview\n<button>Preview</button>\n```\n\n';
    const [content, setContent] = createSignal(`${prefix}Working`);
    const [streaming, setStreaming] = createSignal(true);
    const resolve = vi.fn(async () => ({ src: previewVideo }));
    const dispose = render(() => <FlowerMarkdownBlock content={content()} streaming={streaming()} copyCodeLabel="Copy code" codeCopiedLabel="Copied" mediaLabels={markdownMediaEnUS} resolveMedia={resolve} />, root);
    onTestFinished(() => { dispose(); root.remove(); });
    await waitFor(() => Boolean(root.querySelector('video')) && Boolean(root.querySelector('iframe')));
    const video = root.querySelector('video')!; const frame = root.querySelector('iframe');
    for (let index = 0; index < 100; index++) { setContent(`${prefix}Working ${index}`); await Promise.resolve(); }
    setStreaming(false);
    await Promise.resolve();
    expect(root.querySelector('video')).toBe(video);
    expect(getComputedStyle(video.closest('.chat-media')!).borderWidth).toBe('0px');
    expect(getComputedStyle(video).borderWidth).toBe('0px');
    await waitFor(() => video.readyState >= 1);
    video.muted = true;
    await video.play();
    await waitFor(() => video.currentTime > 0);
    video.pause();
    expect(root.querySelector('iframe')).toBe(frame);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('offers retry after a failed load and does not dispatch incomplete streaming references', async () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const [content, setContent] = createSignal('![Screenshot](/project/image.png)');
    const resolve = vi.fn(async () => { throw new Error('unavailable'); });
    const dispose = render(() => <FlowerMarkdownBlock content={content()} streaming copyCodeLabel="Copy code" codeCopiedLabel="Copied" mediaLabels={markdownMediaEnUS} resolveMedia={resolve} />, root);
    onTestFinished(() => { dispose(); root.remove(); });
    await new Promise<void>(done => requestAnimationFrame(() => done()));
    expect(resolve).not.toHaveBeenCalled();
    setContent('![Screenshot](/project/image.png)\n\nMore');
    await waitFor(() => root.textContent?.includes('Preview unavailable') === true);
    root.querySelector<HTMLButtonElement>('.chat-media-retry')!.click();
    await waitFor(() => resolve.mock.calls.length === 2);
  });
});
