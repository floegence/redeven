import '../index.css';
import './flower-feature.css';
import previewVideo from '../../scripts/fixtures/media/preview.mp4?url';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { createFlowerLinkedContextNavigation } from './flower/linkedContextNavigation';
import { FilePreviewSurface } from './widgets/FilePreviewSurface';
import { floatingWindowStorageKey } from './widgets/PersistentFloatingWindow';
import { removeUIStorageItem } from './services/uiStorage';
import { FlowerMarkdownBlock } from '../../../../flower_ui/src/chat/markdown/FlowerMarkdownBlock';
import { markdownMediaEnUS } from '../../../../flower_ui/src/chat/markdown/mediaCopy';
import { adapter, liveBootstrap, renderSurfaceWithAdapter, thread, waitFor } from './FlowerSurface.media.test-support';
import { FlowerSurface, createFlowerComposerDraftCoordinator, type FlowerSurfaceAdapter } from '../../../../flower_ui/src';

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
  it('retains one bounded canvas while HTML streams, stops, closes, and moves before later text', async () => {
    await page.viewport(1000, 800);
    const root = document.createElement('div'); document.body.appendChild(root);
    root.style.maxWidth = '680px';
    const fence = '```html preview\n';
    const html = '<button onclick="this.textContent=String(Number(this.textContent)+1)">0</button>';
    const [content, setContent] = createSignal(fence + '<main>Partial');
    const [streaming, setStreaming] = createSignal(true);
    const dispose = render(() => <FlowerMarkdownBlock content={content()} streaming={streaming()} mediaEnabled
      copyCodeLabel="Copy code" codeCopiedLabel="Copied" mediaLabels={markdownMediaEnUS} />, root);
    onTestFinished(() => { dispose(); root.remove(); });
    await waitFor(() => Boolean(root.querySelector('.chat-html-canvas')));
    const canvas = root.querySelector<HTMLElement>('.chat-html-canvas')!;
    const height = canvas.getBoundingClientRect().height;
    expect(getComputedStyle(canvas).borderWidth).toBe('0px');
    expect(canvas.dataset.state).toBe('generating');
    expect(root.querySelector('iframe')).toBeNull();
    expect(root.querySelector('.flower-chat-md-tail')).toBeNull();
    await userEvent.click(canvas.querySelector<HTMLButtonElement>('[data-chat-media-action=source]')!);
    setContent(fence + html);
    expect(canvas.querySelector('pre')?.textContent).toBe(html);
    setStreaming(false);
    expect(canvas.dataset.state).toBe('incomplete');
    expect(root.querySelector('iframe')).toBeNull();
    setStreaming(true);
    setContent(fence + html + '\n```');
    await waitFor(() => Boolean(canvas.querySelector('iframe')));
    expect(root.querySelector('.chat-html-canvas')).toBe(canvas);
    expect(canvas.dataset.view).toBe('source');
    expect(canvas.getBoundingClientRect().height).toBe(height);
    const frame = canvas.querySelector('iframe');
    setContent(fence + html + '\n```\n\nA new paragraph');
    setStreaming(false);
    expect(root.querySelector('.chat-html-canvas')).toBe(canvas);
    expect(canvas.querySelector('iframe')).toBe(frame);
    await userEvent.click(canvas.querySelector<HTMLButtonElement>('[data-chat-media-action=source]')!);
    await userEvent.click(canvas.querySelector<HTMLButtonElement>('[data-chat-media-action=expand]')!);
    expect(canvas.querySelector('iframe')).toBe(frame);
    await page.viewport(320, 800);
    expect(root.scrollWidth).toBeLessThanOrEqual(320);
  });
  it('opens a fenced HTML copy and routes links with the bound thread directory', async () => {
    await page.viewport(1200, 900);
    const html = '<h1>Daily brief</h1><a href="#economy">Economy</a><a href="https://example.com/news">News source</a><a href="./details.html">Related file</a><a href="javascript:alert(1)">Unsupported link</a><section id="economy" style="margin-top:1200px">Economy</section>';
    const seed = thread({ thread_id: 'html-links', title: 'Daily brief', working_dir: '/workspace/news', messages: [{
      id: 'reply', role: 'assistant', status: 'complete', turn_id: 'turn', created_at_ms: 2,
      content: `\`\`\`html preview\n${html}\n\`\`\``,
    }] });
    const openMessageFile = vi.fn(async () => undefined);
    const openMessageURL = vi.fn(async () => undefined);
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => [seed],
      loadThread: async () => liveBootstrap(seed, 1), openMessageFile, openMessageURL,
    });
    runtime.style.height = '850px';
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="html-links"] button')));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="html-links"] button')!.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-media-kind="html"] iframe')));
    const frame = runtime.querySelector('iframe');
    const trigger = runtime.querySelector<HTMLElement>('[aria-label="More actions"]');
    expect(trigger, 'Fenced HTML needs an independent preview action').toBeTruthy();
    const clickLink = (commands as unknown as { clickHtmlPreviewLink: (selector: string, name: string) => Promise<{ url: string; scrollY: number }> }).clickHtmlPreviewLink;
    const anchor = await clickLink('.chat-html-sheet iframe', 'Economy');
    expect(anchor.url).toBe('about:srcdoc');
    expect(anchor.scrollY).toBeGreaterThan(500);
    await clickLink('.chat-html-sheet iframe', 'News source');
    await vi.waitFor(() => expect(openMessageURL).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://example.com/news' })));
    await clickLink('.chat-html-sheet iframe', 'Related file');
    await vi.waitFor(() => expect(openMessageFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/workspace/news/details.html', action: 'preview' })));
    await clickLink('.chat-html-sheet iframe', 'Unsupported link');
    await vi.waitFor(() => expect(runtime.querySelector('[role="alert"]')?.textContent).toContain('protocol'));
    expect(runtime.querySelector('iframe')).toBe(frame);
    await userEvent.click(trigger!);
    await userEvent.click(page.getByRole('menuitem', { name: 'Open preview window' }));
    await waitFor(() => Boolean(document.querySelector('.chat-media-preview-window iframe')));
    expect(runtime.querySelector('iframe')).toBe(frame);
    await clickLink('.chat-media-preview-window iframe', 'Related file');
    await vi.waitFor(() => expect(openMessageFile).toHaveBeenCalledTimes(2));
    document.querySelector<HTMLButtonElement>('.chat-media-preview-window [data-floe-floating-window-control="close"]')!.click();
    await waitFor(() => !document.querySelector('.chat-media-preview-window'));
    expect(document.activeElement).toBe(trigger);
  });

  it('retains ready media for thirty seconds of host updates and reloads for thread, directory, and adapter changes', async () => {
    await page.viewport(1200, 900);
    const blob = await imageBlob();
    const [revision, setRevision] = createSignal(0);
    const seeds = ['first', 'second'].map(name => thread({ thread_id: name, title: name, working_dir: `/workspace/${name}`, messages: [{
      id: `${name}-reply`, role: 'assistant', status: 'complete', turn_id: `${name}-turn`, created_at_ms: 2,
      content: '![Workspace](./frame.png)',
    }] }));
    const loadMessageFile = vi.fn(async () => { revision(); return blob; });
    let changeWorkingDirectory: () => void = () => { throw new Error('Workspace stream is not ready'); };
    const initial: FlowerSurfaceAdapter = {
      ...adapter(true), listThreads: async () => seeds,
      loadThread: async id => {
        const seed = seeds.find(seed => seed.thread_id === id)!;
        return liveBootstrap(seed, seed.settings_revision ?? 1);
      }, loadMessageFile,
      connectLiveStream: async function* ({ signal }) {
        yield { schema_version: 1, kind: 'ready', summaries: seeds };
        const updated = await new Promise<typeof seeds[number] | undefined>(resolve => {
          changeWorkingDirectory = () => {
            seeds[1] = { ...seeds[1], working_dir: '/workspace/moved', updated_at_ms: 3, settings_revision: 2 };
            resolve(seeds[1]);
          };
          if (signal.aborted) resolve(undefined);
          else signal.addEventListener('abort', () => resolve(undefined), { once: true });
        });
        if (updated) yield { schema_version: 1, kind: 'summary.batch', summaries: [updated] };
        if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
      },
    };
    const [surfaceAdapter, setSurfaceAdapter] = createSignal(initial);
    const host = document.createElement('div'); host.style.height = '850px'; document.body.append(host);
    const dispose = render(() => <FloeConfigProvider><LayoutProvider>
      <FlowerSurface adapter={surfaceAdapter()} draftCoordinator={createFlowerComposerDraftCoordinator()} notify={notice => { throw new Error(notice.message); }} />
    </LayoutProvider></FloeConfigProvider>, host);
    onTestFinished(() => { dispose(); host.remove(); });
    await waitFor(() => Boolean(host.querySelector('[data-thread-id="first"] button')));
    host.querySelector<HTMLButtonElement>('[data-thread-id="first"] button')!.click();
    await waitFor(() => Boolean(host.querySelector<HTMLImageElement>('.chat-media-image')?.naturalWidth));
    const image = host.querySelector<HTMLImageElement>('.chat-media-image')!;
    const src = image.src;
    expect(loadMessageFile).toHaveBeenCalledTimes(1);
    expect(loadMessageFile).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/workspace/first/frame.png' }));
    for (let index = 0; index < 60; index++) {
      setRevision(index + 1);
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(host.querySelector('.chat-media-image')).toBe(image);
      expect(image.src).toBe(src);
    }
    expect(loadMessageFile).toHaveBeenCalledTimes(1);
    await page.screenshot({ path: './__screenshots__/redeven-flower-media-stability.png' });
    host.querySelector<HTMLButtonElement>('[data-thread-id="second"] button')!.click();
    await vi.waitFor(() => expect(loadMessageFile, 'thread switch').toHaveBeenCalledTimes(2));
    expect(loadMessageFile).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/workspace/second/frame.png' }));
    changeWorkingDirectory();
    await vi.waitFor(() => expect(loadMessageFile, 'directory switch').toHaveBeenCalledTimes(3));
    expect(loadMessageFile).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/workspace/moved/frame.png' }));
    const replacementLoad = vi.fn(async () => blob);
    setSurfaceAdapter({ ...initial, loadMessageFile: replacementLoad });
    await waitFor(() => replacementLoad.mock.calls.length > 0);
    expect(replacementLoad).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/workspace/moved/frame.png' }));
  }, 45000);

  it.each(['light', 'dark'] as const)('opens the existing file preview and containing folder from a chat image in %s mode', async (mode) => {
    await page.viewport(1200, 900);
    document.documentElement.classList.add(mode);
    document.documentElement.dataset.floeShellTheme = mode === 'dark' ? 'classic-dark' : 'paper';
    removeUIStorageItem(floatingWindowStorageKey('file-preview'));
    const blob = await imageBlob();
    const imageURL = URL.createObjectURL(blob);
    const [item, setItem] = createSignal<FileItem>();
    const [open, setOpen] = createSignal(false);
    const previewHost = document.createElement('div');
    document.body.appendChild(previewHost);
    const dispose = render(() => <FloeConfigProvider><LayoutProvider>
      <FilePreviewSurface open={open()} onOpenChange={setOpen} item={item()} descriptor={{ mode: 'image' }} objectUrl={imageURL}
        onCopyPath={async () => true} onDownload={vi.fn()} onAskFlower={vi.fn()} />
    </LayoutProvider></FloeConfigProvider>, previewHost);
    onTestFinished(() => {
      dispose(); previewHost.remove(); URL.revokeObjectURL(imageURL);
      document.documentElement.classList.remove(mode);
      document.documentElement.removeAttribute('data-floe-shell-theme');
      removeUIStorageItem(floatingWindowStorageKey('file-preview'));
    });
    const openFilePreview = vi.fn(async (file: FileItem) => { setItem(file); setOpen(true); });
    const openFileBrowserAtPath = vi.fn(async () => undefined);
    const navigation = createFlowerLinkedContextNavigation({
      openFilePreview, openFileBrowserAtPath,
      notifyInvalidFilePath: vi.fn(), notifyInvalidDirectoryPath: vi.fn(),
    });
    const seed = thread({ thread_id: 'image-actions', title: 'Workspace design', messages: [{
      id: 'image-reply', role: 'assistant', status: 'complete', turn_id: 'turn-image', created_at_ms: 2,
      content: 'Here is the updated workspace.\n\n![Workspace overview](/workspace/design/overview.png)\n\nOpen the image to take a closer look, or jump to its folder.',
    }] });
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => [seed],
      loadThread: async () => liveBootstrap(seed, 1), loadMessageFile: async () => blob,
      openMessageFile: navigation.openMessageFile,
    });
    runtime.style.height = '880px';
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="image-actions"] button')));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="image-actions"] button')!.click();
    await waitFor(() => Boolean(runtime.querySelector('.chat-media-image')));
    const image = runtime.querySelector<HTMLImageElement>('.chat-media-image')!;
    await waitFor(() => image.complete && image.naturalWidth > 0);
    const media = image.closest<HTMLElement>('.chat-media')!;
    const trigger = media.querySelector<HTMLButtonElement>('.chat-media-image-button')!;
    const folder = media.querySelector<HTMLButtonElement>('button[aria-label="Open containing folder"]')!;
    const preview = media.querySelector<HTMLButtonElement>('button[aria-label="Preview image"]')!;
    expect(media.querySelector('a')).toBeNull();
    expect(folder).toBeTruthy();
    expect(preview).toBeTruthy();
    expect(folder.title).toBe('Open containing folder');
    expect(preview.title).toBe('Preview image');
    await userEvent.hover(trigger);
    await waitFor(() => getComputedStyle(folder.parentElement!).opacity === '1');
    await page.screenshot({ path: `./__screenshots__/redeven-flower-image-actions-${mode}.png` });
    await userEvent.click(folder);
    expect(openFileBrowserAtPath).toHaveBeenCalledWith('/workspace/design', { title: 'design', openStrategy: 'focus_latest_or_create' });
    expect(openFilePreview).not.toHaveBeenCalled();
    expect(document.querySelector('.file-preview-floating-window')).toBeNull();
    await userEvent.click(trigger);
    await waitFor(() => Boolean(document.querySelector('.file-preview-floating-window .redeven-file-preview img')));
    const window = document.querySelector<HTMLElement>('.file-preview-floating-window')!;
    expect(openFilePreview).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/workspace/design/overview.png' }), { focus: true, reusePolicy: 'same_file_or_create' });
    expect(window.querySelector('h2')!.textContent).toBe('overview.png');
    expect(document.querySelector('.chat-media-preview-window')).toBeNull();
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
    const fullImage = window.querySelector<HTMLImageElement>('img')!;
    await waitFor(() => fullImage.complete && fullImage.naturalWidth > 0 && getComputedStyle(window).opacity === '1');
    await page.screenshot({ path: `./__screenshots__/redeven-flower-image-window-${mode}.png` });
    // Repeated requests retain the same host surface.
    preview.click();
    expect(openFilePreview).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.file-preview-floating-window')).toBe(window);
    window.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!.click();
    await waitFor(() => !document.querySelector('.file-preview-floating-window'));
    preview.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => Boolean(document.querySelector('.file-preview-floating-window')));
    expect(openFilePreview).toHaveBeenCalledTimes(3);
    document.querySelector<HTMLButtonElement>('.file-preview-floating-window [data-floe-floating-window-control="close"]')!.click();
    await waitFor(() => !document.querySelector('.file-preview-floating-window'));
    await page.viewport(390, 844);
    await waitFor(() => image.getBoundingClientRect().width <= 390);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
    expect(folder.getBoundingClientRect().right).toBeLessThanOrEqual(media.getBoundingClientRect().right);
  });

  it('opens a local HTML file in the existing floating preview and distinguishes expansion states', async () => {
    await page.viewport(1200, 900);
    removeUIStorageItem(floatingWindowStorageKey('file-preview'));
    const html = '<h1>Interactive report</h1><button>Update report</button>';
    const [item, setItem] = createSignal<FileItem>();
    const [open, setOpen] = createSignal(false);
    const previewHost = document.createElement('div');
    document.body.appendChild(previewHost);
    const dispose = render(() => <FloeConfigProvider><LayoutProvider>
      <FilePreviewSurface open={open()} onOpenChange={setOpen} item={item()} descriptor={{ mode: 'html' }} text={html}
        onCopyPath={async () => true} onDownload={vi.fn()} onAskFlower={vi.fn()} />
    </LayoutProvider></FloeConfigProvider>, previewHost);
    onTestFinished(() => { dispose(); previewHost.remove(); removeUIStorageItem(floatingWindowStorageKey('file-preview')); });
    const openFilePreview = vi.fn(async (file: FileItem) => { setItem(file); setOpen(true); });
    const openFileBrowserAtPath = vi.fn(async () => undefined);
    const navigation = createFlowerLinkedContextNavigation({
      openFilePreview, openFileBrowserAtPath, notifyInvalidFilePath: vi.fn(), notifyInvalidDirectoryPath: vi.fn(),
    });
    const seed = thread({ thread_id: 'html-actions', title: 'Interactive report', messages: [{
      id: 'html-reply', role: 'assistant', status: 'complete', turn_id: 'html-turn', created_at_ms: 2,
      content: '[Interactive report](/workspace/reports/report.html)',
    }] });
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => [seed],
      loadThread: async () => liveBootstrap(seed, 1), loadMessageFile: async () => new Blob([html], { type: 'text/plain' }),
      openMessageFile: navigation.openMessageFile,
    });
    runtime.style.height = '850px';
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="html-actions"] button')));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="html-actions"] button')!.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-media-kind="html"] iframe')));
    const media = runtime.querySelector<HTMLElement>('[data-media-kind="html"]')!;
    const frame = media.querySelector('iframe');
    const expansion = media.querySelector<HTMLButtonElement>('button[aria-label="Expand preview"]')!;
    const expandIcon = expansion.querySelector('svg')!.innerHTML;
    expect(media.getBoundingClientRect().width).toBeGreaterThan(350);
    expect(getComputedStyle(media.querySelector('.chat-html-canvas')!).borderWidth).toBe('0px');
    await userEvent.click(expansion);
    expect(expansion.getAttribute('aria-expanded')).toBe('true');
    expect(expansion.getAttribute('aria-label')).toBe('Collapse preview');
    expect(expansion.querySelector('svg')!.innerHTML).not.toBe(expandIcon);
    expect(media.querySelector('iframe')).toBe(frame);
    await userEvent.click(expansion);
    expect(expansion.getAttribute('aria-expanded')).toBe('false');
    const more = media.querySelector<HTMLElement>('[aria-label="More actions"]')!;
    await userEvent.click(more);
    await userEvent.click(page.getByRole('menuitem', { name: 'Open file preview' }));
    await waitFor(() => Boolean(document.querySelector('.file-preview-floating-window iframe.html-preview-frame')));
    const window = document.querySelector<HTMLElement>('.file-preview-floating-window')!;
    expect(openFilePreview).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/workspace/reports/report.html' }), { focus: true, reusePolicy: 'same_file_or_create' });
    expect(window.querySelector('h2')!.textContent).toBe('report.html');
    expect(media.querySelector('iframe')).toBe(frame);
    await page.screenshot({ path: './__screenshots__/redeven-flower-html-preview-window.png' });
    window.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')!.click();
    await waitFor(() => !document.querySelector('.file-preview-floating-window'));
    await userEvent.click(more);
    await userEvent.click(page.getByRole('menuitem', { name: 'Open containing folder' }));
    expect(openFileBrowserAtPath).toHaveBeenCalledWith('/workspace/reports', { title: 'reports', openStrategy: 'focus_latest_or_create' });
    await page.viewport(390, 844);
    await waitFor(() => media.getBoundingClientRect().width <= 390);
    expect(media.getBoundingClientRect().width).toBeGreaterThan(200);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });

  it('renders an assistant screenshot, file preview, and web link through the real conversation surface', async () => {
    await page.viewport(1200, 950);
    const ref = `computer://browser-main/${'a'.repeat(64)}`;
    const seed = thread({ thread_id: 'rich-media', title: 'Visual report', messages: [{ id: 'reply', role: 'assistant', status: 'complete', turn_id: 'turn-1', created_at_ms: 2,
      content: `Here is the result.\n\n![Workspace overview](${ref})\n\n[Interactive report](/workspace/redeven/report.html)\n\n[Read the guide](https://example.com/guide.html)` }] });
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
    const link = runtime.querySelector<HTMLAnchorElement>('a[href="https://example.com/guide.html"]')!;
    expect(link.rel).toBe('noopener noreferrer');
    expect(link.querySelector('svg')).toBeNull();
    expect(runtime.querySelectorAll('[data-media-kind="html"]').length).toBe(1);
    expect(loadMessageFile).toHaveBeenCalledTimes(1);
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

  it('opens local Markdown report links through the host file-preview window', async () => {
    await page.viewport(1200, 900);
    const reportPath = '/workspace/reports/openai-cache-audit/report.md';
    const seed = thread({ thread_id: 'markdown-report-link', title: 'Markdown report', working_dir: '/workspace/reports/openai-cache-audit', messages: [{
      id: 'report-reply', role: 'assistant', status: 'complete', turn_id: 'report-turn', created_at_ms: 2,
      content: '[View the full report](./report.md)',
    }] });
    const openMessageFile = vi.fn(async () => undefined);
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => [seed],
      loadThread: async () => liveBootstrap(seed, 1), openMessageFile,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="markdown-report-link"] button')));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="markdown-report-link"] button')!.click();
    await waitFor(() => Boolean(runtime.querySelector('a.flower-chat-md-link')));
    const link = runtime.querySelector<HTMLAnchorElement>('a.flower-chat-md-link')!;
    await userEvent.click(link);
    await vi.waitFor(() => expect(openMessageFile).toHaveBeenCalledWith(expect.objectContaining({ path: reportPath, action: 'preview' })));
    expect(link.getAttribute('href')).toBe('./report.md');
  });

  it('keeps media nodes and their resource resolution stable through streaming and completion', async () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const prefix = '![Clip](/project/demo.mp4)\n\n```html preview\n<button>Preview</button>\n```\n\n';
    const [content, setContent] = createSignal(`${prefix}Working`);
    const [streaming, setStreaming] = createSignal(true);
    const resolve = vi.fn(async () => ({ src: previewVideo }));
    const dispose = render(() => <FlowerMarkdownBlock content={content()} streaming={streaming()} mediaEnabled copyCodeLabel="Copy code" codeCopiedLabel="Copied" mediaLabels={markdownMediaEnUS} resolveMedia={resolve} />, root);
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

  it('keeps media semantics and mounted nodes stable while labels become ready', async () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const [labels, setLabels] = createSignal<typeof markdownMediaEnUS>();
    let completeHTML!: (html: string) => void;
    const resolve = vi.fn(async () => ({ loadHTML: () => new Promise<string>(done => { completeHTML = done; }) }));
    const dispose = render(() => <FlowerMarkdownBlock content="[Report](/Users/demo/report.html)" mediaEnabled
      copyCodeLabel="Copy code" codeCopiedLabel="Copied" mediaLabels={labels()} resolveMedia={resolve} />, root);
    onTestFinished(() => { dispose(); root.remove(); });
    expect(root.querySelector('a')).toBeNull();
    expect(root.querySelector('[data-floe-markdown-media]')).toBeTruthy();
    await waitFor(() => resolve.mock.calls.length === 1);
    const media = root.querySelector<HTMLElement>('.chat-media')!;
    expect(media.textContent).toContain(markdownMediaEnUS.loading);
    expect(media.querySelector('a, iframe')).toBeNull();
    expect(media.querySelector('[data-chat-media-action=source]')).toBeTruthy();
    setLabels({ ...markdownMediaEnUS, loading: 'Preparing preview…', html: 'HTML preview' });
    await waitFor(() => media.textContent?.includes('Preparing preview…') === true);
    expect(root.querySelector('.chat-media')).toBe(media);
    expect(root.querySelector('a')).toBeNull();
    expect(resolve).toHaveBeenCalledTimes(1);
    completeHTML('<h1>Ready</h1>');
    await waitFor(() => Boolean(media.querySelector('iframe')));
    expect(root.querySelector('.chat-media')).toBe(media);
    expect(media.querySelector('iframe')?.title).toBe('Report');
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it.each(['/Users/tangjianyin/Downloads/code/test/pelican-ride.html', './pelican-ride.html'])(
    'keeps the chat document and scroll position while HTML preview %s loads', async (source) => {
    await page.viewport(1200, 900);
    let resolveFile!: (value: Blob) => void;
    const loadMessageFile = vi.fn(() => new Promise<Blob>(resolve => { resolveFile = resolve; }));
    const openMessageFile = vi.fn(async () => undefined);
    const seed = thread({ thread_id: 'html-loading', title: 'Loading report', working_dir: '/Users/tangjianyin/Downloads/code/test', messages: [{
      id: 'html-loading-reply', role: 'assistant', status: 'complete', turn_id: 'html-loading-turn', created_at_ms: 2,
      content: `${'Report details.\n\n'.repeat(30)}[Interactive report](${source})\n\n${'More report details.\n\n'.repeat(30)}`,
    }] });
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true), listThreads: async () => [seed], loadThread: async () => liveBootstrap(seed, 1), loadMessageFile, openMessageFile,
    });
    runtime.style.height = '850px';
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="html-loading"] button')));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="html-loading"] button')!.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-media-kind="html"]')));
    const media = runtime.querySelector<HTMLElement>('[data-media-kind="html"]')!;
    media.scrollIntoView();
    await waitFor(() => loadMessageFile.mock.calls.length === 1);
    expect(media.querySelector('a')).toBeNull();
    expect(media.textContent).toContain('Loading preview');
    expect(media.querySelector('iframe')).toBeNull();
    const transcript = runtime.querySelector<HTMLElement>('.flower-chat-transcript')!;
    transcript.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, bubbles: true }));
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    const initialURL = window.location.href;
    const initialRoot = document.documentElement;
    const initialScroll = transcript.scrollTop;
    expect(initialScroll).toBeGreaterThan(0);
    const loadingHeight = media.querySelector('.chat-html-canvas')!.getBoundingClientRect().height;
    await userEvent.click(media.querySelector<HTMLElement>('.chat-html-loading')!);
    expect(window.location.href).toBe(initialURL);
    expect(document.documentElement).toBe(initialRoot);
    expect(runtime.isConnected).toBe(true);
    expect(runtime.querySelector('.flower-chat-transcript')).toBe(transcript);
    expect(transcript.scrollTop).toBe(initialScroll);
    expect(openMessageFile).not.toHaveBeenCalled();
    expect(loadMessageFile).toHaveBeenCalledWith(expect.objectContaining({ path: '/Users/tangjianyin/Downloads/code/test/pelican-ride.html' }));

    resolveFile(new Blob(['<h1>Ready</h1>'], { type: 'text/plain' }));
    await waitFor(() => Boolean(media.querySelector('iframe')));
    expect(media.querySelector('a')).toBeNull();
    expect(media.querySelector('.chat-html-canvas')!.getBoundingClientRect().height).toBe(loadingHeight);
    expect(media.querySelector<HTMLButtonElement>('button[aria-label="Expand preview"]')).toBeTruthy();
    await userEvent.click(media.querySelector<HTMLElement>('[aria-label="More actions"]')!);
    await userEvent.click(page.getByRole('menuitem', { name: 'Open file preview' }));
    await vi.waitFor(() => expect(openMessageFile).toHaveBeenCalled());
    expect(openMessageFile).toHaveBeenCalledWith({ path: '/Users/tangjianyin/Downloads/code/test/pelican-ride.html', action: 'preview' });
  });

  it('retries a failed HTML file in place and restores its preview', async () => {
    const loadMessageFile = vi.fn().mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce(new Blob(['<h1>Recovered</h1>'], { type: 'text/plain' }));
    const seed = thread({ thread_id: 'html-retry', messages: [{ id: 'html-retry-reply', role: 'assistant', status: 'complete',
      turn_id: 'html-retry-turn', created_at_ms: 2, content: '[Report](./report.html)' }] });
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => [seed],
      loadThread: async () => liveBootstrap(seed, 1), loadMessageFile });
    runtime.style.height = '850px';
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="html-retry"] button')));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="html-retry"] button')!.click();
    await waitFor(() => Boolean(runtime.querySelector('.chat-media-retry')));
    const media = runtime.querySelector<HTMLElement>('[data-media-kind="html"]')!;
    expect(media.querySelector('a, iframe')).toBeNull();
    expect(media.querySelectorAll('.chat-media-retry')).toHaveLength(1);
    expect(media.querySelector('[data-chat-media-action=source]')).toBeTruthy();
    expect(media.querySelector('[data-chat-media-action=expand]')).toBeTruthy();
    const initialURL = window.location.href;
    await userEvent.click(media.querySelector<HTMLButtonElement>('.chat-media-retry')!);
    await waitFor(() => Boolean(media.querySelector('iframe')));
    expect(window.location.href).toBe(initialURL);
    expect(runtime.querySelector('[data-media-kind="html"]')).toBe(media);
    expect(media.querySelector('a, .chat-media-retry')).toBeNull();
    expect(loadMessageFile).toHaveBeenCalledTimes(2);
  });

  it('offers retry after a failed load and does not dispatch incomplete streaming references', async () => {
    const root = document.createElement('div'); document.body.appendChild(root);
    const [content, setContent] = createSignal('![Screenshot](/project/image.png)');
    const resolve = vi.fn(async () => { throw new Error('unavailable'); });
    const dispose = render(() => <FlowerMarkdownBlock content={content()} streaming mediaEnabled copyCodeLabel="Copy code" codeCopiedLabel="Copied" mediaLabels={markdownMediaEnUS} resolveMedia={resolve} />, root);
    onTestFinished(() => { dispose(); root.remove(); });
    await new Promise<void>(done => requestAnimationFrame(() => done()));
    expect(resolve).not.toHaveBeenCalled();
    setContent('![Screenshot](/project/image.png)\n\nMore');
    await waitFor(() => root.textContent?.includes('Preview unavailable') === true);
    root.querySelector<HTMLButtonElement>('.chat-media-retry')!.click();
    await waitFor(() => resolve.mock.calls.length === 2);
  });
});
