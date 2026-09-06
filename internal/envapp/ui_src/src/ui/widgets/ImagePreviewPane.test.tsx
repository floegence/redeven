// @vitest-environment jsdom
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
  it('starts in fit mode and exposes zoom and sizing controls', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <ImagePreviewPane descriptor={{ mode: 'image' }} objectUrl="blob:image" />, host);

    expect(host.querySelector('button[aria-label="uiCopy.preview.zoomOutImage"]')).toBeTruthy();
    expect(host.querySelector('button[aria-label="uiCopy.preview.zoomInImage"]')).toBeTruthy();
    expect(host.querySelector('[aria-label="uiCopy.preview.imageViewport"]')).toBeTruthy();
    const controls = host.querySelector('.image-preview-controls');
    expect(controls?.className).toContain('absolute');
    expect(controls?.parentElement).not.toBe(host.querySelector('.image-preview-viewport'));
    expect(host.textContent).toContain('100%');
  });

  it('updates the image size when zooming and keeps the viewport scrollable', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    render(() => <ImagePreviewPane descriptor={{ mode: 'image' }} objectUrl="blob:image" />, host);
    const image = host.querySelector('img') as HTMLImageElement;
    Object.defineProperty(image, 'naturalWidth', { configurable: true, value: 1200 });
    Object.defineProperty(image, 'naturalHeight', { configurable: true, value: 800 });
    image.dispatchEvent(new Event('load'));

    const zoomIn = host.querySelector('button[aria-label="uiCopy.preview.zoomInImage"]') as HTMLButtonElement;
    zoomIn.click();
    expect(host.textContent).toContain('125%');
    expect(image.style.width).toBe('1500px');
    expect(image.style.height).toBe('1000px');
  });
});
