// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopShellExternalURLOpenAvailable, openExternalURLInDesktopShell } from './desktopShellBridge';
import { openPreviewWebURL } from './openPreviewWebURL';

vi.mock('./desktopShellBridge', () => ({ desktopShellExternalURLOpenAvailable: vi.fn(() => false), openExternalURLInDesktopShell: vi.fn() }));
const copy = { unavailable: 'Open unavailable', popupBlocked: 'Allow popups to open this link' };
afterEach(() => { vi.restoreAllMocks(); vi.mocked(desktopShellExternalURLOpenAvailable).mockReturnValue(false); });

describe('HTML preview browser opening', () => {
  it('uses the native browser bridge and exposes its failure', async () => {
    vi.mocked(desktopShellExternalURLOpenAvailable).mockReturnValue(true);
    vi.mocked(openExternalURLInDesktopShell).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, message: 'Native open failed' });
    const open = vi.spyOn(window, 'open');
    await openPreviewWebURL('https://example.com/news', new AbortController().signal, copy);
    await expect(openPreviewWebURL('https://example.com/news', new AbortController().signal, copy)).rejects.toThrow('Native open failed');
    expect(open).not.toHaveBeenCalled();
  });

  it('detects blocked popups and isolates an opened browser before navigating', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValueOnce(null);
    await expect(openPreviewWebURL('https://example.com/news', new AbortController().signal, copy)).rejects.toThrow(copy.popupBlocked);
    const document = window.document.implementation.createHTMLDocument();
    const replace = vi.fn(() => {
      expect(popup.opener).toBeNull();
      expect(document.querySelector('meta[name="referrer"]')?.getAttribute('content')).toBe('no-referrer');
    });
    const popup = { opener: window, document, location: { replace }, close: vi.fn() };
    open.mockReturnValueOnce(popup as unknown as Window);
    await openPreviewWebURL('https://example.com/news', new AbortController().signal, copy);
    expect(replace).toHaveBeenCalledWith('https://example.com/news');
  });

  it('rejects cancelled and unsafe intents without opening a browser', async () => {
    const open = vi.spyOn(window, 'open');
    const controller = new AbortController();
    controller.abort();
    await expect(openPreviewWebURL('https://example.com/news', controller.signal, copy)).rejects.toThrow();
    await expect(openPreviewWebURL('javascript:alert(1)', new AbortController().signal, copy)).rejects.toThrow(copy.unavailable);
    expect(open).not.toHaveBeenCalled();
  });
});
