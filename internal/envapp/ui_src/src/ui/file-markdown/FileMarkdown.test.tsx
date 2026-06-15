// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import DOMPurify from 'dompurify';
import { FileMarkdown } from './FileMarkdown';

const postProcessMock = vi.hoisted(() => vi.fn());
const runMermaidMock = vi.hoisted(() => vi.fn());
const buildTocMock = vi.hoisted(() => vi.fn());
const actualBuildToc = vi.hoisted(() => ({
  current: undefined as undefined | ((container: HTMLElement) => unknown),
}));

vi.mock('./mermaidPlugin', () => ({
  setupMermaid: vi.fn(),
  runMermaid: (...args: unknown[]) => runMermaidMock(...args),
}));

vi.mock('./postProcess', () => ({
  postProcess: (...args: unknown[]) => postProcessMock(...args),
}));

vi.mock('./tocBuilder', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tocBuilder')>();
  actualBuildToc.current = actual.buildToc;
  return {
    ...actual,
    buildToc: (container: HTMLElement) => buildTocMock(container),
  };
});

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

function markdownBodyText(host: HTMLElement): string {
  return host.querySelector<HTMLElement>('.file-markdown-body')?.textContent ?? '';
}

function previewWarning(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('.fm-preview-warning[role="status"]');
}

function previewFatal(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('.fm-preview-fatal');
}

function shouldContinueForRun(callIndex: number): (() => boolean) | undefined {
  return (runMermaidMock.mock.calls[callIndex]?.[1] as { shouldContinue?: () => boolean } | undefined)?.shouldContinue;
}

describe('FileMarkdown', () => {
  beforeEach(() => {
    runMermaidMock.mockResolvedValue(undefined);
    buildTocMock.mockImplementation((container: HTMLElement) => actualBuildToc.current?.(container));
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
    vi.restoreAllMocks();
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

  it('ignores stale asynchronous markdown post-render work after content changes', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    let resolveFirstRender!: () => void;
    runMermaidMock
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveFirstRender = resolve;
      }))
      .mockResolvedValue(undefined);

    const [content, setContent] = createSignal('# Old Heading\n\nOld body');
    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={content()}
      />
    ), host);

    try {
      await vi.waitFor(() => {
        expect(runMermaidMock).toHaveBeenCalledTimes(1);
      });
      expect(shouldContinueForRun(0)?.()).toBe(true);

      setContent('# New Heading\n\nNew body');

      await vi.waitFor(() => {
        expect(runMermaidMock).toHaveBeenCalledTimes(2);
        expect(activeTocText(host)).toBe('New Heading');
      });
      expect(postProcessMock).toHaveBeenCalledTimes(1);
      expect(buildTocMock).toHaveBeenCalledTimes(1);
      expect(shouldContinueForRun(0)?.()).toBe(false);
      expect(shouldContinueForRun(1)?.()).toBe(true);

      resolveFirstRender();
      await flushAsync();

      expect(activeTocText(host)).toBe('New Heading');
      expect(postProcessMock).toHaveBeenCalledTimes(1);
      expect(buildTocMock).toHaveBeenCalledTimes(1);
      expect(previewWarning(host)).toBeNull();
      expect(previewFatal(host)).toBeNull();
    } finally {
      dispose();
    }
  });

  it('does not commit pending markdown work after the component is disposed', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unhandledReasons: unknown[] = [];
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      unhandledReasons.push(event.reason);
    };

    let resolveRender!: () => void;
    runMermaidMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveRender = resolve;
    }));
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'# Start\n\nDetails'}
      />
    ), host);

    try {
      await vi.waitFor(() => {
        expect(runMermaidMock).toHaveBeenCalledTimes(1);
      });

      dispose();
      expect(shouldContinueForRun(0)?.()).toBe(false);

      resolveRender();
      await flushAsync();

      expect(postProcessMock).not.toHaveBeenCalled();
      expect(buildTocMock).not.toHaveBeenCalled();
      expect(unhandledReasons).toEqual([]);
    } finally {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    }
  });

  it('keeps the existing TOC DOM when content changes without changing headings', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const [content, setContent] = createSignal('# Stable Heading\n\nFirst body');

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={content()}
      />
    ), host);

    try {
      await vi.waitFor(() => {
        expect(activeTocText(host)).toBe('Stable Heading');
      });

      const initialTocLink = host.querySelector<HTMLAnchorElement>('a[href="#stable-heading"]');
      expect(initialTocLink).toBeTruthy();

      setContent('# Stable Heading\n\nSecond body');

      await vi.waitFor(() => {
        expect(host.querySelector('.file-markdown-body')?.textContent).toContain('Second body');
        expect(postProcessMock).toHaveBeenCalledTimes(2);
      });

      expect(host.querySelector<HTMLAnchorElement>('a[href="#stable-heading"]')).toBe(initialTocLink);
      expect(activeTocText(host)).toBe('Stable Heading');
    } finally {
      dispose();
    }
  });

  it('renders markdown post-processing failures as non-blocking preview warnings', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const writeText = vi.fn().mockResolvedValue(undefined);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    postProcessMock.mockImplementationOnce(() => {
      throw new Error('post-process exploded');
    });

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'# Start\n\nDetails'}
      />
    ), host);

    try {
      await vi.waitFor(() => {
        expect(previewWarning(host)?.textContent).toContain('Preview enhancements unavailable');
      });
      expect(postProcessMock).toHaveBeenCalledTimes(1);
      expect(markdownBodyText(host)).toContain('Start');
      expect(markdownBodyText(host)).toContain('Details');
      expect(previewFatal(host)).toBeNull();
      expect(host.querySelector(`.${['fm', 'render', 'error'].join('-')}`)).toBeNull();
      expect(host.querySelector('.fm-toc-panel')).toBeNull();
      const floatingSlot = host.querySelector<HTMLElement>('.fm-floating-toolbar-slot-warning');
      const floatingToolbar = floatingSlot?.querySelector<HTMLElement>('.fm-toolbar-floating-inline');
      expect(floatingSlot).toBeTruthy();
      expect(floatingToolbar).toBeTruthy();
      expect(floatingSlot!.compareDocumentPosition(previewWarning(host)!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(consoleError).toHaveBeenCalledWith('Markdown preview post-process failed:', expect.any(Error));

      const detailsButton = Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Technical details'));
      expect(detailsButton).toBeTruthy();
      detailsButton!.click();

      await vi.waitFor(() => {
        expect(host.querySelector('.fm-preview-warning-details')?.textContent).toContain('postprocess: post-process exploded');
      });

      const copyButton = Array.from(host.querySelectorAll('button'))
        .find((button) => button.textContent?.includes('Copy error details'));
      expect(copyButton).toBeTruthy();
      copyButton!.click();

      await vi.waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('postprocess: post-process exploded');
      });
    } finally {
      dispose();
    }
  });

  it('recovers from a markdown post-processing warning on the next successful render', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const [content, setContent] = createSignal('# Broken\n\nDetails');
    postProcessMock.mockImplementationOnce(() => {
      throw new Error('post-process exploded');
    });

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={content()}
      />
    ), host);

    try {
      await vi.waitFor(() => {
        expect(previewWarning(host)?.textContent).toContain('Preview enhancements unavailable');
      });

      setContent('# Recovered\n\nDetails');

      await vi.waitFor(() => {
        expect(previewWarning(host)).toBeNull();
        expect(previewFatal(host)).toBeNull();
        expect(activeTocText(host)).toBe('Recovered');
      });
    } finally {
      dispose();
    }
  });

  it('keeps markdown readable when Mermaid infrastructure rejects unexpectedly', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runMermaidMock.mockRejectedValueOnce(new Error('mermaid worker unavailable'));

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'# Diagram Notes\n\n```mermaid\ngraph TD\nA-->B\n```'}
      />
    ), host);

    try {
      await vi.waitFor(() => {
        expect(previewWarning(host)?.textContent).toContain('Diagram enhancements unavailable');
      });
      expect(markdownBodyText(host)).toContain('Diagram Notes');
      expect(previewWarning(host)?.textContent).toContain('document is still readable');
      expect(previewFatal(host)).toBeNull();
      expect(activeTocText(host)).toBe('Diagram Notes');
    } finally {
      dispose();
    }
  });

  it('keeps markdown readable and hides Contents when TOC construction fails', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    buildTocMock.mockImplementationOnce(() => {
      throw new Error('toc exploded');
    });

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'# Start\n\n## Section\n\nDetails'}
      />
    ), host);

    try {
      await vi.waitFor(() => {
        expect(previewWarning(host)?.textContent).toContain('Contents unavailable');
      });
      expect(markdownBodyText(host)).toContain('Start');
      expect(markdownBodyText(host)).toContain('Details');
      expect(previewFatal(host)).toBeNull();
      expect(host.querySelector('.fm-toc-panel')).toBeNull();
      expect(activeTocText(host)).toBe('');
    } finally {
      dispose();
    }
  });

  it('renders fatal markdown failures as full-pane errors and recovers without stale issue state', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sanitize = vi.spyOn(DOMPurify, 'sanitize');
    const [content, setContent] = createSignal('# Broken\n\nDetails');
    sanitize.mockImplementationOnce(() => {
      throw new Error('sanitize exploded');
    });

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={content()}
      />
    ), host);

    try {
      await vi.waitFor(() => {
        expect(previewFatal(host)?.textContent).toContain('Failed to render preview');
      });
      expect(previewFatal(host)?.textContent).toContain('Copy error details');
      expect(markdownBodyText(host)).toBe('');
      expect(previewWarning(host)).toBeNull();
      expect(host.querySelector('.fm-toc-panel')).toBeNull();

      setContent('# Recovered\n\nDetails');

      await vi.waitFor(() => {
        expect(previewFatal(host)).toBeNull();
        expect(markdownBodyText(host)).toContain('Recovered');
        expect(activeTocText(host)).toBe('Recovered');
      });

      postProcessMock.mockImplementationOnce(() => {
        throw new Error('later warning');
      });
      setContent('# Warning Later\n\nDetails');

      await vi.waitFor(() => {
        expect(previewWarning(host)?.textContent).toContain('Preview enhancements unavailable');
      });
      expect(previewFatal(host)).toBeNull();
      expect(markdownBodyText(host)).toContain('Warning Later');
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
      const toolbar = panel?.querySelector<HTMLElement>('.fm-toolbar');
      const responsiveToolbar = host.querySelector<HTMLElement>('.fm-floating-toolbar-slot > .fm-toolbar-floating');
      const title = host.querySelector<HTMLElement>('.fm-toc-title');
      expect(wrapper).toBeTruthy();
      expect(panel).toBeTruthy();
      expect(toolbar).toBeTruthy();
      expect(responsiveToolbar).toBeTruthy();
      expect(title).toBeTruthy();
      expect(panel!.contains(toolbar!)).toBe(true);
      expect(panel!.contains(responsiveToolbar!)).toBe(false);
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
