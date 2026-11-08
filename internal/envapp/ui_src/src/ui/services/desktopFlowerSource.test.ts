// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { desktopFlowerSourceIntent, desktopFlowerSourceScreenshot } from './desktopFlowerSource';
afterEach(() => { delete window.redevenDesktopShell; });
const source = { id: 'source-1', title: 'Report', url: 'https://env.example/', captured_at_ms: 1 };
describe('Desktop source handoff', () => {
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
