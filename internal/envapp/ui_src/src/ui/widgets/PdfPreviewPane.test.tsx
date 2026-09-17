// @vitest-environment jsdom

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PdfPreviewPane } from './PdfPreviewPane';

const loadPDFDocumentMock = vi.hoisted(() => vi.fn());
const isPDFRenderCancelledMock = vi.hoisted(() => vi.fn((_error?: unknown) => false));
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
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  LOCAL_INTERACTION_SURFACE_ATTR: 'data-floe-local-interaction-surface',
  WORKBENCH_WIDGET_ACTIVATION_SURFACE_ATTR: 'data-floe-workbench-widget-activation-surface',
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

function setViewportSize(element: HTMLElement, width: number, height: number) {
  element.style.padding = '12px';
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => height,
  });
}

function setViewportScrollTop(element: HTMLElement, value: number) {
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => value,
    set: (next: number) => { value = next; },
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
  const cleanup = vi.fn(() => true);
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
      cleanup,
    },
    render,
    cancel,
    cleanup,
  };
}

function mockPDFDocument(params: {
  pages: Array<ReturnType<typeof createMockPage>>;
}) {
  const loadingDestroy = vi.fn();
  const document = {
    numPages: params.pages.length,
    getPage: vi.fn(async (pageNumber: number) => params.pages[pageNumber - 1]?.page),
  };

  loadPDFDocumentMock.mockReturnValue({
    promise: Promise.resolve(document),
    destroy: loadingDestroy,
  });

  return {
    document,
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
  it('renders visible PDF pages and fits them to the available viewport width', async () => {
    const firstPage = createMockPage({ width: 860, height: 1260 });
    const secondPage = createMockPage({ width: 860, height: 1260 });
    const { document: pdfDocument } = mockPDFDocument({ pages: [firstPage, secondPage] });

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <PdfPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.pdf-preview-pane') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportSize(viewport!, 454, 900);

    triggerResizeObservers();

    await waitFor(
      () => firstPage.render.mock.calls.length > 0 && secondPage.render.mock.calls.length > 0,
      'PDF pages did not render',
    );

    expect(loadPDFDocumentMock).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(pdfDocument.getPage).toHaveBeenCalledTimes(4);
    expect(host.textContent).toContain('2 pages');
    expect(host.textContent).toContain('50%');

    const firstFrame = host.querySelector('.pdf-preview-pane__page-frame') as HTMLDivElement | null;
    const firstCanvas = host.querySelector('.pdf-preview-pane__page-canvas') as HTMLCanvasElement | null;
    expect(firstFrame?.style.width).toBe('430px');
    expect(firstFrame?.style.height).toBe('630px');
    expect(firstCanvas?.style.width).toBe('430px');
    expect(firstCanvas?.style.height).toBe('630px');
  });

  it('keeps PDF metadata and zoom controls outside the scrolling viewport', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <PdfPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const controls = host.querySelector('.pdf-preview-controls');
    const viewport = host.querySelector('.pdf-preview-pane');
    expect(controls).toBeTruthy();
    expect(viewport).toBeTruthy();
    expect(controls?.parentElement).toBe(host.firstElementChild);
    expect(controls?.parentElement).not.toBe(viewport);
  });

  it('renders only nearby pages and starts rendering newly visible pages after scrolling', async () => {
    const pages = Array.from({ length: 6 }, () => createMockPage({ width: 860, height: 1260 }));
    mockPDFDocument({ pages });

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <PdfPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.pdf-preview-pane') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportSize(viewport!, 454, 420);
    setViewportScrollTop(viewport!, 0);

    triggerResizeObservers();

    await waitFor(() => pages[0]!.render.mock.calls.length > 0, 'First visible page did not render');
    (host.querySelector('button[aria-label="Fit to width"]') as HTMLButtonElement).click();
    await flushAsyncWork();
    for (const page of pages) page.render.mockClear();

    expect(host.querySelectorAll('.pdf-preview-pane__page')).toHaveLength(2);

    setViewportScrollTop(viewport!, 1500);
    viewport!.dispatchEvent(new Event('scroll'));

    await waitFor(() => pages[2]!.render.mock.calls.length > 0, 'Scrolled-into-view page did not render');
    await waitFor(() => pages[4]!.render.mock.calls.length > 0, 'Overscanned page did not pre-render');

    expect(pages[5]!.render).not.toHaveBeenCalled();
  });

  it('supports manual zoom and returns to fit mode on demand', async () => {
    const firstPage = createMockPage({ width: 860, height: 1260 });
    mockPDFDocument({ pages: [firstPage] });

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <PdfPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.pdf-preview-pane') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportSize(viewport!, 454, 900);

    triggerResizeObservers();

    const frame = () => host.querySelector('.pdf-preview-pane__page-frame') as HTMLDivElement | null;
    const zoomInButton = () => host.querySelector('button[aria-label="Zoom in PDF preview"]') as HTMLButtonElement | null;
    const fitButton = () => host.querySelector('button[aria-label="Fit to window"]') as HTMLButtonElement | null;

    await waitFor(() => frame()?.style.width === '430px', 'PDF preview did not settle into fit mode');

    zoomInButton()?.click();
    await waitFor(() => frame()?.style.width === '516px', 'PDF preview did not zoom in manually');

    expect(host.textContent).toContain('60%');

    fitButton()?.click();
    await waitFor(() => frame()?.style.width === '430px', 'PDF preview did not return to fit mode');

    expect(host.textContent).toContain('50%');
  });

  it('shows per-page rendering feedback without keeping the full-pane loading overlay visible', async () => {
    let releaseRender = () => {};
    const renderPromise = new Promise<void>((resolve) => {
      releaseRender = () => resolve();
    });
    const firstPage = createMockPage({ width: 860, height: 1260, renderPromise });
    mockPDFDocument({ pages: [firstPage] });

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <PdfPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.pdf-preview-pane') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportSize(viewport!, 454, 900);

    triggerResizeObservers();

    await waitFor(() => host.textContent?.includes('Rendering page...') ?? false, 'Page-level rendering feedback did not appear');
    expect(host.querySelector('[data-testid="loading-overlay"]')).toBeNull();

    releaseRender();
    await waitFor(() => (host.querySelector('.pdf-preview-pane__page-canvas') as HTMLCanvasElement | null)?.classList.contains('opacity-0') === false, 'Rendered page did not settle');
  });

  it('cancels in-flight rendering and destroys the loading task on unmount', async () => {
    let releaseRender = () => {};
    const renderPromise = new Promise<void>((resolve) => {
      releaseRender = () => {
        resolve();
      };
    });

    const page = createMockPage({ width: 860, height: 1260, renderPromise });
    const { loadingDestroy } = mockPDFDocument({ pages: [page] });

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => <PdfPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.pdf-preview-pane') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportSize(viewport!, 454, 900);

    triggerResizeObservers();

    await waitFor(() => page.render.mock.calls.length > 0, 'PDF page render did not start');

    dispose();
    releaseRender();
    await flushAsyncWork();

    expect(page.cancel).toHaveBeenCalledTimes(1);
    expect(loadingDestroy).toHaveBeenCalledTimes(1);
  });
});


it('does not start overlapping renders while page acquisition is pending', async () => {
  const activeCanvases = new Set<HTMLCanvasElement>();
  const page = createMockPage({ width: 860, height: 1260 });
  page.render.mockImplementation(({ canvas }: any) => {
    if (activeCanvases.has(canvas)) throw new Error('Cannot use the same canvas during multiple render() operations.');
    activeCanvases.add(canvas);
    let rejectRender: (reason: Error) => void = () => {};
    const promise = new Promise<void>((_resolve, reject) => { rejectRender = reject; });
    return { promise, cancel: () => {
      activeCanvases.delete(canvas);
      rejectRender(Object.assign(new Error('Rendering cancelled'), { name: 'RenderingCancelledException' }));
    }} as any;
  });
  isPDFRenderCancelledMock.mockImplementation((error: any) => error?.name === 'RenderingCancelledException');
  const { document: pdfDocument } = mockPDFDocument({ pages: [page] });
  const pending: Array<() => void> = [];
  let calls = 0;
  pdfDocument.getPage.mockImplementation(async () => {
    if (++calls === 1) return page.page;
    await new Promise<void>(resolve => pending.push(resolve));
    return page.page;
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <PdfPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);
  try {
    const viewport = host.querySelector('.pdf-preview-pane') as HTMLDivElement;
    setViewportSize(viewport, 454, 400);
    triggerResizeObservers();
    await waitFor(() => pending.length > 0, 'No pending page request');
    setViewportScrollTop(viewport, 1);
    viewport.dispatchEvent(new Event('scroll'));
    await flushAsyncWork();
    pending.forEach(resolve => resolve());
    await flushAsyncWork();
    expect(host.textContent).not.toContain('Cannot use the same canvas');
    expect(page.render).toHaveBeenCalledTimes(1);
  } finally { dispose(); await flushAsyncWork(); }
});

it('enlarges a small page to use the available window', async () => {
  mockPDFDocument({ pages: [createMockPage({ width: 600, height: 400 })] });
  const host = document.createElement('div'); document.body.appendChild(host);
  const dispose = render(() => <PdfPreviewPane bytes={new Uint8Array([1])} />, host);
  try {
    setViewportSize(host.querySelector('.pdf-preview-pane') as HTMLElement, 1224, 1000);
    triggerResizeObservers();
    await waitFor(() => !!host.querySelector('.pdf-preview-pane__page-frame'), 'No page');
    expect(parseFloat((host.querySelector('.pdf-preview-pane__page-frame') as HTMLElement).style.width)).toBeGreaterThan(600);
  } finally { dispose(); await flushAsyncWork(); }
});

it('waits for render settlement and renders only the latest requested scale', async () => {
  const page = createMockPage({ width: 860, height: 1260 });
  const tasks: Array<{ resolve: () => void; reject: (error: Error) => void; cancel: ReturnType<typeof vi.fn> }> = [];
  page.render.mockImplementation(() => {
    let resolve = () => {};
    let reject = (_error: Error) => {};
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const task = { resolve, reject, cancel: vi.fn() }; tasks.push(task);
    return { promise, cancel: task.cancel } as any;
  });
  mockPDFDocument({ pages: [page] });
  const host = document.createElement('div'); document.body.appendChild(host);
  const dispose = render(() => <PdfPreviewPane bytes={new Uint8Array([1])} />, host);
  try {
    setViewportSize(host.querySelector('.pdf-preview-pane') as HTMLElement, 454, 900); triggerResizeObservers();
    await waitFor(() => tasks.length === 1, 'First render did not start');
    const canvas = host.querySelector('canvas');
    const zoomIn = host.querySelector('button[aria-label="Zoom in PDF preview"]') as HTMLButtonElement;
    zoomIn.click(); zoomIn.click(); zoomIn.click();
    await flushAsyncWork();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.cancel).toHaveBeenCalled();
    tasks[0]!.reject(new Error('Late failure from a superseded render'));
    await waitFor(() => tasks.length === 2, 'Latest render did not start after settlement');
    expect(host.textContent).not.toContain('Unable to render');
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(parseFloat((host.querySelector('.pdf-preview-pane__page-frame') as HTMLElement).style.width)).toBeCloseTo(688);
    tasks[1]!.resolve(); await flushAsyncWork();
    expect(canvas!.classList.contains('opacity-0')).toBe(false);
  } finally { dispose(); }
});

it('discards a page acquired after its document was replaced', async () => {
  const oldPage = createMockPage({ width: 600, height: 400 });
  const old = mockPDFDocument({ pages: [oldPage] });
  let release = () => {};
  old.document.getPage.mockImplementationOnce(async () => oldPage.page).mockImplementation(async () => {
    await new Promise<void>(resolve => { release = resolve; }); return oldPage.page;
  });
  const [bytes, setBytes] = createSignal(new Uint8Array([1]));
  const host = document.createElement('div'); document.body.appendChild(host);
  const dispose = render(() => <PdfPreviewPane bytes={bytes()} />, host);
  try {
    setViewportSize(host.querySelector('.pdf-preview-pane') as HTMLElement, 624, 624); triggerResizeObservers();
    await waitFor(() => old.document.getPage.mock.calls.length === 2, 'Page acquisition did not start');
    const nextPage = createMockPage({ width: 400, height: 600 });
    mockPDFDocument({ pages: [nextPage] });
    setBytes(new Uint8Array([2]));
    await waitFor(() => nextPage.render.mock.calls.length === 1, 'New document did not render');
    release(); await flushAsyncWork();
    expect(oldPage.render).not.toHaveBeenCalled();
    expect(oldPage.cleanup).toHaveBeenCalled();
    expect(old.loadingDestroy).toHaveBeenCalledOnce();
  } finally { dispose(); }
});

it('keeps tiny fit scales positive and canvas allocations within the pixel budget', async () => {
  const page = createMockPage({ width: 100000, height: 80000 });
  mockPDFDocument({ pages: [page] });
  const host = document.createElement('div'); document.body.appendChild(host);
  const dispose = render(() => <PdfPreviewPane bytes={new Uint8Array([1])} />, host);
  try {
    setViewportSize(host.querySelector('.pdf-preview-pane') as HTMLElement, 424, 324); triggerResizeObservers();
    await waitFor(() => page.render.mock.calls.length > 0, 'Tiny fit page did not render');
    const canvas = host.querySelector('canvas')!;
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(6_000_000);
    expect(canvas.width).toBeGreaterThan(0);
    expect(parseFloat(canvas.style.width)).toBeLessThanOrEqual(400);
    expect(parseFloat(canvas.style.height)).toBeLessThanOrEqual(276);
    (host.querySelector('button[aria-label="Zoom in PDF preview"]') as HTMLButtonElement).click();
    await flushAsyncWork();
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(6_000_000);
    expect(canvas.width).toBeLessThanOrEqual(16_384);
  } finally { dispose(); }
});

it('keeps other pages usable and retries a genuine page failure', async () => {
  const failed = createMockPage({ width: 600, height: 400 });
  const good = createMockPage({ width: 600, height: 400 });
  failed.render.mockImplementationOnce(() => ({ promise: Promise.reject(new Error('Bad page stream')), cancel: vi.fn() }) as any);
  mockPDFDocument({ pages: [failed, good] });
  const host = document.createElement('div'); document.body.appendChild(host);
  const dispose = render(() => <PdfPreviewPane bytes={new Uint8Array([1])} />, host);
  try {
    setViewportSize(host.querySelector('.pdf-preview-pane') as HTMLElement, 624, 924); triggerResizeObservers();
    await waitFor(() => host.textContent?.includes('Unable to render page 1.') ?? false, 'Failure was not shown');
    expect(host.querySelectorAll('canvas')[1]!.classList.contains('opacity-0')).toBe(false);
    const retry = [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry')!;
    retry.click(); await flushAsyncWork();
    expect(host.textContent).not.toContain('Unable to render');
    expect(failed.render).toHaveBeenCalledTimes(2);
  } finally { dispose(); }
});

it('refreshes raster density when the display changes without changing layout', async () => {
  vi.stubGlobal('devicePixelRatio', 1);
  const page = createMockPage({ width: 600, height: 400 });
  mockPDFDocument({ pages: [page] });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <PdfPreviewPane bytes={new Uint8Array([1])} />, host);
  try {
    setViewportSize(host.querySelector('.pdf-preview-pane') as HTMLElement, 624, 624);
    triggerResizeObservers();
    await waitFor(() => page.render.mock.calls.length === 1, 'First render did not start');
    const canvas = host.querySelector('canvas')!;
    const width = canvas.width;
    const displayWidth = canvas.style.width;
    vi.stubGlobal('devicePixelRatio', 2);
    window.dispatchEvent(new Event('resize'));
    await flushAsyncWork();
    expect(canvas.width).toBe(width * 2);
    expect(canvas.style.width).toBe(displayWidth);
    expect(host.querySelector('canvas')).toBe(canvas);
  } finally { dispose(); }
});
