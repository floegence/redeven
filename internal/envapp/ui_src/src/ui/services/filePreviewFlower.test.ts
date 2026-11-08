// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { askFilePreviewFlower } from './filePreviewFlower';
const copy = { unavailable: 'Unavailable', popupBlocked: 'Blocked' };
afterEach(() => { vi.restoreAllMocks(); delete window.redevenDesktopShell; window.history.replaceState({}, '', '/'); });
describe('standalone preview Flower routing', () => {
  it('opens a complete shell synchronously, retaining the exact file and removing shell credentials', async () => {
    window.history.replaceState({}, '', '/?window=file-preview&path=/a&ticket=secret#secret');
    const popup = { opener: window }; const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const pending = askFilePreviewFlower('/docs/文 #%.md', copy);
    expect(open).toHaveBeenCalledOnce();
    const url = new URL(String(open.mock.calls[0][0]));
    expect([...url.searchParams]).toEqual([['ask_file', '/docs/文 #%.md']]); expect(url.hash).toBe('');
    expect(open.mock.calls[0][1]).toBe('_blank'); expect(popup.opener).toBeNull(); await pending;
  });
  it('reports blocked tabs without retrying', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await expect(askFilePreviewFlower('/a', copy)).rejects.toThrow('Blocked'); expect(open).toHaveBeenCalledOnce();
  });
  it.each(['success', 'rejected', 'throws', 'missing'] as const)('requires a native acknowledgement: %s', async result => {
    const native = vi.fn(async () => { if (result === 'throws') throw new Error('native failed'); return { ok: result === 'success' }; });
    window.redevenDesktopShell = result === 'missing' ? { openWindow: vi.fn() } : { askFilePreviewFlower: native };
    const open = vi.spyOn(window, 'open'); const pending = askFilePreviewFlower('/a', copy);
    if (result === 'success') await expect(pending).resolves.toBeUndefined(); else await expect(pending).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
});
