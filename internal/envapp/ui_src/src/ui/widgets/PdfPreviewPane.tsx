import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';

import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
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
const PDF_PAGE_LABEL_HEIGHT = 16;
const PDF_PAGE_FRAME_GAP = 8;
const PDF_PAGE_BLOCK_GAP = 16;
const PDF_VISIBLE_OVERSCAN_MIN_PX = 800;
const PDF_INITIAL_VISIBLE_PAGE_COUNT = 2;
const PDF_MAX_CANVAS_PIXELS = 6_000_000;

type ZoomMode = 'fit-width' | 'manual';
type PageRenderStatus = 'idle' | 'rendering' | 'rendered';

type PDFPageMetric = Readonly<{
  pageNumber: number;
  width: number;
  height: number;
}>;

type PDFPageLayout = Readonly<{
  pageNumber: number;
  top: number;
  bottom: number;
  rowHeight: number;
  frameWidth: number;
  frameHeight: number;
}>;

type PDFPageRenderState = Readonly<{
  status: PageRenderStatus;
  scaleKey: string;
}>;

type ActivePageRenderTask = Readonly<{
  revision: number;
  scaleKey: string;
  task: RenderTask;
}>;

type DesiredPageRender = Readonly<{
  pageNumber: number;
  displayScale: number;
  renderScale: number;
  displayWidth: number;
  displayHeight: number;
  scaleKey: string;
}>;

function roundNumber(value: number): number {
  return Number(value.toFixed(2));
}

function clampScale(scale: number): number {
  return roundNumber(Math.min(PDF_MAX_SCALE, Math.max(PDF_MIN_SCALE, scale)));
}

function pageErrorMessage(error: unknown, pageNumber: number): string {
  const text = error instanceof Error ? error.message : String(error ?? '').trim();
  if (text) {
    return `Failed to render page ${pageNumber}: ${text}`;
  }
  return `Failed to render page ${pageNumber}.`;
}

function deletePageRenderState(
  current: Record<number, PDFPageRenderState>,
  pageNumber: number,
): Record<number, PDFPageRenderState> {
  if (!(pageNumber in current)) {
    return current;
  }
  const next = { ...current };
  delete next[pageNumber];
  return next;
}

function deletePageError(
  current: Record<number, string>,
  pageNumber: number,
): Record<number, string> {
  if (!(pageNumber in current)) {
    return current;
  }
  const next = { ...current };
  delete next[pageNumber];
  return next;
}

function PdfPreviewPage(props: {
  layout: PDFPageLayout;
  error?: string;
  status: PageRenderStatus;
  registerCanvas: (pageNumber: number, element: HTMLCanvasElement | null) => void;
}) {
  onCleanup(() => {
    props.registerCanvas(props.layout.pageNumber, null);
  });

  return (
    <div
      class="pdf-preview-pane__page absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{
        top: `${props.layout.top}px`,
        width: `${props.layout.frameWidth}px`,
      }}
    >
      <div class="h-4 text-[11px] leading-4 text-muted-foreground">Page {props.layout.pageNumber}</div>
      <div
        class="pdf-preview-pane__page-frame overflow-hidden rounded-xl border border-border/60 bg-white shadow-sm"
        style={{
          width: `${props.layout.frameWidth}px`,
          height: `${props.layout.frameHeight}px`,
        }}
      >
        <Show
          when={!props.error}
          fallback={(
            <div class="flex h-full items-center justify-center px-4 text-center text-xs text-error">
              {props.error}
            </div>
          )}
        >
          <div class="relative h-full w-full">
            <canvas
              ref={(element) => {
                props.registerCanvas(props.layout.pageNumber, element);
              }}
              class={`pdf-preview-pane__page-canvas block h-full w-full ${
                props.status === 'rendered' ? 'opacity-100' : 'opacity-0'
              }`}
            />
            <Show when={props.status !== 'rendered'}>
              <div class="absolute inset-0 flex h-full flex-col items-center justify-center gap-2 bg-muted/20 text-center">
                <div class="h-8 w-8 animate-pulse rounded-full bg-primary/10" />
                <div class="text-xs text-muted-foreground">
                  {props.status === 'rendering' ? 'Rendering page...' : 'Preparing page...'}
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </div>
  );
}

export interface PdfPreviewPaneProps {
  bytes?: Uint8Array<ArrayBuffer> | null;
}

export function PdfPreviewPane(props: PdfPreviewPaneProps) {
  const [renderError, setRenderError] = createSignal<string | null>(null);
  const [documentLoading, setDocumentLoading] = createSignal(false);
  const [viewportWidth, setViewportWidth] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [pageMetrics, setPageMetrics] = createSignal<PDFPageMetric[]>([]);
  const [pageErrors, setPageErrors] = createSignal<Record<number, string>>({});
  const [pageRenderStates, setPageRenderStates] = createSignal<Record<number, PDFPageRenderState>>({});
  const [zoomMode, setZoomMode] = createSignal<ZoomMode>('fit-width');
  const [manualScale, setManualScale] = createSignal(1);

  let viewportEl: HTMLDivElement | undefined;
  let activeDocument: PDFDocumentProxy | null = null;
  let activeLoadingTask: PDFDocumentLoadingTask | null = null;
  let activeDocumentRevision = 0;
  const activeRenderTasks = new Map<number, ActivePageRenderTask>();
  const pageCache = new Map<number, PDFPageProxy>();
  const canvasRefs = new Map<number, HTMLCanvasElement>();
  const renderedScaleKeys = new Map<number, string>();

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
    if (width <= 0) return 0;
    const availableWidth = Math.max(0, viewportWidth() - PDF_PREVIEW_INSET * 2);
    if (availableWidth <= 0) return 0;
    return roundNumber(Math.min(1, availableWidth / width));
  });

  const effectiveScale = createMemo(() => {
    if (!pageCount()) return 0;
    if (zoomMode() === 'fit-width') {
      return fitScale();
    }
    return manualScale();
  });

  const zoomPercent = createMemo(() => {
    if (!pageCount()) return '--';
    return `${Math.round(effectiveScale() * 100)}%`;
  });

  const canZoomIn = createMemo(() => pageCount() > 0 && effectiveScale() < PDF_MAX_SCALE);
  const canZoomOut = createMemo(() => pageCount() > 0 && effectiveScale() > PDF_MIN_SCALE);

  const pageLayouts = createMemo<PDFPageLayout[]>(() => {
    const scale = effectiveScale();
    if (scale <= 0) return [];

    let cursor = 0;
    return pageMetrics().map((page) => {
      const frameWidth = roundNumber(page.width * scale);
      const frameHeight = roundNumber(page.height * scale);
      const rowHeight = PDF_PAGE_LABEL_HEIGHT + PDF_PAGE_FRAME_GAP + frameHeight;
      const layout: PDFPageLayout = {
        pageNumber: page.pageNumber,
        top: cursor,
        bottom: cursor + rowHeight,
        rowHeight,
        frameWidth,
        frameHeight,
      };
      cursor = layout.bottom + PDF_PAGE_BLOCK_GAP;
      return layout;
    });
  });

  const contentHeight = createMemo(() => {
    const layouts = pageLayouts();
    if (!layouts.length) return 0;
    return layouts[layouts.length - 1]!.bottom;
  });

  const contentWidth = createMemo(() => {
    const scale = effectiveScale();
    if (scale <= 0) return 0;
    return roundNumber(maxPageWidth() * scale);
  });

  const visiblePageLayouts = createMemo(() => {
    const layouts = pageLayouts();
    if (!layouts.length) return [];

    const currentViewportHeight = viewportHeight();
    if (currentViewportHeight <= 0) {
      return layouts.slice(0, PDF_INITIAL_VISIBLE_PAGE_COUNT);
    }

    const overscan = Math.max(currentViewportHeight, PDF_VISIBLE_OVERSCAN_MIN_PX);
    const start = Math.max(0, scrollTop() - overscan);
    const end = scrollTop() + currentViewportHeight + overscan;
    return layouts.filter((layout) => layout.bottom >= start && layout.top <= end);
  });

  const visiblePageNumbers = createMemo(() => {
    return visiblePageLayouts().map((layout) => layout.pageNumber);
  });

  const visiblePageKey = createMemo(() => {
    const scale = effectiveScale();
    return `${roundNumber(scale)}|${visiblePageNumbers().join(',')}`;
  });

  const pageRenderStatus = (pageNumber: number): PageRenderStatus => {
    return pageRenderStates()[pageNumber]?.status ?? 'idle';
  };

  const pageError = (pageNumber: number) => pageErrors()[pageNumber] ?? '';

  const syncViewportMetrics = () => {
    setViewportWidth(viewportEl?.clientWidth ?? 0);
    setViewportHeight(viewportEl?.clientHeight ?? 0);
    setScrollTop(viewportEl?.scrollTop ?? 0);
  };

  const cancelRenderTask = (pageNumber: number) => {
    const activeTask = activeRenderTasks.get(pageNumber);
    if (!activeTask) return;
    try {
      activeTask.task.cancel();
    } catch {
    }
    activeRenderTasks.delete(pageNumber);
  };

  const releasePageResources = (pageNumber: number) => {
    cancelRenderTask(pageNumber);
    canvasRefs.delete(pageNumber);
    renderedScaleKeys.delete(pageNumber);
    const pageProxy = pageCache.get(pageNumber);
    if (pageProxy) {
      try {
        void pageProxy.cleanup();
      } catch {
      }
      pageCache.delete(pageNumber);
    }
    setPageRenderStates((current) => deletePageRenderState(current, pageNumber));
  };

  const clearDocumentState = () => {
    activeDocumentRevision += 1;
    for (const pageNumber of [...activeRenderTasks.keys()]) {
      cancelRenderTask(pageNumber);
    }
    for (const pageNumber of [...pageCache.keys()]) {
      releasePageResources(pageNumber);
    }
    canvasRefs.clear();
    renderedScaleKeys.clear();

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
    setPageMetrics([]);
    setPageErrors({});
    setPageRenderStates({});
  };

  const registerCanvas = (pageNumber: number, element: HTMLCanvasElement | null) => {
    if (element) {
      canvasRefs.set(pageNumber, element);
      return;
    }
    releasePageResources(pageNumber);
  };

  const resolveDesiredPageRender = (pageNumber: number): DesiredPageRender | null => {
    const page = pageMetrics().find((entry) => entry.pageNumber === pageNumber);
    if (!page) return null;

    const displayScale = effectiveScale();
    if (displayScale <= 0) return null;

    const devicePixelRatio = Math.max(globalThis.devicePixelRatio || 1, 1);
    const naturalRenderScale = displayScale * devicePixelRatio;
    const maxRenderScale = Math.sqrt(PDF_MAX_CANVAS_PIXELS / Math.max(1, page.width * page.height));
    const renderScale = roundNumber(Math.max(PDF_MIN_SCALE, Math.min(naturalRenderScale, maxRenderScale)));
    return {
      pageNumber,
      displayScale,
      renderScale,
      displayWidth: roundNumber(page.width * displayScale),
      displayHeight: roundNumber(page.height * displayScale),
      scaleKey: `${roundNumber(displayScale)}:${renderScale}`,
    };
  };

  const renderPage = (params: {
    pageNumber: number;
    desired: DesiredPageRender;
    document: PDFDocumentProxy;
    revision: number;
    canvas: HTMLCanvasElement;
  }) => {
    const { pageNumber, desired, document, revision, canvas } = params;

    setPageErrors((current) => deletePageError(current, pageNumber));
    setPageRenderStates((current) => ({
      ...current,
      [pageNumber]: {
        status: 'rendering',
        scaleKey: desired.scaleKey,
      },
    }));

    void (async () => {
      let task: RenderTask | null = null;
      try {
        const pageProxy = pageCache.get(pageNumber) ?? await document.getPage(pageNumber);
        if (revision !== activeDocumentRevision || activeDocument !== document || canvasRefs.get(pageNumber) !== canvas) {
          try {
            void pageProxy.cleanup();
          } catch {
          }
          return;
        }

        pageCache.set(pageNumber, pageProxy);

        const viewport = pageProxy.getViewport({ scale: desired.renderScale });
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        canvas.style.width = `${desired.displayWidth}px`;
        canvas.style.height = `${desired.displayHeight}px`;

        const context = canvas.getContext('2d', { alpha: false });
        if (!context) {
          throw new Error('Canvas rendering is unavailable.');
        }

        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, canvas.width, canvas.height);

        task = pageProxy.render({
          canvas,
          canvasContext: context,
          viewport,
        });
        activeRenderTasks.set(pageNumber, {
          revision,
          scaleKey: desired.scaleKey,
          task,
        });
        await task.promise;

        if (revision !== activeDocumentRevision || activeDocument !== document || canvasRefs.get(pageNumber) !== canvas) {
          return;
        }

        renderedScaleKeys.set(pageNumber, desired.scaleKey);
        setPageRenderStates((current) => ({
          ...current,
          [pageNumber]: {
            status: 'rendered',
            scaleKey: desired.scaleKey,
          },
        }));
      } catch (error) {
        if (isPDFRenderCancelled(error)) {
          return;
        }
        if (revision !== activeDocumentRevision || activeDocument !== document) {
          return;
        }
        setPageErrors((current) => ({
          ...current,
          [pageNumber]: pageErrorMessage(error, pageNumber),
        }));
        setPageRenderStates((current) => ({
          ...current,
          [pageNumber]: {
            status: 'idle',
            scaleKey: '',
          },
        }));
      } finally {
        const activeTask = activeRenderTasks.get(pageNumber);
        if (activeTask && activeTask.revision === revision && activeTask.task === task) {
          activeRenderTasks.delete(pageNumber);
        }
      }
    })();
  };

  onMount(() => {
    syncViewportMetrics();
    if (!viewportEl) return;

    const handleScroll = () => {
      setScrollTop(viewportEl?.scrollTop ?? 0);
    };
    viewportEl.addEventListener('scroll', handleScroll, { passive: true });
    onCleanup(() => {
      viewportEl?.removeEventListener('scroll', handleScroll);
    });

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncViewportMetrics);
      onCleanup(() => {
        window.removeEventListener('resize', syncViewportMetrics);
      });
      return;
    }

    const observer = new ResizeObserver(() => {
      syncViewportMetrics();
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

          const viewport = page.getViewport({ scale: 1 });
          nextPageMetrics.push({
            pageNumber,
            width: viewport.width,
            height: viewport.height,
          });

          try {
            void page.cleanup();
          } catch {
          }
        }

        setPageMetrics(nextPageMetrics);
        syncViewportMetrics();
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
    const revision = activeDocumentRevision;
    const visibleKey = visiblePageKey();
    void visibleKey;
    if (!document) return;

    const desiredEntries = new Map<number, DesiredPageRender>();
    for (const pageNumber of visiblePageNumbers()) {
      const desired = resolveDesiredPageRender(pageNumber);
      if (desired) {
        desiredEntries.set(pageNumber, desired);
      }
    }

    for (const [pageNumber, activeTask] of [...activeRenderTasks.entries()]) {
      const desired = desiredEntries.get(pageNumber);
      if (!desired || activeTask.revision !== revision || activeTask.scaleKey !== desired.scaleKey) {
        cancelRenderTask(pageNumber);
      }
    }

    for (const pageNumber of [...pageCache.keys()]) {
      if (!desiredEntries.has(pageNumber)) {
        releasePageResources(pageNumber);
      }
    }

    for (const desired of desiredEntries.values()) {
      const canvas = canvasRefs.get(desired.pageNumber);
      if (!canvas) continue;

      if (renderedScaleKeys.get(desired.pageNumber) === desired.scaleKey) {
        continue;
      }

      const activeTask = activeRenderTasks.get(desired.pageNumber);
      if (activeTask && activeTask.revision === revision && activeTask.scaleKey === desired.scaleKey) {
        continue;
      }

      renderPage({
        pageNumber: desired.pageNumber,
        desired,
        document,
        revision,
        canvas,
      });
    }
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

      <div
        ref={viewportEl}
        {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
        class="pdf-preview-pane relative flex-1 min-h-0 overflow-auto bg-muted/20 p-3"
      >
        <Show
          when={!renderError()}
          fallback={(
            <div class="rounded-lg border border-error/20 bg-error/5 p-4 text-sm text-error">
              <div class="font-medium">Failed to load PDF preview</div>
              <div class="mt-1 text-xs text-muted-foreground">{renderError()}</div>
            </div>
          )}
        >
          <div
            class="pdf-preview-pane__content relative mx-auto"
            style={{
              width: `${contentWidth()}px`,
              height: `${contentHeight()}px`,
            }}
          >
            <For each={visiblePageLayouts()}>
              {(layout) => (
                <PdfPreviewPage
                  layout={layout}
                  error={pageError(layout.pageNumber)}
                  status={pageRenderStatus(layout.pageNumber)}
                  registerCanvas={registerCanvas}
                />
              )}
            </For>
          </div>
        </Show>

        <RedevenLoadingCurtain visible={documentLoading()} eyebrow="Preview" message="Loading PDF..." />
      </div>
    </div>
  );
}
