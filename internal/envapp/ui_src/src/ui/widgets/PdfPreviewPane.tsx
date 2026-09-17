import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
import { isPDFRenderCancelled, loadPDFDocument, type PDFDocumentProxy, type PDFPageProxy, type RenderTask } from './pdfPreviewRuntime';
import { FilePreviewErrorState } from './FilePreviewErrorState';
import { FilePreviewZoomControls } from './FilePreviewZoomControls';
import { createPreviewZoom } from './createPreviewZoom';
import { useI18n } from '../i18n';
import type { FilePreviewSurface } from '../utils/filePreview';

const PAGE_LABEL_SPACE = 24;
const PAGE_GAP = 16;
const MAX_CANVAS_PIXELS = 6_000_000;
const MAX_CANVAS_DIMENSION = 16_384;
type PageMetric = { pageNumber: number; width: number; height: number };
type PageLayout = PageMetric & { top: number; width: number; height: number };
type LoadedDocument = { document: PDFDocumentProxy; pages: PageMetric[] };

function PdfPreviewPage(props: { document: PDFDocumentProxy; layout: PageLayout; scale: number; pixelRatio: number }) {
  const i18n = useI18n();
  const [status, setStatus] = createSignal<'idle' | 'rendering' | 'rendered'>('idle');
  const [error, setError] = createSignal('');
  const [retry, setRetry] = createSignal(0);
  let canvas!: HTMLCanvasElement;
  let disposed = false;
  let revision = 0;
  let pending: { revision: number; scale: number; pixelRatio: number } | null = null;
  let worker: Promise<void> | null = null;
  let task: RenderTask | null = null;
  let page: PDFPageProxy | null = null;

  // One owner spans page acquisition, render cancellation and promise settlement.
  // The next desired scale replaces pending work instead of starting a second worker.
  const drain = async () => {
    while (!disposed && pending) {
      const request = pending;
      pending = null;
      const current = () => !disposed && revision === request.revision;
      setStatus('rendering');
      setError('');
      try {
        page ??= await props.document.getPage(props.layout.pageNumber);
        if (!current()) continue;
        const natural = page.getViewport({ scale: 1 });
        const renderScale = Math.min(request.scale * request.pixelRatio,
          Math.sqrt(MAX_CANVAS_PIXELS / (natural.width * natural.height)),
          MAX_CANVAS_DIMENSION / natural.width, MAX_CANVAS_DIMENSION / natural.height);
        const viewport = page.getViewport({ scale: renderScale });
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) throw new Error('Canvas rendering is unavailable.');
        task = page.render({ canvas, canvasContext: context, viewport });
        await task.promise;
        if (current()) setStatus('rendered');
      } catch (reason) {
        if (current() && !isPDFRenderCancelled(reason)) {
          setError(reason instanceof Error ? reason.message : String(reason));
          setStatus('idle');
        }
      } finally {
        task = null;
      }
    }
  };
  const startWorker = () => {
    if (worker) return;
    worker = Promise.resolve().then(drain).finally(() => {
      worker = null;
      if (disposed) page?.cleanup();
      else if (pending) startWorker();
    });
  };
  createEffect(on(() => [props.scale, props.pixelRatio, retry()] as const, ([scale, pixelRatio]) => {
    pending = { revision: ++revision, scale, pixelRatio };
    task?.cancel();
    startWorker();
  }));
  onCleanup(() => {
    disposed = true;
    revision++;
    pending = null;
    task?.cancel();
    if (!worker) page?.cleanup();
  });
  return (
    <div data-page-number={props.layout.pageNumber} class="pdf-preview-pane__page absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ top: `${props.layout.top}px`, width: `${props.layout.width}px` }}>
      <div class="h-4 text-[11px] leading-4 text-muted-foreground">{i18n.t('uiCopy.preview.pageLabel', { number: props.layout.pageNumber })}</div>
      <div class="pdf-preview-pane__page-frame relative overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-border/60"
        style={{ width: `${props.layout.width}px`, height: `${props.layout.height}px` }}>
        <canvas ref={canvas} class={cn('pdf-preview-pane__page-canvas block h-full w-full', status() !== 'rendered' && 'opacity-0')}
          style={{ width: `${props.layout.width}px`, height: `${props.layout.height}px` }} />
        <Show when={error()} fallback={(
          <Show when={status() !== 'rendered'}>
            <div class="absolute inset-0 flex items-center justify-center bg-muted/20 p-2 text-xs text-muted-foreground">{i18n.t('uiCopy.preview.renderingPage')}</div>
          </Show>
        )}>
          <div class="absolute inset-0 overflow-auto p-3 text-center text-xs">
            <p class="text-error">{i18n.t('uiCopy.preview.pageRenderFailed', { number: props.layout.pageNumber })}</p>
            <Button size="sm" variant="outline" class="mt-2" onClick={() => setRetry(value => value + 1)}>{i18n.t('chatChrome.retry')}</Button>
            <details class="mt-2 text-muted-foreground"><summary class="cursor-pointer">{i18n.t('filePreview.technicalDetails')}</summary><pre class="whitespace-pre-wrap break-all text-left">{error()}</pre></details>
          </div>
        </Show>
      </div>
    </div>
  );
}

export interface PdfPreviewPaneProps { surface?: FilePreviewSurface; bytes?: Uint8Array<ArrayBuffer> | null }

export function PdfPreviewPane(props: PdfPreviewPaneProps) {
  const i18n = useI18n();
  const [loaded, setLoaded] = createSignal<LoadedDocument | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [scrollTop, setScrollTop] = createSignal(0);
  const [pixelRatio, setPixelRatio] = createSignal(Math.max(1, globalThis.devicePixelRatio || 1));
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const dimensions = createMemo(() => {
    const pages = loaded()?.pages;
    return pages?.length ? {
      width: Math.max(...pages.map(page => page.width)), height: Math.max(...pages.map(page => page.height)),
    } : null;
  });
  const zoom = createPreviewZoom({ viewport, content: dimensions, step: 0.1, min: 0.25, max: 3, labelHeight: PAGE_LABEL_SPACE, pageLayouts: () => layouts() });
  const layouts = createMemo<PageLayout[]>(() => {
    const scale = zoom.scale();
    if (scale === null) return [];
    let top = 0;
    return (loaded()?.pages ?? []).map(page => {
      const layout = { ...page, top, width: page.width * scale, height: page.height * scale };
      top += layout.height + PAGE_LABEL_SPACE + PAGE_GAP;
      return layout;
    });
  });
  const contentHeight = () => { const last = layouts().at(-1); return last ? last.top + last.height + PAGE_LABEL_SPACE : 0; };
  const contentWidth = () => (dimensions()?.width ?? 0) * (zoom.scale() ?? 0);
  const visiblePages = createMemo(() => {
    const height = zoom.viewportSize()?.height ?? 0;
    const overscan = Math.max(height, 800);
    return layouts().filter(page => page.top + page.height + PAGE_LABEL_SPACE >= scrollTop() - overscan
      && page.top <= scrollTop() + height + overscan).map(page => page.pageNumber);
  });
  createEffect(on(() => props.bytes, (bytes) => {
    setLoaded(null); setError(''); setLoading(!!bytes); zoom.reset();
    setScrollTop(0);
    const el = untrack(viewport);
    if (el) { el.scrollTop = 0; el.scrollLeft = 0; }
    if (!bytes) return;
    let disposed = false;
    // PDF.js transfers its input buffer to the worker; the controller owns bytes.
    const loadingTask = loadPDFDocument(bytes.slice());
    void (async () => {
      try {
        const document = await loadingTask.promise;
        if (disposed) return;
        const pages: PageMetric[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
          const page = await document.getPage(pageNumber);
          if (disposed) return;
          const natural = page.getViewport({ scale: 1 });
          pages.push({ pageNumber, width: natural.width, height: natural.height });
          page.cleanup();
        }
        if (!disposed) setLoaded({ document, pages });
      } catch (reason) {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      } finally { if (!disposed) setLoading(false); }
    })();
    onCleanup(() => {
      disposed = true;
      void Promise.resolve(loadingTask.destroy()).catch(() => {});
    });
  }));
  createEffect(() => {
    const resolution = window.matchMedia?.(`(resolution: ${pixelRatio()}dppx)`);
    const updatePixelRatio = () => setPixelRatio(Math.max(1, globalThis.devicePixelRatio || 1));
    resolution?.addEventListener('change', updatePixelRatio);
    window.addEventListener('resize', updatePixelRatio);
    onCleanup(() => {
      resolution?.removeEventListener('change', updatePixelRatio);
      window.removeEventListener('resize', updatePixelRatio);
    });
  });
  return (
    <div class={cn('flex h-full min-h-0 min-w-0 flex-col overflow-hidden', props.surface === 'window' ? 'redeven-file-preview-surface-window' : redevenSurfaceRoleClass('main'))}>
      <div class="pdf-preview-controls flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
        <span class="text-xs text-muted-foreground"><span>PDF</span> · {loaded()?.pages.length ? i18n.tn('uiCopy.preview.pageCount', loaded()!.pages.length) : i18n.t('uiCopy.preview.noPages')}</span>
        <FilePreviewZoomControls zoom={zoom} kind="Pdf" />
      </div>
      <div ref={setViewport} {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
        onScroll={event => setScrollTop(event.currentTarget.scrollTop)}
        class="pdf-preview-pane relative min-h-0 min-w-0 flex-1 overflow-auto p-3 [overflow-anchor:none]">
        <Show when={!error()} fallback={<FilePreviewErrorState errorType="render_error" message={error()} />}>
          <div class="relative grid place-items-center" style={{ width: `${Math.max(contentWidth(), zoom.viewportSize()?.width ?? 0)}px`, height: `${Math.max(contentHeight(), zoom.viewportSize()?.height ?? 0)}px` }}>
            <div data-preview-zoom-content class="pdf-preview-pane__content relative" style={{ width: `${contentWidth()}px`, height: `${contentHeight()}px` }}>
              <Show when={loaded()} keyed>{document => (
                <For each={visiblePages()}>{pageNumber => (
                  <PdfPreviewPage document={document.document} layout={layouts()[pageNumber - 1]!} scale={zoom.scale()!} pixelRatio={pixelRatio()} />
                )}</For>
              )}</Show>
            </div>
          </div>
        </Show>
        <RedevenLoadingCurtain visible={loading()} eyebrow={i18n.t('uiCopy.preview.eyebrow')} message={i18n.t('uiCopy.preview.loadingPdf')} />
      </div>
    </div>
  );
}
