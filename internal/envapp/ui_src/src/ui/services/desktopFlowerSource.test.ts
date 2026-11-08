// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverFlowerWindowHandoff, desktopFlowerSourceIntent, desktopFlowerSourceScreenshot, prepareFlowerWindowHandoff } from './desktopFlowerSource';
afterEach(() => { delete window.redevenDesktopShell; window.history.replaceState(null, '', '/'); });
const source = { id: 'source-1', title: 'Report', url: 'https://env.example/', captured_at_ms: 1 };
describe('Desktop source handoff', () => {
  it('attaches source context only when the launcher accepts the handoff', () => {
    const release = vi.fn(), attach = vi.fn(), open = vi.fn(() => false);
    window.redevenDesktopShell = { releaseAskFlowerSource: release };
    deliverFlowerWindowHandoff(source, 'env-1', 'Environment', 'Invalid', open, attach);
    expect(attach).not.toHaveBeenCalled(); expect(release).toHaveBeenCalledOnce();
    open.mockReturnValue(true);
    deliverFlowerWindowHandoff(source, 'env-1', 'Environment', 'Invalid', open, attach);
    expect(attach).toHaveBeenCalledOnce(); expect(release).toHaveBeenCalledOnce();
  });
  it('receives a browser file once without granting a native screenshot source', () => {
    window.history.replaceState(null, '', '/?ask_file=%2Fdocs%2Freport.html');
    expect(prepareFlowerWindowHandoff(undefined, 'env-1', 'Environment', 'Invalid')).toMatchObject({
      intent: { source_surface: 'file_preview', suggested_working_dir: '/docs' }, screenshot: undefined, anchor: undefined,
    });
    expect(window.location.search).toBe('');
    expect(() => prepareFlowerWindowHandoff(undefined, 'env-1', 'Environment', 'Invalid')).toThrow('Invalid');
  });
  it('prepares the native source anchor without capturing a screenshot', () => {
    const capture = vi.fn(); window.redevenDesktopShell = { captureSourceScreenshot: capture };
    const handoff = prepareFlowerWindowHandoff({ ...source, file_path: '/docs/report.html' }, 'env-1', 'Environment', 'Invalid');
    expect(handoff.anchor).toEqual({ x: 32, y: 80 }); expect(handoff.screenshot).toBeTypeOf('function');
    expect(handoff.intent.source_surface).toBe('file_preview'); expect(capture).not.toHaveBeenCalled();
  });
  it('retains ordinary owned-window context', () => {
    const result = desktopFlowerSourceIntent({ ...source, selection: 'Selected text' }, 'env-1', 'Environment', 'Invalid');
    expect(result.source_surface).toBe('flower_composer'); expect(JSON.stringify(result.context_items)).toContain('Selected text');
  });
  it('supplies the exact preview file context instead of a shell URL', () => {
    expect(desktopFlowerSourceIntent({ ...source, file_path: '/docs/report.html' }, 'env-1', 'Environment', 'Invalid')).toMatchObject({
      source_surface: 'file_preview', context_items: [{ kind: 'file_path', path: '/docs/report.html', is_directory: false }], suggested_working_dir: '/docs',
    });
    expect(() => desktopFlowerSourceIntent({ ...source, file_path: '../secret' }, 'env-1', 'Environment', 'Invalid')).toThrow('Invalid');
  });
  it('captures only on explicit invocation and honors cancellation', async () => {
    const capture = vi.fn(async () => ({ png: new Uint8Array([1, 2, 3]) })); window.redevenDesktopShell = { captureSourceScreenshot: capture };
    const screenshot = desktopFlowerSourceScreenshot(source.id); expect(capture).not.toHaveBeenCalled();
    const controller = new AbortController(); controller.abort(); await expect(screenshot(controller.signal)).rejects.toThrow(); expect(capture).not.toHaveBeenCalled();
    expect((await screenshot(new AbortController().signal)).type).toBe('image/png'); expect(capture).toHaveBeenCalledWith(source.id);
  });
});
