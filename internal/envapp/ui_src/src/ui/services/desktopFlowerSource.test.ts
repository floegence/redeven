// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverFlowerWindowHandoff, desktopFlowerSourceIntent, desktopFlowerSourceScreenshot } from './desktopFlowerSource';
afterEach(() => { delete window.redevenDesktopShell; window.history.replaceState(null, '', '/'); });
const source = { id: 'source-1', title: 'Report', url: 'https://env.example/', captured_at_ms: 1 };
describe('Desktop source handoff', () => {
  it('attaches source context only when the launcher accepts the handoff', () => {
    const release = vi.fn(), attach = vi.fn(), open = vi.fn(() => false);
    window.redevenDesktopShell = { releaseAskFlowerSource: release };
    deliverFlowerWindowHandoff(source, 'env-1', 'Environment', open, attach);
    expect(attach).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
    open.mockReturnValue(true);
    deliverFlowerWindowHandoff(source, 'env-1', 'Environment', open, attach);
    expect(attach).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  });
  it('retains ordinary owned-window context', () => {
    const result = desktopFlowerSourceIntent({ ...source, selection: 'Selected text' }, 'env-1', 'Environment');
    expect(result.source_surface).toBe('flower_composer'); expect(JSON.stringify(result.context_items)).toContain('Selected text');
  });
  it('captures only on explicit invocation and honors cancellation', async () => {
    const capture = vi.fn(async () => ({ png: new Uint8Array([1, 2, 3]) })); window.redevenDesktopShell = { captureSourceScreenshot: capture };
    const screenshot = desktopFlowerSourceScreenshot(source.id); expect(capture).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort(); await expect(screenshot(controller.signal)).rejects.toThrow(); expect(capture).not.toHaveBeenCalled();
    expect((await screenshot(new AbortController().signal)).type).toBe('image/png'); expect(capture).toHaveBeenCalledWith(source.id);
  });
});
