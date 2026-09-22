// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PdfPreviewPane } from './PdfPreviewPane';
import { selectPreviewZoomMode } from './previewZoom.test-support';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), sessions: [] as any[],
  observers: [] as Array<{ callback: ResizeObserverCallback; elements: Element[] }>,
  render: vi.fn(async (_page: number, _scale: number) => {}),
}));
vi.mock('@floegence/floe-webapp-core/pdf.css', () => ({}));
vi.mock('./pdfPreviewRuntime', () => ({ loadPDFDocument: mocks.load, pdfAssetsUrl: '/pdf-assets/' }));
vi.mock('@floegence/floe-webapp-core/pdf', () => ({
  PdfDocumentSurface: class {
    options: any;
    pages = new Map<number, { render: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>();
    destroy = vi.fn(() => { for (const page of this.pages.values()) (page.dispose as () => void)(); });
    setScale = vi.fn(); setCurrentPage = vi.fn(); search = vi.fn(); clearSearch = vi.fn();
    save = vi.fn(async () => new Uint8Array([37, 80, 68, 70]));
    constructor(options: any) { this.options = options; mocks.sessions.push(this); }
    mountPage(page: { pageNumber: number }) {
      const owner = { render: vi.fn((scale: number) => mocks.render(page.pageNumber, scale)), dispose: vi.fn() };
      this.pages.set(page.pageNumber, owner);
      return owner;
    }
  },
  PdfLocalization: class { translate = vi.fn(); destroy = vi.fn(); },
}));
vi.mock('@floegence/floe-webapp-core/ui', async original => ({
  ...await original<typeof import('@floegence/floe-webapp-core/ui')>(),
  createFloatingPresence: (options: { open: () => boolean }) => ({ mounted: options.open, exiting: () => false, state: () => 'entered' }),
}));

let dispose: (() => void) | undefined;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function documentFixture(count = 1) {
  const pages = Array.from({ length: count }, (_, index) => ({ pageNumber: index + 1,
    getViewport: () => ({ width: 860, height: 1260 }), cleanup: vi.fn(),
  }));
  const document = { numPages: count, getPage: vi.fn(async (number: number) => pages[number - 1]!) };
  const task = { promise: Promise.resolve(document), destroy: vi.fn() };
  mocks.load.mockReturnValue(task);
  return { document, pages, task };
}
function mount(view: () => any, height = 900) {
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(view, host);
  const viewport = host.querySelector<HTMLElement>('.pdf-preview-pane')!;
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 454 });
  Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: height });
  viewport.style.padding = '12px';
  for (const observer of mocks.observers) observer.callback(observer.elements.map(target => ({ target }) as ResizeObserverEntry), {} as ResizeObserver);
  return { host, viewport };
}
const settled = () => vi.waitFor(() => expect(mocks.render).toHaveBeenCalled());
beforeEach(() => {
  mocks.load.mockReset(); mocks.sessions.length = 0; mocks.observers.length = 0;
  mocks.render.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('ResizeObserver', class {
    record: { callback: ResizeObserverCallback; elements: Element[] };
    constructor(callback: ResizeObserverCallback) { this.record = { callback, elements: [] }; mocks.observers.push(this.record); }
    observe(element: Element) { this.record.elements.push(element); }
    unobserve() {} disconnect() {}
  });
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.unstubAllGlobals(); });

it('fits layered pages to local dimensions and keeps controls outside the scrolling viewport', async () => {
  documentFixture(2);
  const bytes = new Uint8Array([1, 2]);
  const { host, viewport } = mount(() => <PdfPreviewPane bytes={bytes} />);
  await settled();
  expect(mocks.load).toHaveBeenCalledWith(bytes);
  expect(mocks.render).toHaveBeenCalledWith(1, 0.5);
  expect(mocks.render).toHaveBeenCalledWith(2, 0.5);
  expect(host.querySelector<HTMLElement>('.pdf-preview-pane__page-frame')!.style.width).toBe('430px');
  expect(host.querySelector('.pdf-preview-controls')!.parentElement).not.toBe(viewport);
  expect(await selectPreviewZoomMode(host, 'Fit to window')).toContain('2 pages');
});

it('mounts only nearby pages and disposes pages that leave the viewport', async () => {
  documentFixture(30);
  const { host, viewport } = mount(() => <PdfPreviewPane bytes={new Uint8Array([1])} />, 420);
  await settled();
  await selectPreviewZoomMode(host, 'Fit to width');
  await vi.waitFor(() => expect(host.querySelectorAll('.pdf-preview-pane__page')).toHaveLength(2));
  const first = mocks.sessions[0].pages.get(1);
  viewport.scrollTop = 5000; viewport.dispatchEvent(new Event('scroll'));
  await vi.waitFor(() => expect(first.dispose).toHaveBeenCalled());
  expect(host.querySelectorAll('.pdf-preview-pane__page').length).toBeLessThan(6);
  await vi.waitFor(() => expect(mocks.render.mock.calls.some(([number]) => number > 5)).toBe(true));
  expect(mocks.render.mock.calls.some(([number]) => number > 12)).toBe(false);
});

it('ignores late page acquisition after the source document is replaced', async () => {
  const first = documentFixture();
  const pending = deferred<typeof first.pages[0]>();
  first.document.getPage.mockResolvedValueOnce(first.pages[0]!).mockReturnValueOnce(pending.promise);
  const [bytes, setBytes] = createSignal(new Uint8Array([1]));
  mount(() => <PdfPreviewPane bytes={bytes()} />);
  await vi.waitFor(() => expect(first.document.getPage).toHaveBeenCalledTimes(2));
  documentFixture(); setBytes(new Uint8Array([2]));
  await settled();
  pending.resolve(first.pages[0]!);
  await vi.waitFor(() => expect(first.pages[0]!.cleanup).toHaveBeenCalled());
  expect(first.task.destroy).toHaveBeenCalledOnce();
  expect(mocks.sessions[0].pages.size).toBe(0);
  expect(mocks.sessions[0].destroy).toHaveBeenCalledOnce();
});

it('reports a page failure with retry while keeping the document mounted', async () => {
  documentFixture();
  mocks.render.mockRejectedValueOnce(new Error('Broken page operator'));
  const { host } = mount(() => <PdfPreviewPane bytes={new Uint8Array([1])} />);
  await vi.waitFor(() => expect(host.textContent).toContain('Broken page operator'));
  (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Retry') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(host.textContent).not.toContain('Broken page operator'));
  await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledTimes(2));
  expect(mocks.load).toHaveBeenCalledOnce();
});

it('registers only the editable document and releases its binding on replacement', async () => {
  documentFixture();
  const binding = { markDirty: vi.fn(), dispose: vi.fn() };
  const bind = vi.fn((_editor: import('./pdfPreviewEditor').PdfPreviewEditor) => binding);
  const [editing, setEditing] = createSignal(false);
  const bytes = new Uint8Array([1]);
  mount(() => <PdfPreviewPane bytes={bytes} editing={editing()} bindPdfEditor={bind} />);
  await settled(); expect(bind).not.toHaveBeenCalled();
  setEditing(true);
  await vi.waitFor(() => expect(bind).toHaveBeenCalledOnce());
  expect(bind.mock.calls[0]![0].sourceBytes).toBe(bytes);
  mocks.sessions.at(-1).options.onDirty(); expect(binding.markDirty).toHaveBeenCalledOnce();
  setEditing(false);
  await vi.waitFor(() => expect(binding.dispose).toHaveBeenCalledOnce());
  expect(mocks.sessions.at(-1).options.editable).toBe(false);
});

it('uses the upstream search session from a locally scoped find control', async () => {
  documentFixture();
  const { host, viewport } = mount(() => <PdfPreviewPane bytes={new Uint8Array([1])} />);
  await settled();
  viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true }));
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  expect(input).toBeTruthy();
  input.value = 'contract'; input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(mocks.sessions[0].search).toHaveBeenCalledWith('contract');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  expect(host.querySelector('input[type="search"]')).toBeNull();
  expect(mocks.sessions[0].clearSearch).toHaveBeenCalledOnce();
});
