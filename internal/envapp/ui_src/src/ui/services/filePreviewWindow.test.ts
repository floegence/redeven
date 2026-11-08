// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFilePreviewWindow } from './filePreviewWindow';
const copy = { unavailable: 'Unavailable', popupBlocked: 'Blocked' };
afterEach(() => { vi.restoreAllMocks(); delete window.redevenDesktopShell; window.history.replaceState({}, '', '/'); });
describe('file preview popout routing', () => {
  it('opens synchronously in a browser tab and severs the opener', async () => {
    window.history.replaceState({}, '', '/?surface=files&ticket=secret');
    const popup = { opener: window }; const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    const pending = openFilePreviewWindow('/docs/a #文.html', copy);
    expect(open).toHaveBeenCalledOnce();
    expect(open.mock.calls[0].length).toBe(2); expect(open.mock.calls[0][1]).toBe('_blank');
    expect(new URL(String(open.mock.calls[0][0])).searchParams.get('path')).toBe('/docs/a #文.html');
    expect(new URL(String(open.mock.calls[0][0])).searchParams.has('ticket')).toBe(false);
    expect(popup.opener).toBeNull(); await pending;
  });
  it('reports a blocked popup without retrying', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await expect(openFilePreviewWindow('/a', copy)).rejects.toThrow('Blocked'); expect(open).toHaveBeenCalledOnce();
  });
  it.each(['success', 'rejected', 'throws', 'missing'] as const)('uses only the native bridge: %s', async result => {
    const native = vi.fn(async () => { if (result === 'throws') throw new Error('native failed'); return { ok: result === 'success' }; });
    window.redevenDesktopShell = result === 'missing' ? { openWindow: vi.fn() } : { openFilePreviewWindow: native };
    const open = vi.spyOn(window, 'open'); const pending = openFilePreviewWindow('/a', copy);
    if (result === 'success') await expect(pending).resolves.toBeUndefined(); else await expect(pending).rejects.toThrow();
    expect(open).not.toHaveBeenCalled(); if (result !== 'missing') expect(native).toHaveBeenCalledWith({ path: '/a' });
  });
});
