// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { FileMarkdown } from './FileMarkdown';

vi.mock('./mermaidPlugin', () => ({
  setupMermaid: vi.fn(),
  runMermaid: vi.fn().mockResolvedValue(undefined),
}));

interface MockIntersectionObserverRecord {
  readonly callback: IntersectionObserverCallback;
  readonly options?: IntersectionObserverInit;
}

const intersectionObservers: MockIntersectionObserverRecord[] = [];

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

describe('FileMarkdown', () => {
  beforeEach(() => {
    intersectionObservers.length = 0;
    vi.stubGlobal('CSS', {
      ...(globalThis.CSS ?? {}),
      escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
    });
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        intersectionObservers.push({ callback, options });
      }

      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      takeRecords = vi.fn(() => []);
    });
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

  it('observes active TOC headings against the markdown scroll container', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dispose = render(() => (
      <FileMarkdown
        filePath="/workspace/README.md"
        content={'# Start\n\n## Target Heading'}
      />
    ), host);

    try {
      await flushAsync();

      const container = host.querySelector<HTMLElement>('.file-markdown-body');
      expect(container).toBeTruthy();
      expect(intersectionObservers[0]?.options?.root).toBe(container);
    } finally {
      dispose();
    }
  });
});
