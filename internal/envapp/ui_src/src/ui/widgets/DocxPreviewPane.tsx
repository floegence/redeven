import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';

const DOCX_RENDER_CLASS_NAME = 'docx-preview-container';
const DOCX_PREVIEW_INSET = 12;
const DOCX_ZOOM_STEP = 0.1;
const DOCX_MIN_SCALE = 0.1;
const DOCX_MAX_SCALE = 3;

type ZoomMode = 'fit-width' | 'manual';

type DocxLayout = {
  width: number;
  height: number;
};

type DocxRenderAsync = typeof import('docx-preview').renderAsync;

function parsePixelValue(value?: string | null): number {
  if (!value) return 0;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readElementWidth(element: HTMLElement): number {
  const rectWidth = element.getBoundingClientRect().width;
  return Math.max(rectWidth, element.offsetWidth, element.scrollWidth, parsePixelValue(element.style.width));
}

function readElementHeight(element: HTMLElement): number {
  const rectHeight = element.getBoundingClientRect().height;
  return Math.max(
    rectHeight,
    element.offsetHeight,
    element.scrollHeight,
    parsePixelValue(element.style.height),
    parsePixelValue(element.style.minHeight),
  );
}

function findDocxWrapper(host: HTMLDivElement): HTMLDivElement | null {
  return host.querySelector<HTMLDivElement>(`.${DOCX_RENDER_CLASS_NAME}-wrapper`);
}

function measureDocxLayout(host: HTMLDivElement): DocxLayout | null {
  const wrapper = findDocxWrapper(host);
  if (!wrapper) return null;

  const width = readElementWidth(wrapper);
  const height = readElementHeight(wrapper);
  if (width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
}

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
      return;
    }

    setTimeout(resolve, 0);
  });
}

function clampScale(scale: number): number {
  return Number(Math.min(DOCX_MAX_SCALE, Math.max(DOCX_MIN_SCALE, scale)).toFixed(2));
}

export interface DocxPreviewPaneProps {
  bytes?: Uint8Array<ArrayBuffer> | null;
}

export function DocxPreviewPane(props: DocxPreviewPaneProps) {
  const [renderError, setRenderError] = createSignal<string | null>(null);
  const [viewportWidth, setViewportWidth] = createSignal(0);
  const [layout, setLayout] = createSignal<DocxLayout | null>(null);
  const [zoomMode, setZoomMode] = createSignal<ZoomMode>('fit-width');
  const [manualScale, setManualScale] = createSignal(1);
  let viewportEl: HTMLDivElement | undefined;
  let bodyHostEl: HTMLDivElement | undefined;
  let styleHostEl: HTMLDivElement | undefined;

  const clearRenderHosts = () => {
    if (bodyHostEl) {
      bodyHostEl.innerHTML = '';
    }
    if (styleHostEl) {
      styleHostEl.innerHTML = '';
    }
  };

  const syncViewportWidth = () => {
    setViewportWidth(viewportEl?.clientWidth ?? 0);
  };

  const syncDocxLayout = () => {
    const host = bodyHostEl;
    setLayout(host ? measureDocxLayout(host) : null);
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
    const bodyHost = bodyHostEl;
    const styleHost = styleHostEl;

    setRenderError(null);
    setLayout(null);
    setZoomMode('fit-width');
    setManualScale(1);
    clearRenderHosts();
    if (!bytes || !bodyHost || !styleHost) return;

    let disposed = false;
    let layoutObserver: ResizeObserver | null = null;

    void (async () => {
      try {
        const module = await import('docx-preview');
        if (disposed) return;

        const renderAsync = (module.renderAsync ?? null) as DocxRenderAsync | null;
        if (!renderAsync) {
          throw new Error('renderAsync not found');
        }

        await renderAsync(bytes, bodyHost, styleHost, {
          className: DOCX_RENDER_CLASS_NAME,
          inWrapper: true,
          breakPages: true,
          ignoreWidth: false,
          ignoreLastRenderedPageBreak: true,
          useBase64URL: false,
        });
        if (disposed) return;

        await waitForNextFrame();
        if (disposed) return;

        syncViewportWidth();
        syncDocxLayout();

        const wrapper = findDocxWrapper(bodyHost);
        if (wrapper && typeof ResizeObserver !== 'undefined') {
          layoutObserver = new ResizeObserver(() => {
            syncDocxLayout();
          });
          layoutObserver.observe(wrapper);
        }
      } catch (error) {
        if (disposed) return;
        setRenderError(error instanceof Error ? error.message : String(error));
      }
    })();

    onCleanup(() => {
      disposed = true;
      layoutObserver?.disconnect();
      clearRenderHosts();
    });
  });

  const fitScale = createMemo(() => {
    const currentLayout = layout();
    if (!currentLayout) return 1;
    const availableWidth = Math.max(0, viewportWidth() - DOCX_PREVIEW_INSET * 2);
    if (availableWidth <= 0) return 1;
    return Math.min(1, availableWidth / currentLayout.width);
  });

  const effectiveScale = createMemo(() => {
    return zoomMode() === 'fit-width' ? fitScale() : manualScale();
  });

  const zoomPercent = createMemo(() => {
    const currentLayout = layout();
    if (!currentLayout) return '--';
    return `${Math.round(effectiveScale() * 100)}%`;
  });

  const frameStyle = createMemo<Record<string, string> | undefined>(() => {
    const currentLayout = layout();
    if (!currentLayout) return undefined;

    return {
      width: `${currentLayout.width * effectiveScale()}px`,
      height: `${currentLayout.height * effectiveScale()}px`,
    };
  });

  const contentStyle = createMemo<Record<string, string> | undefined>(() => {
    const currentLayout = layout();
    if (!currentLayout) return undefined;

    return {
      width: `${currentLayout.width}px`,
      height: `${currentLayout.height}px`,
      transform: `scale(${effectiveScale()})`,
      'transform-origin': 'top left',
    };
  });

  const canZoomIn = createMemo(() => {
    return !!layout() && effectiveScale() < DOCX_MAX_SCALE;
  });

  const canZoomOut = createMemo(() => {
    return !!layout() && effectiveScale() > DOCX_MIN_SCALE;
  });

  const applyManualZoom = (delta: number) => {
    const baseScale = effectiveScale();
    const nextScale = clampScale(baseScale + delta);
    setZoomMode('manual');
    setManualScale(nextScale);
  };

  const handleZoomIn = () => {
    applyManualZoom(DOCX_ZOOM_STEP);
  };

  const handleZoomOut = () => {
    applyManualZoom(-DOCX_ZOOM_STEP);
  };

  const handleFitWidth = () => {
    setZoomMode('fit-width');
  };

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div ref={styleHostEl} class="hidden" aria-hidden="true" />

      <Show
        when={!renderError()}
        fallback={
          <div class="p-4 text-sm text-error">
            <div class="mb-1 font-medium">Failed to load file</div>
            <div class="text-xs text-muted-foreground">{renderError()}</div>
          </div>
        }
      >
        <>
          <div class="shrink-0 border-b border-border px-3 py-2">
            <div class="flex items-center justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                class="h-7 min-w-7 px-0 font-mono"
                disabled={!canZoomOut()}
                aria-label="Zoom out docx preview"
                onClick={handleZoomOut}
              >
                -
              </Button>

              <div class="min-w-14 text-center font-mono text-[11px] text-muted-foreground">
                {zoomPercent()}
              </div>

              <Button
                size="sm"
                variant="outline"
                class="h-7 min-w-7 px-0 font-mono"
                disabled={!canZoomIn()}
                aria-label="Zoom in docx preview"
                onClick={handleZoomIn}
              >
                +
              </Button>

              <Button
                size="sm"
                variant="outline"
                class="h-7 px-2 text-[11px]"
                disabled={!layout() || zoomMode() === 'fit-width'}
                aria-label="Fit docx preview to width"
                onClick={handleFitWidth}
              >
                Fit
              </Button>
            </div>
          </div>

          <div ref={viewportEl} class="docx-preview-pane relative flex-1 min-h-0 overflow-auto bg-muted/30">
            <div class="box-border min-h-full min-w-full p-3">
              <div class="docx-preview-pane__frame relative mx-auto" style={frameStyle()}>
                <div class="docx-preview-pane__content absolute top-0 left-0" style={contentStyle()}>
                  <div ref={bodyHostEl} class="docx-preview-pane__document" />
                </div>
              </div>
            </div>
          </div>
        </>
      </Show>
    </div>
  );
}
