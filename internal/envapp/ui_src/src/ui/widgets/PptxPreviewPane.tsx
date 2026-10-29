import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import { PptxDocumentSurface } from '@floegence/floe-webapp-core/pptx';
import { useI18n } from '../i18n';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
import { FilePreviewErrorState } from './FilePreviewErrorState';
import { FilePreviewZoomControls } from './FilePreviewZoomControls';
import { createPreviewZoom } from './createPreviewZoom';
import type { FilePreviewSurface } from '../utils/filePreview';

const PAGE_LABEL_SPACE = 24;
const PAGE_GAP = 16;
type PageLayout = {
  number: number;
  top: number;
  width: number;
  height: number;
};

function PptxPreviewPage(props: {
  document: PptxDocumentSurface;
  layout: PageLayout;
  scale: number;
}) {
  const i18n = useI18n();
  let holder!: HTMLDivElement;
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal('');
  const [retry, setRetry] = createSignal(0);
  // Zoom changes the outer frame only; charts and native text keep their owner.
  createEffect(
    on(retry, () => {
      let disposed = false;
      let handle: ReturnType<PptxDocumentSurface['renderPage']> | undefined;
      setReady(false);
      setError('');
      try {
        handle = props.document.renderPage(props.layout.number - 1, holder);
        void handle.ready
          .then(() => {
            if (!disposed) setReady(true);
          })
          .catch((reason) => {
            if (!disposed)
              setError(
                reason instanceof Error ? reason.message : String(reason)
              );
          });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      onCleanup(() => {
        disposed = true;
        handle?.dispose();
      });
    })
  );
  return (
    <div
      data-page-number={props.layout.number}
      class="pptx-preview-pane__page absolute left-1/2 flex -translate-x-1/2 flex-col items-center gap-2"
      style={{ top: props.layout.top + 'px', width: props.layout.width + 'px' }}
    >
      <div class="h-4 text-[11px] leading-4 text-muted-foreground">
        {i18n.t('uiCopy.preview.pageLabel', { number: props.layout.number })}
      </div>
      <div
        class="pptx-preview-pane__page-frame relative overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-border/60"
        style={{
          width: props.layout.width + 'px',
          height: props.layout.height + 'px',
        }}
      >
        <div
          ref={holder}
          class="pptx-preview-pane__slide-content absolute left-0 top-0 origin-top-left text-black"
          style={{
            width: props.document.pageWidth + 'px',
            height: props.document.pageHeight + 'px',
            transform: 'scale(' + props.scale + ')',
          }}
        />
        <Show
          when={error()}
          fallback={
            <Show when={!ready()}>
              <div class="pointer-events-none absolute inset-0 flex items-center justify-center bg-muted/20 p-2 text-xs text-muted-foreground">
                {i18n.t('uiCopy.preview.renderingPage')}
              </div>
            </Show>
          }
        >
          <div class="absolute inset-0 overflow-auto bg-background/95 p-3 text-center text-xs">
            <p class="text-error">
              {i18n.t('uiCopy.preview.pageRenderFailed', {
                number: props.layout.number,
              })}
            </p>
            <Button
              size="sm"
              variant="outline"
              class="mt-2"
              onClick={() => setRetry((value) => value + 1)}
            >
              {i18n.t('chatChrome.retry')}
            </Button>
            <details class="mt-2 text-muted-foreground">
              <summary class="cursor-pointer">
                {i18n.t('filePreview.technicalDetails')}
              </summary>
              <pre class="whitespace-pre-wrap break-all text-left">
                {error()}
              </pre>
            </details>
          </div>
        </Show>
      </div>
    </div>
  );
}

export interface PptxPreviewPaneProps {
  bytes?: Uint8Array<ArrayBuffer> | null;
  surface?: FilePreviewSurface;
  onRenderError?: (message: string) => void;
}

export function PptxPreviewPane(props: PptxPreviewPaneProps) {
  const i18n = useI18n();
  const [document, setDocument] = createSignal<PptxDocumentSurface>();
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [incomplete, setIncomplete] = createSignal(false);
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const [scrollTop, setScrollTop] = createSignal(0);
  const dimensions = () => {
    const active = document();
    return active
      ? { width: active.pageWidth, height: active.pageHeight }
      : null;
  };
  const zoom = createPreviewZoom({
    viewport,
    content: dimensions,
    min: 0.1,
    max: 3,
    step: 0.1,
    labelHeight: PAGE_LABEL_SPACE,
    pageLayouts: () => layouts(),
  });
  const layouts = createMemo<PageLayout[]>(() => {
    const active = document();
    const scale = zoom.scale();
    if (!active || scale === null) return [];
    return Array.from({ length: active.pageCount }, (_, index) => ({
      number: index + 1,
      top: index * (active.pageHeight * scale + PAGE_LABEL_SPACE + PAGE_GAP),
      width: active.pageWidth * scale,
      height: active.pageHeight * scale,
    }));
  });
  const width = () => (document()?.pageWidth ?? 0) * (zoom.scale() ?? 0);
  const height = () => {
    const last = layouts().at(-1);
    return last ? last.top + last.height + PAGE_LABEL_SPACE : 0;
  };
  const visiblePages = createMemo(() => {
    const viewHeight = zoom.viewportSize()?.height ?? 0;
    const overscan = Math.max(viewHeight, 800);
    return layouts()
      .filter(
        (page) =>
          page.top + page.height + PAGE_LABEL_SPACE >= scrollTop() - overscan &&
          page.top <= scrollTop() + viewHeight + overscan
      )
      .map((page) => page.number);
  });
  createEffect(
    on(
      () => props.bytes,
      (bytes) => {
        setDocument(undefined);
        setError('');
        setIncomplete(false);
        setLoading(!!bytes);
        setScrollTop(0);
        zoom.reset();
        const element = untrack(viewport);
        if (element) {
          element.scrollTop = 0;
          element.scrollLeft = 0;
        }
        if (!bytes) return;
        const controller = new AbortController();
        let active: PptxDocumentSurface | undefined;
        void PptxDocumentSurface.open(bytes, {
          signal: controller.signal,
          onNodeError: () => {
            if (!controller.signal.aborted) setIncomplete(true);
          },
        })
          .then((value) => {
            if (controller.signal.aborted) {
              value.dispose();
              return;
            }
            active = value;
            setDocument(value);
          })
          .catch((reason) => {
            if (!controller.signal.aborted) {
              const message =
                reason instanceof Error ? reason.message : String(reason);
              setError(message);
              props.onRenderError?.(message);
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
        onCleanup(() => {
          controller.abort();
          active?.dispose();
        });
      }
    )
  );
  return (
    <div
      class={cn(
        'relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden',
        props.surface === 'window'
          ? 'redeven-file-preview-surface-window'
          : redevenSurfaceRoleClass('main')
      )}
    >
      <Show when={document()?.hasExternalLinks || incomplete()}>
        <div class="flex shrink-0 flex-col gap-1 border-b border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
          <Show when={document()?.hasExternalLinks}>
            <p>{i18n.t('uiCopy.preview.pptxExternalNotice')}</p>
          </Show>
          <Show when={incomplete()}>
            <p role="status" class="text-warning">
              {i18n.t('uiCopy.preview.pptxIncomplete')}
            </p>
          </Show>
        </div>
      </Show>
      <div class="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <FilePreviewZoomControls
          zoom={zoom}
          kind="Pptx"
          metadata={
            <>
              {i18n.t('uiCopy.preview.pageCount', {
                count: document()?.pageCount ?? 0,
              })}
            </>
          }
        />
        <div
          ref={setViewport}
          {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
          tabIndex={0}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          class="pptx-preview-pane relative min-h-0 min-w-0 flex-1 overflow-auto p-3 [overflow-anchor:none]"
        >
          <Show
            when={!error()}
            fallback={
              <FilePreviewErrorState
                errorType="render_error"
                message={error()}
              />
            }
          >
            <div
              class="relative grid place-items-center"
              style={{
                width:
                  Math.max(width(), zoom.viewportSize()?.width ?? 0) + 'px',
                height:
                  Math.max(height(), zoom.viewportSize()?.height ?? 0) + 'px',
              }}
            >
              <div
                data-preview-zoom-content
                class="relative"
                style={{ width: width() + 'px', height: height() + 'px' }}
              >
                <Show when={document()} keyed>
                  {(active) => (
                    <For each={visiblePages()}>
                      {(number) => (
                        <PptxPreviewPage
                          document={active}
                          layout={layouts()[number - 1]!}
                          scale={zoom.scale()!}
                        />
                      )}
                    </For>
                  )}
                </Show>
              </div>
            </div>
          </Show>
          <RedevenLoadingCurtain
            visible={loading()}
            eyebrow={i18n.t('uiCopy.preview.eyebrow')}
            message={i18n.t('uiCopy.preview.loadingPptx')}
          />
        </div>
      </div>
    </div>
  );
}
