// @vitest-environment jsdom

import { createSignal } from 'solid-js';
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
  it('fits the page by width and height, enlarges, and preserves manual zoom on resize', async () => {
    mockRenderedDocx(800, 1200, 800, 1200);
    const host = document.createElement('div'); document.body.appendChild(host);
    const dispose = render(() => <DocxPreviewPane bytes={new Uint8Array([1])} />, host);
    try {
      const viewport = host.querySelector('.docx-preview-pane') as HTMLElement;
      viewport.style.padding = '12px';
      Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 624 });
      setViewportWidth(viewport, 1224); triggerResizeObservers();
      const content = () => host.querySelector('.docx-preview-pane__content') as HTMLElement;
      await waitFor(() => content()?.style.transform === 'scale(0.5)', 'Page must fit height');
      (host.querySelector('button[aria-label="Fit to width"]') as HTMLButtonElement).click();
      expect(content().style.transform).toBe('scale(1.5)');
      (host.querySelector('button[aria-label="Zoom in DOCX preview"]') as HTMLButtonElement).click();
      expect(content().style.transform).toBe('scale(1.6)');
      setViewportWidth(viewport, 424); triggerResizeObservers();
      expect(content().style.transform).toBe('scale(1.6)');
      (host.querySelector('button[aria-label="Fit to window"]') as HTMLButtonElement).click();
      expect(content().style.transform).toBe('scale(0.5)');
    } finally { dispose(); }
  });

  it('ignores projected screen coordinates when measuring intrinsic document size', async () => {
    mockRenderedDocx(800, 1200, 800, 1200);
    const host = document.createElement('div'); document.body.appendChild(host);
    const dispose = render(() => <DocxPreviewPane bytes={new Uint8Array([1])} />, host);
    try {
      const viewport = host.querySelector('.docx-preview-pane') as HTMLElement;
      viewport.style.padding = '12px'; setViewportWidth(viewport, 424);
      Object.defineProperty(viewport, 'clientHeight', { configurable: true, value: 824 }); triggerResizeObservers();
      await waitFor(() => !!host.querySelector('section'), 'No document');
      for (const el of host.querySelectorAll<HTMLElement>('.docx-preview-container-wrapper, section')) {
        Object.defineProperty(el, 'getBoundingClientRect', { configurable: true, value: () => ({ width: 1600, height: 2400 }) });
      }
      triggerResizeObservers();
      expect((host.querySelector('.docx-preview-pane__content') as HTMLElement).style.transform).toBe('scale(0.5)');
    } finally { dispose(); }
    expect(host.querySelector('style')).toBeNull();
  });
});

it('isolates late document and style writes after changing the source', async () => {
  const pending: Array<() => void> = [];
  renderAsyncMock.mockImplementation((_bytes, container: HTMLElement, styleContainer: HTMLElement) => new Promise<void>(resolve => {
    const marker = pending.length === 0 ? 'old document' : 'new document';
    pending.push(() => {
      const wrapper = document.createElement('div'); wrapper.className = 'docx-preview-container-wrapper';
      const page = document.createElement('section'); page.className = 'docx-preview-container'; page.textContent = marker;
      defineElementSize(page, 800, 1200); wrapper.append(page); defineElementSize(wrapper, 800, 1200);
      container.replaceChildren(wrapper);
      const style = document.createElement('style'); style.textContent = marker; styleContainer.replaceChildren(style);
      resolve();
    });
  }));
  const [bytes, setBytes] = createSignal(new Uint8Array([1]));
  const host = document.createElement('div'); document.body.appendChild(host);
  const dispose = render(() => <DocxPreviewPane bytes={bytes()} />, host);
  try {
    await waitFor(() => pending.length === 1, 'First render not started');
    setBytes(new Uint8Array([2]));
    await waitFor(() => pending.length === 2, 'Second render not started');
    pending[1]!(); await flushAsyncWork(); pending[0]!(); await flushAsyncWork();
    expect(host.querySelector('.docx-preview-pane__document')?.textContent).toBe('new document');
    expect(host.querySelector('style')?.textContent).toBe('new document');
  } finally { dispose(); }
});
