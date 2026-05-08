// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { FileMarkdown } from './FileMarkdown';

vi.mock('./mermaidPlugin', () => ({
  setupMermaid: vi.fn(),
  runMermaid: vi.fn().mockResolvedValue(undefined),
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
    vi.unstubAllGlobals();
    vi.clearAllMocks();
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
