// @vitest-environment jsdom
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImagePreviewPane } from './ImagePreviewPane';

vi.mock('../i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('ImagePreviewPane', () => {
  it('keeps sizing controls outside the viewport and waits for dimensions', () => {
    const host = document.createElement('div'); document.body.appendChild(host);
    const dispose = render(() => <ImagePreviewPane descriptor={{ mode: 'image' }} objectUrl="blob:image" />, host);
    try {
      const controls = host.querySelector('.image-preview-controls')!;
      expect(controls.parentElement).not.toBe(host.querySelector('.image-preview-viewport'));
      expect(controls.className).not.toContain('absolute');
      expect(host.textContent).toContain('--');
      expect((host.querySelector('button[aria-label="uiCopy.preview.zoomInImage"]') as HTMLButtonElement).disabled).toBe(true);
    } finally { dispose(); }
  });
});

it('refits after a container-only resize', async () => {
  const observers: Array<{ callback: ResizeObserverCallback }> = [];
  vi.stubGlobal('ResizeObserver', class {
    constructor(public callback: ResizeObserverCallback) { observers.push(this); }
    observe() {} disconnect() {}
  });
  const host = document.createElement('div'); document.body.appendChild(host);
  const dispose = render(() => <ImagePreviewPane descriptor={{ mode: 'image' }} objectUrl="blob:probe" />, host);
  try {
    const viewport = host.querySelector('.image-preview-viewport') as HTMLElement;
    let width = 624;
    Object.defineProperty(viewport, 'clientWidth', { configurable: true, get: () => width });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, get: () => 624 });
    const image = host.querySelector('img')!;
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1200 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 800 });
    image.dispatchEvent(new Event('load'));
    observers.forEach(observer => observer.callback([{ target: viewport } as unknown as ResizeObserverEntry], {} as ResizeObserver));
    expect(parseFloat(image.style.width)).toBeLessThanOrEqual(624);
    width = 324;
    observers.forEach(observer => observer.callback([{ target: viewport } as unknown as ResizeObserverEntry], {} as ResizeObserver));
    await Promise.resolve();
    expect(parseFloat(image.style.width)).toBeLessThanOrEqual(324);
  } finally { dispose(); vi.unstubAllGlobals(); }
});

it('ignores load and error callbacks from a replaced image', () => {
  const [source, setSource] = createSignal('blob:first');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <ImagePreviewPane descriptor={{ mode: 'image' }} objectUrl={source()} />, host);
  try {
    const previous = host.querySelector('img')!;
    Object.defineProperty(previous, 'naturalWidth', { value: 900 });
    Object.defineProperty(previous, 'naturalHeight', { value: 600 });
    setSource('blob:second');
    const current = host.querySelector('img')!;
    previous.dispatchEvent(new Event('load'));
    previous.dispatchEvent(new Event('error'));
    expect(current).not.toBe(previous);
    expect(host.querySelector('img')).toBe(current);
    expect(current.style.width).toBe('0px');
    expect(host.textContent).toContain('--');
  } finally { dispose(); }
});
