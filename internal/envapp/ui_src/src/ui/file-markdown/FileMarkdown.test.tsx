// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { FileMarkdown } from './FileMarkdown';

const postProcessMock = vi.hoisted(() => vi.fn());

vi.mock('./mermaidPlugin', () => ({
  setupMermaid: vi.fn(),
  runMermaid: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./postProcess', () => ({
  postProcess: (...args: unknown[]) => postProcessMock(...args),
}));

function rect(top: number, height = 24): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    bottom: top + height,
    left: 0,
    right: 320,
    width: 320,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function defineScrollMetrics(
  element: HTMLElement,
  metrics: { readonly clientHeight: number; readonly scrollHeight: number },
): void {
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight,
  });
}

function activeTocText(host: HTMLElement): string {
  return host.querySelector<HTMLElement>('.fm-toc-active')?.textContent?.trim() ?? '';
}

describe('FileMarkdown', () => {
  beforeEach(() => {
    vi.stubGlobal('CSS', {
      ...(globalThis.CSS ?? {}),
      escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
    });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(16);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('class');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-switching');
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('opens markdown previews in reading mode by default', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'# Start\n\nDetails'}
      />
    ), host);

    try {
      await flushAsync();

      const body = host.querySelector<HTMLElement>('.file-markdown-body');
      const readingButton = host.querySelector<HTMLButtonElement>('button[title="Reading mode"]');
      expect(body?.classList.contains('file-markdown-reading')).toBe(true);
      expect(readingButton?.getAttribute('aria-pressed')).toBe('true');
    } finally {
      dispose();
    }
  });

  it('re-processes existing code blocks when the app theme changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'```ts\nconst value = 1;\n```'}
      />
    ), host);

    try {
      await flushAsync();
      expect(postProcessMock).toHaveBeenCalledTimes(1);

      document.documentElement.classList.add('dark');
      await flushAsync();

      expect(postProcessMock).toHaveBeenCalledTimes(2);
    } finally {
      dispose();
    }
  });

  it('keeps TOC navigation inside the markdown scroll container instead of scrolling outer workbench surfaces', async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    const workbenchCanvas = document.createElement('div');
    const previewViewport = document.createElement('div');
    const host = document.createElement('div');
    workbenchCanvas.appendChild(previewViewport);
    previewViewport.appendChild(host);
    document.body.appendChild(workbenchCanvas);
    workbenchCanvas.scrollTop = 320;
    previewViewport.scrollTop = 140;

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'# Start\n\nIntro\n\n## Target Heading\n\nDetails'}
      />
    ), host);

    try {
      await flushAsync();

      const container = host.querySelector<HTMLElement>('.file-markdown-body');
      const target = host.querySelector<HTMLElement>('#target-heading');
      const link = host.querySelector<HTMLAnchorElement>('a[href="#target-heading"]');
      expect(container).toBeTruthy();
      expect(target).toBeTruthy();
      expect(link).toBeTruthy();

      container!.scrollTop = 40;
      container!.getBoundingClientRect = () => rect(100, 360);
      target!.getBoundingClientRect = () => rect(420, 28);
      const scrollTo = vi.fn((options?: ScrollToOptions) => {
        container!.scrollTop = Number(options?.top ?? 0);
      });
      Object.defineProperty(container, 'scrollTo', {
        configurable: true,
        value: scrollTo,
      });

      link!.click();

      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(scrollTo).toHaveBeenCalledWith({ top: 352, behavior: 'smooth' });
      expect(container!.scrollTop).toBe(352);
      expect(previewViewport.scrollTop).toBe(140);
      expect(workbenchCanvas.scrollTop).toBe(320);
      expect(window.location.hash).toBe('');
    } finally {
      dispose();
    }
  });

  it('opens relative file links from markdown tables without navigating the app shell', async () => {
    const openFileLink = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.history.replaceState(null, '', '/_redeven_proxy/env/');

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'| Item | Link |\n| --- | --- |\n| Review | [`docs/CAPABILITY_PERMISSIONS.md`](docs/CAPABILITY_PERMISSIONS.md) |'}
        onOpenFileLink={openFileLink}
      />
    ), host);

    try {
      await flushAsync();

      const link = host.querySelector<HTMLAnchorElement>('a[href="docs/CAPABILITY_PERMISSIONS.md"]');
      expect(link).toBeTruthy();

      link!.click();

      expect(openFileLink).toHaveBeenCalledWith({
        path: '/workspace/docs/CAPABILITY_PERMISSIONS.md',
        fragment: '',
        href: 'docs/CAPABILITY_PERMISSIONS.md',
      });
      expect(window.location.pathname).toBe('/_redeven_proxy/env/');
    } finally {
      dispose();
    }
  });

  it('opens raw HTML relative file links without relying on browser navigation', async () => {
    const openFileLink = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.history.replaceState(null, '', '/_redeven_proxy/env/');

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/docs/README.md"
        content={'<a href="../PERMISSION_POLICY.md#trust">Policy</a>'}
        onOpenFileLink={openFileLink}
      />
    ), host);

    try {
      await flushAsync();

      host.querySelector<HTMLAnchorElement>('a[href="../PERMISSION_POLICY.md#trust"]')?.click();

      expect(openFileLink).toHaveBeenCalledWith({
        path: '/workspace/PERMISSION_POLICY.md',
        fragment: 'trust',
        href: '../PERMISSION_POLICY.md#trust',
      });
      expect(window.location.pathname).toBe('/_redeven_proxy/env/');
    } finally {
      dispose();
    }
  });

  it('blocks unresolved local links instead of navigating the app shell', async () => {
    const unresolved = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    window.history.replaceState(null, '', '/_redeven_proxy/env/');

    const dispose = render(() => (
      <FileMarkdown
        content={'[Policy](docs/PERMISSION_POLICY.md)'}
        onUnresolvedLocalLink={unresolved}
      />
    ), host);

    try {
      await flushAsync();

      host.querySelector<HTMLAnchorElement>('a[href="docs/PERMISSION_POLICY.md"]')?.click();

      expect(unresolved).toHaveBeenCalledWith('docs/PERMISSION_POLICY.md', 'missing_current_file_path');
      expect(window.location.pathname).toBe('/_redeven_proxy/env/');
    } finally {
      dispose();
    }
  });

  it('leaves external links to the browser default behavior', async () => {
    const openFileLink = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'[External](https://example.com/docs)'}
        onOpenFileLink={openFileLink}
      />
    ), host);

    try {
      await flushAsync();

      const link = host.querySelector<HTMLAnchorElement>('a[href="https://example.com/docs"]');
      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      link?.dispatchEvent(clickEvent);

      expect(openFileLink).not.toHaveBeenCalled();
      expect(clickEvent.defaultPrevented).toBe(false);
    } finally {
      dispose();
    }
  });

  it('keeps the clicked TOC item active while smooth scrolling passes other headings', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'# Start\n\n## Middle Heading\n\n## Target Heading'}
      />
    ), host);

    try {
      await flushAsync();

      const container = host.querySelector<HTMLElement>('.file-markdown-body');
      const startHeading = host.querySelector<HTMLElement>('#start');
      const middleHeading = host.querySelector<HTMLElement>('#middle-heading');
      const targetHeading = host.querySelector<HTMLElement>('#target-heading');
      const targetLink = host.querySelector<HTMLAnchorElement>('a[href="#target-heading"]');
      expect(container).toBeTruthy();
      expect(startHeading).toBeTruthy();
      expect(middleHeading).toBeTruthy();
      expect(targetHeading).toBeTruthy();
      expect(targetLink).toBeTruthy();

      defineScrollMetrics(container!, { clientHeight: 360, scrollHeight: 1200 });
      container!.getBoundingClientRect = () => rect(100, 360);
      startHeading!.getBoundingClientRect = () => rect(-120, 24);
      middleHeading!.getBoundingClientRect = () => rect(150, 24);
      targetHeading!.getBoundingClientRect = () => rect(520, 24);

      Object.defineProperty(container, 'scrollTo', {
        configurable: true,
        value: vi.fn((options?: ScrollToOptions) => {
          container!.scrollTop = Number(options?.top ?? 0);
        }),
      });

      targetLink!.click();
      container!.dispatchEvent(new Event('scroll'));

      expect(activeTocText(host)).toBe('Target Heading');
    } finally {
      dispose();
    }
  });

  it('places preview controls inside the TOC panel instead of reserving a separate toolbar row', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'# Start\n\n## Target Heading\n\nDetails'}
      />
    ), host);

    try {
      await flushAsync();

      const wrapper = host.querySelector<HTMLElement>('.file-markdown-wrapper');
      const panel = host.querySelector<HTMLElement>('.fm-toc-panel');
      const toolbar = host.querySelector<HTMLElement>('.fm-toolbar');
      const title = host.querySelector<HTMLElement>('.fm-toc-title');
      expect(wrapper).toBeTruthy();
      expect(panel).toBeTruthy();
      expect(toolbar).toBeTruthy();
      expect(title).toBeTruthy();
      expect(panel!.contains(toolbar!)).toBe(true);
      expect(panel!.compareDocumentPosition(toolbar!) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy();
      expect(toolbar!.compareDocumentPosition(title!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(Array.from(wrapper!.children).some((child) => child.classList.contains('fm-toolbar'))).toBe(false);
    } finally {
      dispose();
    }
  });

  it('returns TOC activity to the markdown scroll position after user scrolling', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'# Start\n\n## Middle Heading\n\n## Target Heading'}
      />
    ), host);

    try {
      await flushAsync();

      const container = host.querySelector<HTMLElement>('.file-markdown-body');
      const startHeading = host.querySelector<HTMLElement>('#start');
      const middleHeading = host.querySelector<HTMLElement>('#middle-heading');
      const targetHeading = host.querySelector<HTMLElement>('#target-heading');
      const targetLink = host.querySelector<HTMLAnchorElement>('a[href="#target-heading"]');
      expect(container).toBeTruthy();
      expect(startHeading).toBeTruthy();
      expect(middleHeading).toBeTruthy();
      expect(targetHeading).toBeTruthy();
      expect(targetLink).toBeTruthy();

      defineScrollMetrics(container!, { clientHeight: 360, scrollHeight: 1200 });
      container!.getBoundingClientRect = () => rect(100, 360);
      startHeading!.getBoundingClientRect = () => rect(-120, 24);
      middleHeading!.getBoundingClientRect = () => rect(150, 24);
      targetHeading!.getBoundingClientRect = () => rect(520, 24);

      Object.defineProperty(container, 'scrollTo', {
        configurable: true,
        value: vi.fn((options?: ScrollToOptions) => {
          container!.scrollTop = Number(options?.top ?? 0);
        }),
      });

      targetLink!.click();
      expect(activeTocText(host)).toBe('Target Heading');

      container!.dispatchEvent(new WheelEvent('wheel'));
      container!.dispatchEvent(new Event('scroll'));

      expect(activeTocText(host)).toBe('Middle Heading');
    } finally {
      dispose();
    }
  });
});
