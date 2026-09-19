import { describe, expect, it, vi } from 'vitest';
import { flowerMarkdownFilePath, resolveFlowerMarkdownMedia } from './flowerMarkdownMedia';
import type { FlowerSurfaceAdapter } from '../../contracts/flowerSurfaceContracts';

describe('Flower Markdown resource resolution', () => {
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
    const resource = await resolveFlowerMarkdownMedia({ kind: 'image', title: 'Screenshot', src: ref }, controller.signal, { adapter, threadID: 'thread-a', workingDirectory: '/project' });
    expect(loadComputerFrame).toHaveBeenCalledWith(expect.objectContaining({ thread_id: 'thread-a', resource_ref: ref }));
    expect(resource.src).toMatch(/^blob:/);
    controller.abort();
    expect(revoke).toHaveBeenCalledWith(resource.src);
    revoke.mockRestore();
  });
  it('rejects type mismatches and cancelled reads before creating a media URL', async () => {
    const controller = new AbortController();
    const adapter = { loadMessageFile: async () => new Blob(['html'], { type: 'text/plain' }) } as unknown as FlowerSurfaceAdapter;
    const context = { adapter, threadID: 'thread-a', workingDirectory: '/project' };
    await expect(resolveFlowerMarkdownMedia({ kind: 'video', title: '', src: '/project/a.mp4' }, controller.signal, context)).rejects.toThrow('Media type');
    controller.abort();
    await expect(resolveFlowerMarkdownMedia({ kind: 'html', title: '', src: '/project/a.html' }, controller.signal, context)).rejects.toThrow();
  });
  it('never fetches local bytes for an arbitrary web address', async () => {
    const loadMessageFile = vi.fn();
    const context = { adapter: { loadMessageFile } as unknown as FlowerSurfaceAdapter, threadID: 't', workingDirectory: '/project' };
    expect(await resolveFlowerMarkdownMedia({ kind: 'video', title: '', src: 'https://example.com/demo.mp4' }, new AbortController().signal, context)).toEqual({ src: 'https://example.com/demo.mp4', openURL: 'https://example.com/demo.mp4' });
    expect(loadMessageFile).not.toHaveBeenCalled();
  });
});
