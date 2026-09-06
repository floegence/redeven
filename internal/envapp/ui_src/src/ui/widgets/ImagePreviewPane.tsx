import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { FilePreviewDescriptor } from '../utils/filePreview';
import { useI18n } from '../i18n';

const IMAGE_ZOOM_STEP = 0.25;
const IMAGE_MIN_SCALE = 0.25;
const IMAGE_MAX_SCALE = 4;

export interface ImagePreviewPaneProps {
  item?: FileItem | null;
  descriptor: FilePreviewDescriptor;
  objectUrl?: string;
}

function clampScale(value: number): number {
  return Math.min(IMAGE_MAX_SCALE, Math.max(IMAGE_MIN_SCALE, value));
}

export function ImagePreviewPane(props: ImagePreviewPaneProps) {
  const i18n = useI18n();
  const [naturalSize, setNaturalSize] = createSignal({ width: 0, height: 0 });
  const [viewportSize, setViewportSize] = createSignal({ width: 0, height: 0 });
  const [mode, setMode] = createSignal<'fit' | 'actual' | 'manual'>('fit');
  const [manualScale, setManualScale] = createSignal(1);
  let viewportEl: HTMLDivElement | undefined;

  const fitScale = createMemo(() => {
    const image = naturalSize();
    const viewport = viewportSize();
    if (!image.width || !image.height || !viewport.width || !viewport.height) return 1;
    return Math.min(1, viewport.width / image.width, viewport.height / image.height);
  });
  const scale = createMemo(() => mode() === 'fit' ? fitScale() : mode() === 'actual' ? 1 : manualScale());
  const zoomPercent = createMemo(() => `${Math.round(scale() * 100)}%`);
  const canZoomIn = createMemo(() => scale() < IMAGE_MAX_SCALE);
  const canZoomOut = createMemo(() => scale() > IMAGE_MIN_SCALE);
  const imageStyle = createMemo(() => {
    const image = naturalSize();
    const currentScale = scale();
    if (!image.width || !image.height) return {};
    return {
      width: `${image.width * currentScale}px`,
      height: `${image.height * currentScale}px`,
    };
  });

  const syncViewport = () => {
    if (!viewportEl) return;
    setViewportSize({ width: Math.max(0, viewportEl.clientWidth - 24), height: Math.max(0, viewportEl.clientHeight - 24) });
  };

  onMount(() => {
    syncViewport();
    window.addEventListener('resize', syncViewport);
    onCleanup(() => window.removeEventListener('resize', syncViewport));
  });

  createEffect(() => {
    const objectUrl = props.objectUrl;
    setMode('fit');
    setManualScale(1);
    if (objectUrl !== undefined) setNaturalSize({ width: 0, height: 0 });
  });

  const setManualZoom = (next: number) => {
    setMode('manual');
    setManualScale(clampScale(next));
  };

  const handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setManualZoom(scale() + (event.deltaY < 0 ? IMAGE_ZOOM_STEP : -IMAGE_ZOOM_STEP));
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      setManualZoom(scale() + IMAGE_ZOOM_STEP);
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      setManualZoom(scale() - IMAGE_ZOOM_STEP);
    } else if (event.key === '0') {
      event.preventDefault();
      setMode('fit');
    } else if (event.key === '1') {
      event.preventDefault();
      setMode('actual');
    }
  };

  return (
    <div class="relative flex h-full min-h-0 flex-col overflow-hidden bg-muted/20">
      <div class="image-preview-controls absolute right-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-1 rounded-md border border-border/80 bg-background/90 p-1 shadow-lg backdrop-blur-sm">
        <Button size="sm" variant="outline" class="h-7 min-w-7 px-0 font-mono" disabled={!canZoomOut()} aria-label={i18n.t('uiCopy.preview.zoomOutImage')} onClick={() => setManualZoom(scale() - IMAGE_ZOOM_STEP)}>-</Button>
        <div class="min-w-14 px-1 text-center font-mono text-[11px] text-muted-foreground" aria-live="polite">{zoomPercent()}</div>
        <Button size="sm" variant="outline" class="h-7 min-w-7 px-0 font-mono" disabled={!canZoomIn()} aria-label={i18n.t('uiCopy.preview.zoomInImage')} onClick={() => setManualZoom(scale() + IMAGE_ZOOM_STEP)}>+</Button>
        <Button size="sm" variant="outline" class="h-7 px-2 text-[11px]" aria-label={i18n.t('uiCopy.preview.fitImage')} onClick={() => setMode('fit')}>{i18n.t('uiCopy.preview.fit')}</Button>
        <Button size="sm" variant="outline" class="h-7 px-2 text-[11px]" aria-label={i18n.t('uiCopy.preview.actualImageSize')} onClick={() => setMode('actual')}>1:1</Button>
      </div>
      <div ref={viewportEl} onWheel={handleWheel} onKeyDown={handleKeyDown} class="image-preview-viewport min-h-0 flex-1 overflow-auto" tabindex="0" role="region" aria-label={i18n.t('uiCopy.preview.imageViewport')}>
        <div class="flex min-h-full min-w-full items-center justify-center p-3">
          <Show when={props.objectUrl} fallback={<div class="text-sm text-muted-foreground">{i18n.t('uiCopy.preview.loadingImage')}</div>}>
            <img
              src={props.objectUrl}
              alt={props.item?.name ?? i18n.t('uiCopy.preview.imageAlt')}
              class={cn('block max-w-none shrink-0 select-none', mode() === 'fit' && 'object-contain')}
              style={imageStyle()}
              onLoad={(event) => {
                const image = event.currentTarget;
                setNaturalSize({ width: image.naturalWidth, height: image.naturalHeight });
                syncViewport();
              }}
              draggable={false}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}
