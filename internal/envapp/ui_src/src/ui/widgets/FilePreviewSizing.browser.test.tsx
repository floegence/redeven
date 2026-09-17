import '../../index.css';
import { page, userEvent } from 'vitest/browser';
import { createSignal, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FloeConfigProvider, LayoutProvider, ThemeProvider } from '@floegence/floe-webapp-core';
import { createDefaultWorkbenchState, type WorkbenchState, type WorkbenchWidgetDefinition } from '@floegence/floe-webapp-core/workbench';
import { RedevenWorkbenchSurface } from '../workbench/surface/RedevenWorkbenchSurface';
import { I18nProvider } from '../i18n';
import { FilePreviewSurface } from './FilePreviewSurface';
import { removeUIStorageItem, writeUIStorageJSON } from '../services/uiStorage';
import { floatingWindowStorageKey } from './PersistentFloatingWindow';
import { PdfPreviewPane } from './PdfPreviewPane';
import { DocxPreviewPane } from './DocxPreviewPane';
import { ImagePreviewPane } from './ImagePreviewPane';
import { FilePreviewContext } from './FilePreviewContext';
import { createFilePreviewController } from './createFilePreviewController';
import { FilePreviewContent } from './FilePreviewContent';
import { createPreviewPDF, previewImageURL } from './filePreviewTestFixtures';
import docxURL from './__fixtures__/preview-pages.docx?url';

const disposers: Array<() => void> = [];
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); document.body.replaceChildren(); removeUIStorageItem(floatingWindowStorageKey('file-preview')); });

function mount(view: () => JSX.Element, width = 1000, height = 700, projection = 1) {
  const host = document.createElement('div');
  Object.assign(host.style, { width: `${width}px`, height: `${height}px`, transform: `scale(${projection})`, transformOrigin: 'top left' });
  document.body.appendChild(host); disposers.push(render(() => {
    const controller = createFilePreviewController({ client: () => undefined, rpc: () => undefined, canWrite: () => false });
    return <FloeConfigProvider config={{ storage: { enabled: false } }}><ThemeProvider><LayoutProvider><I18nProvider><FilePreviewContext.Provider value={{ controller, openPreview: controller.openPreview, closePreview: controller.closePreview }}>{view()}</FilePreviewContext.Provider></I18nProvider></LayoutProvider></ThemeProvider></FloeConfigProvider>;
  }, host));
  return host;
}
function assertContained(viewport: HTMLElement, content: HTMLElement) {
  const view = viewport.getBoundingClientRect(); const rect = content.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(view.left - 1);
  expect(rect.right).toBeLessThanOrEqual(view.right + 1);
  expect(rect.top).toBeGreaterThanOrEqual(view.top - 1);
  expect(rect.bottom).toBeLessThanOrEqual(view.bottom + 1);
}
async function renderedPDF(host: HTMLElement) {
  await vi.waitFor(() => {
    const canvas = host.querySelector<HTMLCanvasElement>('canvas');
    expect(canvas).toBeTruthy(); expect(canvas!.classList.contains('opacity-0')).toBe(false);
    expect(canvas!.getContext('2d')!.getImageData(canvas!.width / 2, canvas!.height / 2, 1, 1).data[2]).toBeGreaterThan(100);
  });
}

describe('File preview sizing with real renderers', () => {
  it.each([1, 0.65, 1.5])('fits PDF content and keeps the canvas stable under a %s projection', async projection => {
    await page.viewport(1600, 1100);
    const host = mount(() => <PdfPreviewPane bytes={createPreviewPDF([{ width: 600, height: 400 }])} />, 900, 620, projection);
    await renderedPDF(host);
    const viewport = host.querySelector<HTMLElement>('.pdf-preview-pane')!;
    const frame = () => host.querySelector<HTMLElement>('.pdf-preview-pane__page-frame')!;
    assertContained(viewport, frame());
    expect(parseFloat(frame().style.width)).toBeGreaterThan(600);
    const canvas = host.querySelector('canvas');
    // CSS serialization and integer bitmap allocation may differ by one pixel.
    expect(Math.abs(canvas!.width - Math.floor(parseFloat(frame().style.width) * Math.max(1, window.devicePixelRatio)))).toBeLessThanOrEqual(1);
    host.style.width = '380px'; host.style.height = '310px';
    await vi.waitFor(() => assertContained(viewport, frame()));
    await renderedPDF(host);
    expect(host.querySelector('canvas')).toBe(canvas);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
    const controls = host.querySelector<HTMLElement>('.pdf-preview-controls')!;
    expect(controls.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().top + 1);
    for (let index = 0; index < 12; index++) {
      (host.querySelector('button[aria-label="Zoom in PDF preview"]') as HTMLButtonElement).click();
      (host.querySelector('button[aria-label="Zoom out PDF preview"]') as HTMLButtonElement).click();
    }
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[aria-label="Fit to window"]')!);
    await renderedPDF(host); assertContained(viewport, frame());
    expect(host.textContent).not.toContain('Unable to render');
  });

  it('handles mixed pages, very small fit scales, file changes', async () => {
    const [bytes, setBytes] = createSignal(createPreviewPDF([{ width: 600, height: 400 }, { width: 400, height: 800 }]));
    const host = mount(() => <PdfPreviewPane bytes={bytes()} />, 430, 360);
    await renderedPDF(host);
    const viewport = host.querySelector<HTMLElement>('.pdf-preview-pane')!;
    const frames = [...host.querySelectorAll<HTMLElement>('.pdf-preview-pane__page-frame')];
    expect(frames.length).toBe(2);
    expect(parseFloat(frames[1]!.style.height)).toBeLessThanOrEqual(viewport.clientHeight - 48);
    setBytes(createPreviewPDF([{ width: 100000, height: 80000 }]));
    await renderedPDF(host);
    expect(host.querySelector('canvas')!.width * host.querySelector('canvas')!.height).toBeLessThanOrEqual(6_000_000);
    assertContained(viewport, host.querySelector<HTMLElement>('.pdf-preview-pane__page-frame')!);
    setBytes(createPreviewPDF([{ width: 600, height: 400 }]));
    await renderedPDF(host);
  });

  it('fits real DOCX pages individually and remeasures without transform feedback', async () => {
    const bytes = new Uint8Array(await (await fetch(docxURL)).arrayBuffer());
    const host = mount(() => <DocxPreviewPane bytes={bytes} />, 900, 600, 1.4);
    const viewport = host.querySelector<HTMLElement>('.docx-preview-pane')!;
    await vi.waitFor(() => expect(host.querySelector('.docx-preview-pane__content')?.getAttribute('style')).toContain('visible'));
    const pages = host.querySelectorAll<HTMLElement>('section.docx-preview-container');
    expect(pages).toHaveLength(2);
    assertContained(viewport, pages[0]!);
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    const before = host.querySelector<HTMLElement>('.docx-preview-pane__content')!.style.transform;
    host.style.transform = 'scale(0.6)';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(host.querySelector<HTMLElement>('.docx-preview-pane__content')!.style.transform).toBe(before);
    host.style.height = '300px';
    await vi.waitFor(() => assertContained(viewport, pages[0]!));
  });

  it('refits images on resize and keeps all edges reachable when zoomed', async () => {
    const host = mount(() => <ImagePreviewPane descriptor={{ mode: 'image' }} objectUrl={previewImageURL} />, 1000, 700);
    const viewport = host.querySelector<HTMLElement>('.image-preview-viewport')!;
    const image = host.querySelector<HTMLImageElement>('img')!;
    await vi.waitFor(() => expect(parseFloat(image.style.width)).toBeGreaterThan(600));
    assertContained(viewport, image);
    host.style.width = '380px'; host.style.height = '320px';
    await vi.waitFor(() => assertContained(viewport, image));
    await userEvent.click(host.querySelector<HTMLButtonElement>('button[aria-label="Actual size"]')!);
    viewport.scrollTop = 0; viewport.scrollLeft = 0;
    expect(image.getBoundingClientRect().left).toBeGreaterThanOrEqual(viewport.getBoundingClientRect().left);
    expect(image.getBoundingClientRect().top).toBeGreaterThanOrEqual(viewport.getBoundingClientRect().top);
    viewport.scrollTop = viewport.scrollHeight; viewport.scrollLeft = viewport.scrollWidth;
    expect(image.getBoundingClientRect().right).toBeLessThanOrEqual(viewport.getBoundingClientRect().right);
    expect(image.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().bottom);
  });

  it.each([10, 100000])('keeps manual zoom monotonic outside its bounds for a %spx image', async size => {
    const source = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"/>`)}`;
    const host = mount(() => <ImagePreviewPane descriptor={{ mode: 'image' }} objectUrl={source} />, 400, 320);
    const image = host.querySelector<HTMLImageElement>('img')!;
    await vi.waitFor(() => expect(parseFloat(image.style.width)).toBeGreaterThan(0));
    const before = parseFloat(image.style.width);
    const increase = host.querySelector<HTMLButtonElement>('button[aria-label="Zoom in image preview"]')!;
    const decrease = host.querySelector<HTMLButtonElement>('button[aria-label="Zoom out image preview"]')!;
    if (size === 10) {
      expect(increase.disabled).toBe(true);
      decrease.click();
      expect(parseFloat(image.style.width)).toBeLessThan(before);
    } else {
      expect(decrease.disabled).toBe(true);
      increase.click();
      expect(parseFloat(image.style.width)).toBeGreaterThan(before);
    }
    const manualWidth = image.style.width;
    host.style.width = '300px';
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(image.style.width).toBe(manualWidth);
  });

  it.each(['video', 'audio', 'xlsx', 'text', 'markdown'] as const)('keeps %s previews inside short containers', async mode => {
    const host = mount(() => <FilePreviewContent showHeader={false} descriptor={{ mode, textPresentation: 'plain', wrapText: true }}
      text={'Preview content\n'.repeat(100)} xlsxRows={Array.from({ length: 100 }, () => ['Cell', 'Value'])} />, 380, 180);
    await vi.waitFor(() => expect(host.textContent || host.querySelector('video,audio')).toBeTruthy());
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
    expect(host.scrollHeight).toBeLessThanOrEqual(host.clientHeight + 1);
    const media = host.querySelector<HTMLElement>('video,audio');
    if (media) assertContained(host, media);
  });
});


it('refits inside the real floating window after resizing, maximizing and restoring', async () => {
  await page.viewport(1400, 1000);
  writeUIStorageJSON(floatingWindowStorageKey('file-preview'), { x: 40, y: 40, width: 900, height: 640 });
  mount(() => <FilePreviewSurface open onOpenChange={() => {}} item={{ id: 'fixture', name: 'geometry.pdf', path: '/geometry.pdf', type: 'file' }} descriptor={{ mode: 'pdf' }} bytes={createPreviewPDF([{ width: 600, height: 400 }])} />);
  await vi.waitFor(() => expect(document.querySelector('.file-preview-floating-window')).toBeTruthy());
  const root = document.querySelector<HTMLElement>('.file-preview-floating-window')!;
  await renderedPDF(root);
  const viewport = root.querySelector<HTMLElement>('.pdf-preview-pane')!;
  const frame = root.querySelector<HTMLElement>('.pdf-preview-pane__page-frame')!;
  const verify = async () => { await renderedPDF(root); await vi.waitFor(() => assertContained(viewport, frame)); };
  const handle = [...root.querySelectorAll<HTMLElement>('div')].find(el => el.classList.contains('cursor-nwse-resize') && el.classList.contains('bottom-0') && el.classList.contains('right-0'))!;
  const bounds = handle.getBoundingClientRect();
  Object.defineProperty(root, 'setPointerCapture', { configurable: true, value: () => {} });
  Object.defineProperty(root, 'releasePointerCapture', { configurable: true, value: () => {} });
  const pointer = (type: string, delta: number) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 91, pointerType: 'mouse', button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: bounds.x + 2 + delta, clientY: bounds.y + 2 + delta / 2 });
  handle.dispatchEvent(pointer('pointerdown', 0)); root.dispatchEvent(pointer('pointermove', -300)); root.dispatchEvent(pointer('pointerup', -300));
  await vi.waitFor(() => expect(root.offsetWidth).toBeLessThan(900));
  await verify();
  const before = root.offsetWidth;
  await userEvent.click(root.querySelector<HTMLElement>('[data-floe-floating-window-control="maximize"]')!);
  await vi.waitFor(() => expect(root.offsetWidth).toBeGreaterThan(before));
  await verify();
  await userEvent.click(root.querySelector<HTMLElement>('[data-floe-floating-window-control="maximize"]')!);
  await vi.waitFor(() => expect(root.offsetWidth).toBe(before));
  await verify();
});

it('fits in the mobile dialog without toolbar overlap', async () => {
  await page.viewport(390, 844);
  mount(() => <FilePreviewSurface open onOpenChange={() => {}} item={{ id: 'fixture', name: 'geometry.pdf', path: '/geometry.pdf', type: 'file' }} descriptor={{ mode: 'pdf' }} bytes={createPreviewPDF([{ width: 600, height: 400 }])} />);
  await vi.waitFor(() => expect(document.querySelector('.pdf-preview-pane')).toBeTruthy());
  await renderedPDF(document.body);
  const viewport = document.querySelector<HTMLElement>('.pdf-preview-pane')!;
  assertContained(viewport, document.querySelector<HTMLElement>('.pdf-preview-pane__page-frame')!);
  expect(document.querySelector('.file-preview-floating-window')).toBeNull();
  const controls = document.querySelector<HTMLElement>('.pdf-preview-controls')!;
  expect(controls.scrollWidth).toBeLessThanOrEqual(controls.clientWidth + 1);
});

it('preserves local sizing and wheel ownership inside the real Workbench surface', async () => {
  await page.viewport(1400, 1000);
  const definitions: WorkbenchWidgetDefinition[] = [{ type: 'test.preview', label: 'Preview', defaultTitle: 'Preview', icon: () => null,
    defaultSize: { width: 600, height: 480 }, renderMode: 'projected_surface',
    body: props => <ImagePreviewPane descriptor={{ mode: 'image' }} objectUrl={previewImageURL} allowLocalWheel={props.selected === true} />,
  }];
  const [state, setState] = createSignal<WorkbenchState>({ ...createDefaultWorkbenchState(definitions),
    mode: 'work', viewport: { x: 0, y: 0, scale: 0.75 },
    widgets: [{ id: 'preview', type: 'test.preview', title: 'Preview', x: 120, y: 120, width: 600, height: 480, z_index: 1, created_at_unix_ms: 1 }],
    selectedWidgetId: 'preview', selectedObject: { kind: 'widget', id: 'preview' },
  });
  const host = mount(() => <RedevenWorkbenchSurface state={state} setState={setState} widgetDefinitions={definitions} />, 1400, 1000);
  const image = () => host.querySelector<HTMLImageElement>('.image-preview-viewport img')!;
  await vi.waitFor(() => expect(parseFloat(image()?.style.width)).toBeGreaterThan(0));
  const viewport = host.querySelector<HTMLElement>('.image-preview-viewport')!;
  const originalWidth = image().style.width;
  setState(current => ({ ...current, viewport: { ...current.viewport, scale: 1.3 } }));
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  expect(image().style.width).toBe(originalWidth);
  assertContained(viewport, image());
  const originalCanvasScale = state().viewport.scale;
  viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true }));
  expect(state().viewport.scale).toBe(originalCanvasScale);
  expect(image().style.width).not.toBe(originalWidth);
  setState(current => ({ ...current, selectedWidgetId: null, selectedObject: null }));
  const manualWidth = image().style.width;
  viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, ctrlKey: true }));
  expect(image().style.width).toBe(manualWidth);
});


it('keeps the same reading point when zooming a later PDF page', async () => {
  await page.viewport(1400, 1000);
  const host = mount(() => <PdfPreviewPane bytes={createPreviewPDF(Array.from({ length: 10 }, () => ({ width: 600, height: 400 })))} />, 900, 620);
  await renderedPDF(host);
  await userEvent.click(host.querySelector<HTMLButtonElement>('button[aria-label="Actual size"]')!);
  const viewport = host.querySelector<HTMLElement>('.pdf-preview-pane')!;
  viewport.scrollTop = 3 * 440 + 24 + 200 + 12 - viewport.clientHeight / 2;
  await vi.waitFor(() => expect(host.querySelector('[data-page-number="4"]')).toBeTruthy());
  const readingPoint = () => {
    const rect = host.querySelector<HTMLElement>('[data-page-number="4"] .pdf-preview-pane__page-frame')!.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    return (view.top + viewport.clientHeight / 2 - rect.top) / rect.height;
  };
  const before = readingPoint();
  await userEvent.click(host.querySelector<HTMLButtonElement>('button[aria-label="Zoom in PDF preview"]')!);
  await vi.waitFor(() => expect(readingPoint()).toBeCloseTo(before, 2));
});
