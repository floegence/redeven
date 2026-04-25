// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PdfPreviewPane } from './PdfPreviewPane';

const loadPDFDocumentMock = vi.hoisted(() => vi.fn());
const isPDFRenderCancelledMock = vi.hoisted(() => vi.fn(() => false));
const resizeObserverState = vi.hoisted(() => ({
  observers: [] as Array<{
    callback: ResizeObserverCallback;
    elements: Element[];
  }>,
}));

vi.mock('./pdfPreviewRuntime', () => ({
  loadPDFDocument: loadPDFDocumentMock,
  isPDFRenderCancelled: isPDFRenderCancelledMock,
}));

vi.mock('@floegence/floe-webapp-core/loading', () => ({
  LoadingOverlay: (props: any) => (
    props.visible
      ? <div data-testid="loading-overlay">{props.message}</div>
      : null
  ),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  Button: (props: any) => (
    <button
      type="button"
      class={props.class}
      disabled={props.disabled}
      aria-label={props['aria-label']}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
}));

function setViewportWidth(element: HTMLElement, width: number) {
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    get: () => width,
  });
}

function triggerResizeObservers() {
  for (const observer of resizeObserverState.observers) {
    observer.callback(
      observer.elements.map((element) => ({ target: element }) as ResizeObserverEntry),
      {} as ResizeObserver,
    );
  }
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(predicate: () => boolean, errorMessage: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await flushAsyncWork();
  }
  throw new Error(errorMessage);
}

function createMockPage(params: {
  width: number;
  height: number;
  renderPromise?: Promise<void>;
}) {
  const cancel = vi.fn();
  const render = vi.fn(({ viewport }: { viewport: { width: number; height: number } }) => ({
    promise: params.renderPromise ?? Promise.resolve(),
    cancel,
    viewport,
  }));

  return {
    page: {
      getViewport: vi.fn(({ scale }: { scale: number }) => ({
        width: Number((params.width * scale).toFixed(2)),
        height: Number((params.height * scale).toFixed(2)),
      })),
      render,
    },
    render,
    cancel,
  };
}

function mockPDFDocument(params: {
  pages: Array<ReturnType<typeof createMockPage>>;
}) {
  const destroy = vi.fn(async () => {});
  const loadingDestroy = vi.fn();
  const document = {
    numPages: params.pages.length,
    getPage: vi.fn(async (pageNumber: number) => params.pages[pageNumber - 1]?.page),
    destroy,
  };

  loadPDFDocumentMock.mockReturnValue({
    promise: Promise.resolve(document),
    destroy: loadingDestroy,
  });

  return {
    document,
    destroy,
    loadingDestroy,
  };
}

beforeEach(() => {
  loadPDFDocumentMock.mockReset();
  isPDFRenderCancelledMock.mockReset();
  isPDFRenderCancelledMock.mockReturnValue(false);
  resizeObserverState.observers.length = 0;

  vi.stubGlobal('ResizeObserver', class {
    private readonly record: {
      callback: ResizeObserverCallback;
      elements: Element[];
    };

    constructor(callback: ResizeObserverCallback) {
      this.record = {
        callback,
        elements: [],
      };
      resizeObserverState.observers.push(this.record);
    }

    observe(element: Element) {
      this.record.elements.push(element);
    }

    unobserve(element: Element) {
      this.record.elements = this.record.elements.filter((entry) => entry !== element);
    }

    disconnect() {
      this.record.elements = [];
    }
  });

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D));
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('PdfPreviewPane', () => {
  it('renders PDF pages and fits them to the available viewport width', async () => {
    const firstPage = createMockPage({ width: 860, height: 1260 });
    const secondPage = createMockPage({ width: 860, height: 1260 });
    const { document: pdfDocument } = mockPDFDocument({ pages: [firstPage, secondPage] });

    const host = document.createElement('div');
    globalThis.document.body.appendChild(host);

    render(() => <PdfPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.pdf-preview-pane') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportWidth(viewport!, 454);

    triggerResizeObservers();

    await waitFor(() => host.querySelectorAll('.pdf-preview-pane__page-frame').length === 2, 'PDF pages did not mount');
    await waitFor(
      () => firstPage.render.mock.calls.length > 0 && secondPage.render.mock.calls.length > 0,
      'PDF pages did not render',
    );

    expect(loadPDFDocumentMock).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(pdfDocument.getPage).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('2 pages');
    expect(host.textContent).toContain('50%');

    const firstFrame = host.querySelector('.pdf-preview-pane__page-frame') as HTMLDivElement | null;
    const firstCanvas = host.querySelector('.pdf-preview-pane__page-canvas') as HTMLCanvasElement | null;
    expect(firstFrame?.style.width).toBe('430px');
    expect(firstFrame?.style.height).toBe('630px');
    expect(firstCanvas?.style.width).toBe('430px');
    expect(firstCanvas?.style.height).toBe('630px');
  });

  it('supports manual zoom and returns to fit mode on demand', async () => {
    const firstPage = createMockPage({ width: 860, height: 1260 });
    mockPDFDocument({ pages: [firstPage] });

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <PdfPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.pdf-preview-pane') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportWidth(viewport!, 454);

    triggerResizeObservers();

    const frame = () => host.querySelector('.pdf-preview-pane__page-frame') as HTMLDivElement | null;
    const zoomInButton = () => host.querySelector('button[aria-label="Zoom in PDF preview"]') as HTMLButtonElement | null;
    const fitButton = () => host.querySelector('button[aria-label="Fit PDF preview to width"]') as HTMLButtonElement | null;

    await waitFor(() => frame()?.style.width === '430px', 'PDF preview did not settle into fit mode');

    zoomInButton()?.click();
    await waitFor(() => frame()?.style.width === '516px', 'PDF preview did not zoom in manually');

    expect(host.textContent).toContain('60%');

    fitButton()?.click();
    await waitFor(() => frame()?.style.width === '430px', 'PDF preview did not return to fit mode');

    expect(host.textContent).toContain('50%');
  });

  it('cancels in-flight rendering and destroys the loaded document on unmount', async () => {
    let releaseRender = () => {};
    const renderPromise = new Promise<void>((resolve) => {
      releaseRender = () => {
        resolve();
      };
    });

    const page = createMockPage({ width: 860, height: 1260, renderPromise });
    const { destroy, loadingDestroy } = mockPDFDocument({ pages: [page] });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => <PdfPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.pdf-preview-pane') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportWidth(viewport!, 454);

    triggerResizeObservers();

    await waitFor(() => page.render.mock.calls.length > 0, 'PDF page render did not start');

    dispose();
    releaseRender();
    await flushAsyncWork();

    expect(page.cancel).toHaveBeenCalledTimes(1);
    expect(loadingDestroy).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalled();
  });
});
