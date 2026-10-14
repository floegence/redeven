import { describe, expect, it, vi } from 'vitest';
import { flowerMarkdownFilePath, htmlPreviewSourceDirectory, openHtmlPreviewLink, resolveFlowerMarkdownMedia } from './flowerMarkdownMedia';
import { markdownMediaEnUS } from './mediaCopy';
import type { FlowerSurfaceAdapter } from '../../contracts/flowerSurfaceContracts';

describe('Flower Markdown resource resolution', () => {
  it('routes HTML links using the bound source directory without an application URL', async () => {
    const openMessageFile = vi.fn(async () => undefined);
    const openMessageURL = vi.fn(async () => undefined);
    const signal = new AbortController().signal;
    const context = { adapter: { openMessageFile, openMessageURL }, copy: markdownMediaEnUS };
    const fenceDirectory = htmlPreviewSourceDirectory({ kind: 'html', html: '<h1>Report</h1>', title: '' }, '/workspace/thread');
    const fileDirectory = htmlPreviewSourceDirectory({ kind: 'html', src: './reports/index.html', title: '' }, '/workspace/thread');
    expect(fenceDirectory).toBe('/workspace/thread');
    expect(fileDirectory).toBe('/workspace/thread/reports');
    await openHtmlPreviewLink('./details.html', fenceDirectory, signal, context);
    await openHtmlPreviewLink('../report%20one.pdf', fileDirectory, signal, context);
    await openHtmlPreviewLink('/runtime/absolute.html', '', signal, context);
    await openHtmlPreviewLink('https://example.com/news#economy', '', signal, context);
    expect(openMessageFile.mock.calls).toEqual([
      [{ path: '/workspace/thread/details.html', action: 'preview', signal }],
      [{ path: '/workspace/thread/report one.pdf', action: 'preview', signal }],
      [{ path: '/runtime/absolute.html', action: 'preview', signal }],
    ]);
    expect(openMessageURL).toHaveBeenCalledWith({ url: 'https://example.com/news#economy', signal });
  });

  it('rejects unsafe, unbound, unavailable, cancelled and failed HTML opens explicitly', async () => {
    const openMessageFile = vi.fn(async () => undefined);
    const openMessageURL = vi.fn(async () => undefined);
    const controller = new AbortController();
    const context = { adapter: { openMessageFile, openMessageURL }, copy: markdownMediaEnUS };
    for (const href of ['javascript:alert(1)', 'data:text/html,hello', 'file:///secret', 'https://user:password@example.com']) {
      await expect(openHtmlPreviewLink(href, '/workspace', controller.signal, context)).rejects.toThrow(markdownMediaEnUS.unsupportedLink);
    }
    for (const href of ['//other-host/path', '#economy', '\\secret', 'bad%zz.html', '\u0000file.html']) {
      await expect(openHtmlPreviewLink(href, '/workspace', controller.signal, context)).rejects.toThrow(markdownMediaEnUS.invalidLink);
    }
    await expect(openHtmlPreviewLink('./details.html', '', controller.signal, context)).rejects.toThrow(markdownMediaEnUS.relativePathUnavailable);
    expect(openMessageFile).not.toHaveBeenCalled();
    expect(openMessageURL).not.toHaveBeenCalled();
    await expect(openHtmlPreviewLink('/workspace/a.html', '', controller.signal, { adapter: {}, copy: markdownMediaEnUS })).rejects.toThrow(markdownMediaEnUS.linkUnavailable);
    for (const message of ['Permission denied', 'File not found', 'Browser failed']) {
      openMessageFile.mockRejectedValueOnce(new Error(message));
      await expect(openHtmlPreviewLink('/workspace/a.html', '', controller.signal, context)).rejects.toThrow(message);
    }
    controller.abort();
    await expect(openHtmlPreviewLink('https://example.com', '', controller.signal, context)).rejects.toThrow();
    expect(openMessageURL).not.toHaveBeenCalled();
  });

  it('loads a canonical tool image through thread membership and never reopens the source file', async () => {
    const loadToolImage = vi.fn(async () => new Blob(['pixels'], { type: 'image/jpeg' }));
    const loadMessageFile = vi.fn();
    const adapter = { loadToolImage, loadMessageFile } as unknown as FlowerSurfaceAdapter;
    const controller = new AbortController();
    const ref = `image://${'b'.repeat(64)}/jpeg`;
    const resource = await resolveFlowerMarkdownMedia({ kind: 'image', title: 'photo.jpg', src: ref }, controller.signal, { adapter, threadID: 'thread-a', workingDirectory: '/project', copy: markdownMediaEnUS, onActionError: vi.fn() });
    expect(loadToolImage).toHaveBeenCalledWith({ thread_id: 'thread-a', resource_ref: ref, signal: controller.signal });
    expect(loadMessageFile).not.toHaveBeenCalled();
    expect(resource.src).toMatch(/^blob:/);
    expect(resource.reveal).toBeUndefined();
    controller.abort();
  });
  it('resolves paths without granting URL or application API authority', () => {
    expect(flowerMarkdownFilePath('./reports/a b.html', '/project')).toBe('/project/reports/a b.html');
    expect(flowerMarkdownFilePath('../image.png', '/project/reports')).toBe('/project/image.png');
    for (const source of ['//host/secret', 'file:///secret', 'javascript:alert(1)', 'data:image/png,secret', '\\host\\file', '\u0000a']) {
      expect(flowerMarkdownFilePath(source, '/project')).toBeUndefined();
    }
  });
  it('uses thread-authorized screenshot loading and releases its object URL on disposal', async () => {
    const loadComputerFrame = vi.fn(async () => new Blob(['pixels'], { type: 'image/png' }));
    const adapter = { loadComputerFrame } as unknown as FlowerSurfaceAdapter;
    const controller = new AbortController();
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const ref = `computer://browser-main/${'a'.repeat(64)}`;
    const resource = await resolveFlowerMarkdownMedia({ kind: 'image', title: 'Screenshot', src: ref }, controller.signal, { adapter, threadID: 'thread-a', workingDirectory: '/project', copy: markdownMediaEnUS, onActionError: vi.fn() });
    expect(loadComputerFrame).toHaveBeenCalledWith(expect.objectContaining({ thread_id: 'thread-a', resource_ref: ref }));
    expect(resource.src).toMatch(/^blob:/);
    expect(resource.openURL).toBeUndefined();
    expect(resource.preview).toBeUndefined();
    expect(resource.reveal).toBeUndefined();
    controller.abort();
    expect(revoke).toHaveBeenCalledWith(resource.src);
    revoke.mockRestore();
  });
  it('rejects type mismatches and cancelled reads before creating a media URL', async () => {
    const controller = new AbortController();
    const adapter = { loadMessageFile: async () => new Blob(['html'], { type: 'text/plain' }) } as unknown as FlowerSurfaceAdapter;
    const context = { adapter, threadID: 'thread-a', workingDirectory: '/project', copy: markdownMediaEnUS, onActionError: vi.fn() };
    await expect(resolveFlowerMarkdownMedia({ kind: 'video', title: '', src: '/project/a.mp4' }, controller.signal, context)).rejects.toThrow('Media type');
    controller.abort();
    await expect(resolveFlowerMarkdownMedia({ kind: 'html', title: '', src: '/project/a.html' }, controller.signal, context)).rejects.toThrow();
  });
  it('exposes preview and reveal actions for local HTML files', async () => {
    const openMessageFile = vi.fn(async () => undefined);
    const controller = new AbortController();
    const adapter = {
      loadMessageFile: vi.fn(async () => new Blob(['<main>preview</main>'], { type: 'text/plain' })),
      openMessageFile,
    } as unknown as FlowerSurfaceAdapter;
    const resolved = await resolveFlowerMarkdownMedia({ kind: 'html', title: 'Report', src: './report.html' }, controller.signal, {
      adapter,
      threadID: 'thread-a',
      workingDirectory: '/project',
      copy: markdownMediaEnUS,
      onActionError: vi.fn(),
    });

    expect(resolved.preview?.label).toBe(markdownMediaEnUS.previewHTML);
    expect(resolved.reveal?.label).toBe(markdownMediaEnUS.revealInFolder);
    resolved.preview?.onSelect();
    resolved.reveal?.onSelect();
    expect(openMessageFile.mock.calls).toEqual([
      [{ path: '/project/report.html', action: 'preview' }],
      [{ path: '/project/report.html', action: 'reveal' }],
    ]);
  });
  it('opens an authorized local file or its folder through distinct host actions', async () => {
    const openMessageFile = vi.fn(async () => undefined);
    const onActionError = vi.fn();
    const controller = new AbortController();
    const adapter = { loadMessageFile: vi.fn(async () => new Blob(['pixels'], { type: 'image/png' })), openMessageFile } as unknown as FlowerSurfaceAdapter;
    let copy = markdownMediaEnUS;
    const resolved = await resolveFlowerMarkdownMedia({ kind: 'image', title: 'Chart', src: './figures/chart.png' }, controller.signal, {
      adapter, threadID: 't', workingDirectory: '/project', get copy() { return copy; }, onActionError,
    });
    expect(resolved.preview!.label).toBe(copy.previewImage);
    copy = { ...copy, previewImage: 'Preview selected image', revealInFolder: 'Show image folder' };
    expect(resolved.preview!.label).toBe(copy.previewImage);
    expect(resolved.reveal!.label).toBe(copy.revealInFolder);
    expect(adapter.loadMessageFile).toHaveBeenCalledTimes(1);
    expect(resolved.openURL).toBeUndefined();
    resolved.preview!.onSelect();
    resolved.reveal!.onSelect();
    expect(openMessageFile.mock.calls).toEqual([[{ path: '/project/figures/chart.png', action: 'preview' }], [{ path: '/project/figures/chart.png', action: 'reveal' }]]);
    openMessageFile.mockRejectedValueOnce(new Error('access denied'));
    resolved.preview!.onSelect();
    await Promise.resolve();
    expect(onActionError).toHaveBeenCalledWith(expect.objectContaining({ message: 'access denied' }));
    controller.abort();
    resolved.preview!.onSelect();
    expect(openMessageFile).toHaveBeenCalledTimes(3);
  });
  it('never fetches local bytes for an arbitrary web address', async () => {
    const loadMessageFile = vi.fn();
    const context = { adapter: { loadMessageFile } as unknown as FlowerSurfaceAdapter, threadID: 't', workingDirectory: '/project', copy: markdownMediaEnUS, onActionError: vi.fn() };
    expect(await resolveFlowerMarkdownMedia({ kind: 'video', title: '', src: 'https://example.com/demo.mp4' }, new AbortController().signal, context)).toEqual({ src: 'https://example.com/demo.mp4', openURL: 'https://example.com/demo.mp4' });
    expect(loadMessageFile).not.toHaveBeenCalled();
  });
});
