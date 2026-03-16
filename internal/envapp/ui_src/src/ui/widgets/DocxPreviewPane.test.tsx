// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DocxPreviewPane } from './DocxPreviewPane';

const renderAsyncMock = vi.hoisted(() => vi.fn());
const resizeObserverState = vi.hoisted(() => ({
  observers: [] as Array<{
    callback: ResizeObserverCallback;
    elements: Element[];
  }>,
}));

vi.mock('docx-preview', () => ({
  renderAsync: renderAsyncMock,
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

function defineElementSize(element: HTMLElement, width: number, height: number) {
  Object.defineProperty(element, 'offsetWidth', {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(element, 'scrollWidth', {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(element, 'offsetHeight', {
    configurable: true,
    get: () => height,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => height,
  });
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width,
      height,
      top: 0,
      left: 0,
      bottom: height,
      right: width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

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
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (predicate()) {
      return;
    }
    await flushAsyncWork();
  }
  throw new Error(errorMessage);
}

function mockRenderedDocx(pageWidth: number, pageHeight: number, wrapperWidth = pageWidth + 60, wrapperHeight = pageHeight + 60) {
  renderAsyncMock.mockImplementation(async (_bytes, container: HTMLElement, styleContainer: HTMLElement, options: { className: string }) => {
    const style = document.createElement('style');
    style.textContent = `.${options.className}-wrapper { display: flex; }`;
    styleContainer.appendChild(style);

    const wrapper = document.createElement('div');
    wrapper.className = `${options.className}-wrapper`;
    defineElementSize(wrapper, wrapperWidth, wrapperHeight);

    const page = document.createElement('section');
    page.className = options.className;
    page.style.width = `${pageWidth}px`;
    page.style.minHeight = `${pageHeight}px`;
    defineElementSize(page, pageWidth, pageHeight);

    wrapper.appendChild(page);
    container.appendChild(wrapper);
    defineElementSize(container, wrapperWidth, wrapperHeight);
  });
}

beforeEach(() => {
  renderAsyncMock.mockReset();
  resizeObserverState.observers.length = 0;

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    return window.setTimeout(() => {
      callback(performance.now());
    }, 0);
  });
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
    window.clearTimeout(handle);
  });

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
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('DocxPreviewPane', () => {
  it('renders docx with the library wrapper and scales down in fit mode for narrow viewports', async () => {
    mockRenderedDocx(800, 1200, 860, 1260);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <DocxPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.docx-preview-pane') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportWidth(viewport!, 454);

    triggerResizeObservers();
    await flushAsyncWork();

    expect(renderAsyncMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.any(HTMLElement),
      expect.any(HTMLElement),
      expect.objectContaining({
        className: 'docx-preview-container',
        inWrapper: true,
      }),
    );

    const frame = host.querySelector('.docx-preview-pane__frame') as HTMLDivElement | null;
    const content = host.querySelector('.docx-preview-pane__content') as HTMLDivElement | null;
    const wrapper = host.querySelector('.docx-preview-container-wrapper') as HTMLDivElement | null;
    await waitFor(() => frame?.style.width === '430px' && content?.style.transform === 'scale(0.5)', 'Docx preview did not scale down');

    expect(wrapper).toBeTruthy();
    expect(frame?.style.width).toBe('430px');
    expect(frame?.style.height).toBe('630px');
    expect(content?.style.transform).toBe('scale(0.5)');
    expect(host.textContent).toContain('50%');
  });

  it('keeps a 1:1 wrapper scale when the viewport is wide enough', async () => {
    mockRenderedDocx(800, 1200, 860, 1260);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <DocxPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.docx-preview-pane') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportWidth(viewport!, 960);

    triggerResizeObservers();
    await flushAsyncWork();

    const frame = host.querySelector('.docx-preview-pane__frame') as HTMLDivElement | null;
    const content = host.querySelector('.docx-preview-pane__content') as HTMLDivElement | null;

    await waitFor(() => frame?.style.width === '860px' && content?.style.transform === 'scale(1)', 'Docx preview did not keep 1:1 scale');

    expect(frame?.style.width).toBe('860px');
    expect(frame?.style.height).toBe('1260px');
    expect(content?.style.transform).toBe('scale(1)');
  });

  it('recomputes the scale when the viewport width changes', async () => {
    mockRenderedDocx(800, 1200, 860, 1260);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <DocxPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const scrollViewport = host.querySelector('.docx-preview-pane') as HTMLDivElement | null;
    expect(scrollViewport).toBeTruthy();

    setViewportWidth(scrollViewport!, 884);
    triggerResizeObservers();
    await flushAsyncWork();

    const content = host.querySelector('.docx-preview-pane__content') as HTMLDivElement | null;
    await waitFor(() => content?.style.transform === 'scale(1)', 'Docx preview did not render at natural scale');
    expect(content?.style.transform).toBe('scale(1)');

    setViewportWidth(scrollViewport!, 454);
    triggerResizeObservers();
    await waitFor(() => content?.style.transform === 'scale(0.5)', 'Docx preview did not update after resize');

    expect(content?.style.transform).toBe('scale(0.5)');
  });

  it('supports manual zoom controls and allows overflow scrolling when zoomed beyond fit width', async () => {
    mockRenderedDocx(800, 1200, 860, 1260);

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => <DocxPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.overflow-auto') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportWidth(viewport!, 454);

    triggerResizeObservers();
    await waitFor(() => host.querySelector('.docx-preview-pane__content') instanceof HTMLDivElement, 'Docx preview content not rendered');

    const zoomInButton = host.querySelector('button[aria-label="Zoom in docx preview"]') as HTMLButtonElement | null;
    const fitButton = host.querySelector('button[aria-label="Fit docx preview to width"]') as HTMLButtonElement | null;
    const frame = host.querySelector('.docx-preview-pane__frame') as HTMLDivElement | null;
    const content = host.querySelector('.docx-preview-pane__content') as HTMLDivElement | null;

    expect(viewport?.className).toContain('overflow-auto');
    expect(zoomInButton).toBeTruthy();
    expect(fitButton).toBeTruthy();

    await waitFor(
      () => content?.style.transform === 'scale(0.5)' && zoomInButton?.disabled === false,
      'Docx preview did not settle before manual zoom',
    );

    zoomInButton?.click();
    await waitFor(() => content?.style.transform === 'scale(0.6)', 'Docx preview did not zoom in manually');

    expect(frame?.style.width).toBe('516px');
    expect(frame?.style.height).toBe('756px');
    expect(content?.style.transform).toBe('scale(0.6)');

    fitButton?.click();
    await waitFor(() => content?.style.transform === 'scale(0.5)', 'Docx preview did not return to fit mode');

    expect(content?.style.transform).toBe('scale(0.5)');
  });

  it('clears the rendered document and styles when the component unmounts', async () => {
    mockRenderedDocx(800, 1200, 860, 1260);

    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => <DocxPreviewPane bytes={new Uint8Array([1, 2, 3])} />, host);

    const viewport = host.querySelector('.overflow-auto') as HTMLDivElement | null;
    expect(viewport).toBeTruthy();
    setViewportWidth(viewport!, 884);

    triggerResizeObservers();
    await flushAsyncWork();

    const documentHost = host.querySelector('.docx-preview-pane__document') as HTMLDivElement | null;
    const styleHost = host.querySelector('[aria-hidden="true"]') as HTMLDivElement | null;
    expect(documentHost?.innerHTML).not.toBe('');
    expect(styleHost?.innerHTML).not.toBe('');

    dispose();

    expect(documentHost?.innerHTML).toBe('');
    expect(styleHost?.innerHTML).toBe('');
  });
});
