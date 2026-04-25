import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button } from '@floegence/floe-webapp-core/ui';

import {
  isPDFRenderCancelled,
  loadPDFDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type RenderTask,
} from './pdfPreviewRuntime';

const PDF_PREVIEW_INSET = 12;
const PDF_ZOOM_STEP = 0.1;
const PDF_MIN_SCALE = 0.25;
const PDF_MAX_SCALE = 3;

type ZoomMode = 'fit-width' | 'manual';

type PDFPageMetric = Readonly<{
  pageNumber: number;
  width: number;
  height: number;
}>;

function roundScale(scale: number): number {
  return Number(scale.toFixed(2));
}

function clampScale(scale: number): number {
  return roundScale(Math.min(PDF_MAX_SCALE, Math.max(PDF_MIN_SCALE, scale)));
}

function pageErrorMessage(error: unknown, pageNumber: number): string {
  const text = error instanceof Error ? error.message : String(error ?? '').trim();
  if (text) {
    return `Failed to render page ${pageNumber}: ${text}`;
  }
  return `Failed to render page ${pageNumber}.`;
}

export interface PdfPreviewPaneProps {
  bytes?: Uint8Array<ArrayBuffer> | null;
}

export function PdfPreviewPane(props: PdfPreviewPaneProps) {
  const [renderError, setRenderError] = createSignal<string | null>(null);
  const [documentLoading, setDocumentLoading] = createSignal(false);
  const [pageRendering, setPageRendering] = createSignal(false);
  const [viewportWidth, setViewportWidth] = createSignal(0);
  const [pageMetrics, setPageMetrics] = createSignal<PDFPageMetric[]>([]);
  const [pageErrors, setPageErrors] = createSignal<Record<number, string>>({});
  const [zoomMode, setZoomMode] = createSignal<ZoomMode>('fit-width');
  const [manualScale, setManualScale] = createSignal(1);

  let viewportEl: HTMLDivElement | undefined;
  let activeDocument: PDFDocumentProxy | null = null;
  let activeLoadingTask: PDFDocumentLoadingTask | null = null;
  let renderSequence = 0;
  const activeRenderTasks = new Map<number, RenderTask>();
  const pageCache = new Map<number, PDFPageProxy>();
  const canvasRefs = new Map<number, HTMLCanvasElement>();

  const pageCount = createMemo(() => pageMetrics().length);
  const pageCountLabel = createMemo(() => {
    const count = pageCount();
    if (count <= 0) return 'No pages';
    return count === 1 ? '1 page' : `${count} pages`;
  });

  const maxPageWidth = createMemo(() => {
    return pageMetrics().reduce((maxWidth, page) => Math.max(maxWidth, page.width), 0);
  });

  const fitScale = createMemo(() => {
    const width = maxPageWidth();
    if (width <= 0) return 1;
    const availableWidth = Math.max(0, viewportWidth() - PDF_PREVIEW_INSET * 2);
    if (availableWidth <= 0) return 1;
    return roundScale(Math.min(1, availableWidth / width));
  });

  const effectiveScale = createMemo(() => {
    return zoomMode() === 'fit-width' ? fitScale() : manualScale();
  });

  const zoomPercent = createMemo(() => {
    if (!pageCount()) return '--';
    return `${Math.round(effectiveScale() * 100)}%`;
  });

  const canZoomIn = createMemo(() => pageCount() > 0 && effectiveScale() < PDF_MAX_SCALE);
  const canZoomOut = createMemo(() => pageCount() > 0 && effectiveScale() > PDF_MIN_SCALE);

  const syncViewportWidth = () => {
    setViewportWidth(viewportEl?.clientWidth ?? 0);
  };

  const cancelActiveRenderTasks = () => {
    for (const task of activeRenderTasks.values()) {
      try {
        task.cancel();
      } catch {
      }
    }
    activeRenderTasks.clear();
  };

  const clearDocumentState = () => {
    renderSequence += 1;
    cancelActiveRenderTasks();
    canvasRefs.clear();
    pageCache.clear();

    const loadingTask = activeLoadingTask;
    activeLoadingTask = null;
    if (loadingTask) {
      try {
        loadingTask.destroy();
      } catch {
      }
    }

    const document = activeDocument;
    activeDocument = null;
    if (document) {
      try {
        void document.destroy();
      } catch {
      }
    }

    setDocumentLoading(false);
    setPageRendering(false);
    setPageMetrics([]);
    setPageErrors({});
  };

  onMount(() => {
    syncViewportWidth();
    if (!viewportEl) return;

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncViewportWidth);
      onCleanup(() => {
        window.removeEventListener('resize', syncViewportWidth);
      });
      return;
    }

    const observer = new ResizeObserver(() => {
      syncViewportWidth();
    });
    observer.observe(viewportEl);
    onCleanup(() => {
      observer.disconnect();
    });
  });

  createEffect(() => {
    const bytes = props.bytes;

    setRenderError(null);
    setZoomMode('fit-width');
    setManualScale(1);
    clearDocumentState();
    if (!bytes) return;

    let disposed = false;
    setDocumentLoading(true);

    void (async () => {
      try {
        const loadingTask = loadPDFDocument(bytes);
        activeLoadingTask = loadingTask;
        const document = await loadingTask.promise;
        if (disposed || activeLoadingTask !== loadingTask) {
          try {
            void document.destroy();
          } catch {
          }
          return;
        }

        activeDocument = document;
        const nextPageMetrics: PDFPageMetric[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          if (disposed || activeDocument !== document) {
            return;
          }
          pageCache.set(pageNumber, page);
          const viewport = page.getViewport({ scale: 1 });
          nextPageMetrics.push({
            pageNumber,
            width: viewport.width,
            height: viewport.height,
          });
        }

        setPageMetrics(nextPageMetrics);
        syncViewportWidth();
      } catch (error) {
        if (disposed || isPDFRenderCancelled(error)) return;
        setRenderError(error instanceof Error ? error.message : 'Failed to load PDF preview.');
      } finally {
        if (!disposed) {
          setDocumentLoading(false);
        }
      }
    })();

    onCleanup(() => {
      disposed = true;
      clearDocumentState();
    });
  });

  createEffect(() => {
    const document = activeDocument;
    const pages = pageMetrics();
    const scale = effectiveScale();
    if (!document || pages.length === 0) return;

    const sequence = ++renderSequence;
    cancelActiveRenderTasks();
    setPageRendering(true);
    setPageErrors({});

    void (async () => {
      await Promise.resolve();
      for (const page of pages) {
        if (sequence !== renderSequence || activeDocument !== document) {
          return;
        }

        const canvas = canvasRefs.get(page.pageNumber);
        if (!canvas) {
          continue;
        }

        try {
          const pageProxy = pageCache.get(page.pageNumber) ?? await document.getPage(page.pageNumber);
          if (sequence !== renderSequence || activeDocument !== document) {
            return;
          }

          pageCache.set(page.pageNumber, pageProxy);

          const viewport = pageProxy.getViewport({ scale });
          const pixelRatio = Math.max(globalThis.devicePixelRatio || 1, 1);
          canvas.width = Math.max(1, Math.ceil(viewport.width * pixelRatio));
          canvas.height = Math.max(1, Math.ceil(viewport.height * pixelRatio));
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;

          const context = canvas.getContext('2d', { alpha: false });
          if (!context) {
            throw new Error('Canvas rendering is unavailable.');
          }

          context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
          context.clearRect(0, 0, viewport.width, viewport.height);

          const task = pageProxy.render({
            canvas,
            canvasContext: context,
            viewport,
          });
          activeRenderTasks.set(page.pageNumber, task);

          try {
            await task.promise;
          } finally {
            if (activeRenderTasks.get(page.pageNumber) === task) {
              activeRenderTasks.delete(page.pageNumber);
            }
          }
        } catch (error) {
          if (isPDFRenderCancelled(error) || sequence !== renderSequence || activeDocument !== document) {
            return;
          }
          setPageErrors((current) => ({
            ...current,
            [page.pageNumber]: pageErrorMessage(error, page.pageNumber),
          }));
        }
      }
    })()
      .catch((error) => {
        if (isPDFRenderCancelled(error) || sequence !== renderSequence || activeDocument !== document) {
          return;
        }
        setRenderError(error instanceof Error ? error.message : 'Failed to render PDF preview.');
      })
      .finally(() => {
        if (sequence === renderSequence) {
          setPageRendering(false);
        }
      });
  });

  onCleanup(() => {
    clearDocumentState();
  });

  const applyManualZoom = (delta: number) => {
    const baseScale = effectiveScale();
    setZoomMode('manual');
    setManualScale(clampScale(baseScale + delta));
  };

  const handleZoomIn = () => {
    applyManualZoom(PDF_ZOOM_STEP);
  };

  const handleZoomOut = () => {
    applyManualZoom(-PDF_ZOOM_STEP);
  };

  const handleFitWidth = () => {
    setZoomMode('fit-width');
  };

  const pageFrameStyle = (page: PDFPageMetric): Record<string, string> => ({
    width: `${page.width * effectiveScale()}px`,
    height: `${page.height * effectiveScale()}px`,
  });

  const pageError = (pageNumber: number) => pageErrors()[pageNumber] ?? '';

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="rounded-full border border-border/70 bg-muted/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            PDF
          </span>
          <span class="text-xs text-muted-foreground">{pageCountLabel()}</span>
        </div>

        <div class="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            class="min-w-9"
            disabled={!canZoomOut()}
            aria-label="Zoom out PDF preview"
            onClick={handleZoomOut}
          >
            -
          </Button>
          <div class="min-w-[3.5rem] text-center text-xs text-muted-foreground">{zoomPercent()}</div>
          <Button
            size="sm"
            variant="outline"
            class="min-w-9"
            disabled={!canZoomIn()}
            aria-label="Zoom in PDF preview"
            onClick={handleZoomIn}
          >
            +
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!pageCount()}
            aria-label="Fit PDF preview to width"
            onClick={handleFitWidth}
          >
            Fit
          </Button>
        </div>
      </div>

      <div ref={viewportEl} class="pdf-preview-pane relative flex-1 min-h-0 overflow-auto bg-muted/20 p-3">
        <Show
          when={!renderError()}
          fallback={(
            <div class="rounded-lg border border-error/20 bg-error/5 p-4 text-sm text-error">
              <div class="font-medium">Failed to load PDF preview</div>
              <div class="mt-1 text-xs text-muted-foreground">{renderError()}</div>
            </div>
          )}
        >
          <div class="mx-auto flex w-full flex-col items-center gap-4">
            <For each={pageMetrics()}>
              {(page) => (
                <div class="flex flex-col items-center gap-2">
                  <div class="text-[11px] text-muted-foreground">Page {page.pageNumber}</div>
                  <div
                    class="pdf-preview-pane__page-frame overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm"
                    style={pageFrameStyle(page)}
                  >
                    <Show
                      when={!pageError(page.pageNumber)}
                      fallback={(
                        <div class="flex h-full items-center justify-center px-4 text-center text-xs text-error">
                          {pageError(page.pageNumber)}
                        </div>
                      )}
                    >
                      <canvas
                        ref={(element) => {
                          canvasRefs.set(page.pageNumber, element);
                        }}
                        class="pdf-preview-pane__page-canvas block"
                      />
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        <LoadingOverlay visible={documentLoading() || pageRendering()} message={documentLoading() ? 'Loading PDF...' : 'Rendering PDF...'} />
      </div>
    </div>
  );
}
