// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PptxPreviewPane } from './PptxPreviewPane';

const state = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('@floegence/floe-webapp-core/pptx', () => ({
  PptxDocumentSurface: { open: state.open },
}));
vi.mock('./FilePreviewZoomControls', () => ({
  FilePreviewZoomControls: () => null,
}));
vi.mock('./createPreviewZoom', () => ({
  createPreviewZoom: () => ({
    scale: () => 0.5,
    viewportSize: () => ({ width: 600, height: 400 }),
    reset: () => {},
  }),
}));
const disposers: Array<() => void> = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  document.body.replaceChildren();
  vi.clearAllMocks();
});
function surface() {
  const release = vi.fn();
  return {
    pageCount: 100,
    pageWidth: 1280,
    pageHeight: 720,
    hasExternalLinks: true,
    dispose: vi.fn(),
    renderPage: vi.fn(() => ({ ready: Promise.resolve(), dispose: release })),
    release,
  };
}
function mount(bytes: () => Uint8Array<ArrayBuffer>) {
  const host = document.createElement('div');
  document.body.append(host);
  disposers.push(render(() => <PptxPreviewPane bytes={bytes()} />, host));
  return host;
}
describe('PPTX preview ownership', () => {
  it.each([false, true])(
    'windows pages and disposes the source with external links %s',
    async (hasExternalLinks) => {
      const active = surface();
      active.hasExternalLinks = hasExternalLinks;
      state.open.mockResolvedValue(active);
      const bytes = new Uint8Array([1]);
      const host = mount(() => bytes);
      await vi.waitFor(() => expect(active.renderPage).toHaveBeenCalled());
      expect(active.renderPage.mock.calls.length).toBeLessThan(8);
      expect(host.textContent).not.toContain('Static preview');
      if (hasExternalLinks) {
        expect(host.textContent).toContain('External links');
      } else {
        expect(host.textContent).not.toContain('External links');
        expect(host.firstElementChild?.children).toHaveLength(1);
      }
      const viewport = host.querySelector<HTMLElement>('.pptx-preview-pane')!;
      viewport.scrollTop = 15000;
      viewport.dispatchEvent(new Event('scroll'));
      await vi.waitFor(() => expect(active.release).toHaveBeenCalled());
      expect(host.querySelector('[data-page-number="1"]')).toBeNull();
      disposers.pop()!();
      expect(active.dispose).toHaveBeenCalledTimes(1);
    }
  );
  it('aborts replaced opens and disposes completed stale documents', async () => {
    let finish!: (value: ReturnType<typeof surface>) => void;
    state.open
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          })
      )
      .mockResolvedValueOnce(surface());
    const [bytes, setBytes] = createSignal(new Uint8Array([1]));
    mount(bytes);
    await vi.waitFor(() => expect(state.open).toHaveBeenCalledTimes(1));
    const signal = state.open.mock.calls[0]![1].signal as AbortSignal;
    setBytes(new Uint8Array([2]));
    await vi.waitFor(() => expect(state.open).toHaveBeenCalledTimes(2));
    expect(signal.aborted).toBe(true);
    const stale = surface();
    finish(stale);
    await vi.waitFor(() => expect(stale.dispose).toHaveBeenCalledTimes(1));
    expect(stale.renderPage).not.toHaveBeenCalled();
  });
  it('discloses node failures without discarding readable pages', async () => {
    const active = surface();
    active.hasExternalLinks = false;
    state.open.mockImplementation(async (_bytes, options) => {
      options.onNodeError('shape', new Error('unsupported'));
      return active;
    });
    const bytes = new Uint8Array([1]);
    const host = mount(() => bytes);
    await vi.waitFor(() =>
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        'Some slide content'
      )
    );
  });
  it('releases a failed page before retrying its renderer', async () => {
    const active = surface();
    active.renderPage.mockImplementationOnce(() => ({
      ready: Promise.reject(new Error('page failed')),
      dispose: active.release,
    }));
    state.open.mockResolvedValue(active);
    const bytes = new Uint8Array([1]);
    const host = mount(() => bytes);
    await vi.waitFor(() =>
      expect(host.textContent).toContain('Unable to render page 1')
    );
    const before = active.renderPage.mock.calls.length;
    host
      .querySelector<HTMLButtonElement>('.pptx-preview-pane__page button')!
      .click();
    await vi.waitFor(() =>
      expect(active.renderPage.mock.calls.length).toBe(before + 1)
    );
    expect(active.release).toHaveBeenCalled();
    expect(host.textContent).not.toContain('Unable to render page 1');
  });
});
