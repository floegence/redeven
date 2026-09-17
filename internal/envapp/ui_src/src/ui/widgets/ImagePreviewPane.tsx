import { Show, createEffect, createSignal, on, untrack } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { FilePreviewDescriptor, FilePreviewSurface } from '../utils/filePreview';
import { useI18n } from '../i18n';
import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';
import { createPreviewZoom } from './createPreviewZoom';
import { FilePreviewZoomControls } from './FilePreviewZoomControls';
import { FilePreviewErrorState } from './FilePreviewErrorState';

export interface ImagePreviewPaneProps {
  surface?: FilePreviewSurface;
  item?: FileItem | null;
  descriptor: FilePreviewDescriptor;
  objectUrl?: string;
  allowLocalWheel?: boolean;
}

export function ImagePreviewPane(props: ImagePreviewPaneProps) {
  const i18n = useI18n();
  const [naturalSize, setNaturalSize] = createSignal<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = createSignal(false);
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const zoom = createPreviewZoom({ viewport, content: naturalSize, min: 0.25, max: 4, step: 0.25 });
  createEffect(on(() => props.objectUrl, () => {
    setNaturalSize(null); setFailed(false); zoom.reset();
    const el = untrack(viewport); if (el) { el.scrollTop = 0; el.scrollLeft = 0; }
  }));
  const handleWheel = (event: WheelEvent) => {
    if (props.allowLocalWheel === false) return;
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    if (event.deltaY < 0) zoom.zoomIn(); else zoom.zoomOut();
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom.zoomIn(); }
    else if (event.key === '-' || event.key === '_') { event.preventDefault(); zoom.zoomOut(); }
    else if (event.key === '0') { event.preventDefault(); zoom.selectMode('contain'); }
    else if (event.key === '1') { event.preventDefault(); zoom.selectMode('actual'); }
  };
  const width = () => (naturalSize()?.width ?? 0) * (zoom.scale() ?? 0);
  const height = () => (naturalSize()?.height ?? 0) * (zoom.scale() ?? 0);
  return (
    <div class={cn('flex h-full min-h-0 min-w-0 flex-col overflow-hidden', props.surface === 'window' ? 'redeven-file-preview-surface-window' : 'bg-muted/20')}>
      <div class="image-preview-controls flex shrink-0 justify-end border-b border-border/60 px-3 py-2"><FilePreviewZoomControls zoom={zoom} kind="Image" /></div>
      <div ref={setViewport} {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} onWheel={handleWheel} onKeyDown={handleKeyDown}
        class="image-preview-viewport relative min-h-0 min-w-0 flex-1 overflow-auto p-3 [overflow-anchor:none]" tabindex="0" role="region" aria-label={i18n.t('uiCopy.preview.imageViewport')}>
        <Show when={!failed()} fallback={<FilePreviewErrorState errorType="render_error" />}>
          <div class="relative grid place-items-center" style={{ width: `${Math.max(width(), zoom.viewportSize()?.width ?? 0)}px`, height: `${Math.max(height(), zoom.viewportSize()?.height ?? 0)}px` }}>
            <Show when={props.objectUrl} keyed fallback={<div class="text-sm text-muted-foreground">{i18n.t('uiCopy.preview.loadingImage')}</div>}>{source => (
              <img data-preview-zoom-content src={source} alt={props.item?.name ?? i18n.t('uiCopy.preview.imageAlt')} class="block max-w-none shrink-0 select-none" draggable={false}
                style={{ width: `${width()}px`, height: `${height()}px` }}
                onLoad={event => {
                  if (source !== props.objectUrl) return;
                  setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
                }} onError={() => { if (source === props.objectUrl) setFailed(true); }} />
            )}</Show>
          </div>
        </Show>
      </div>
    </div>
  );
}
