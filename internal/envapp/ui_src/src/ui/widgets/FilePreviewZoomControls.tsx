import { cn } from '@floegence/floe-webapp-core';
import { Show } from 'solid-js';
import { Button } from '@floegence/floe-webapp-core/ui';
import { useI18n } from '../i18n';
import type { PreviewZoom } from './createPreviewZoom';

export function FilePreviewZoomControls(props: { zoom: PreviewZoom; kind: 'Pdf' | 'Docx' | 'Image' }) {
  const i18n = useI18n();
  return (
    <div class="preview-zoom-controls flex min-w-0 flex-wrap items-center justify-end gap-1">
      <Button size="sm" variant="outline" class="h-7 min-w-7 px-0" disabled={!props.zoom.canZoomOut()} aria-label={i18n.t(`uiCopy.preview.zoomOut${props.kind}`)} onClick={props.zoom.zoomOut}>−</Button>
      <span class="min-w-14 text-center text-xs tabular-nums text-muted-foreground" aria-live="polite">{props.zoom.percent()}</span>
      <Button size="sm" variant="outline" class="h-7 min-w-7 px-0" disabled={!props.zoom.canZoomIn()} aria-label={i18n.t(`uiCopy.preview.zoomIn${props.kind}`)} onClick={props.zoom.zoomIn}>+</Button>
      <Button size="sm" variant="outline" class={cn('h-7 px-2 text-xs', props.zoom.mode() === 'contain' && 'border-primary/40 bg-primary/10 text-primary')} disabled={props.zoom.scale() === null} aria-pressed={props.zoom.mode() === 'contain'} aria-label={i18n.t('uiCopy.preview.fitWindow')} onClick={() => props.zoom.selectMode('contain')}>{i18n.t('uiCopy.preview.fitWindow')}</Button>
      <Show when={props.kind !== 'Image'}>
        <Button size="sm" variant="outline" class={cn('h-7 px-2 text-xs', props.zoom.mode() === 'width' && 'border-primary/40 bg-primary/10 text-primary')} disabled={props.zoom.scale() === null} aria-pressed={props.zoom.mode() === 'width'} aria-label={i18n.t('uiCopy.preview.fitWidth')} onClick={() => props.zoom.selectMode('width')}>{i18n.t('uiCopy.preview.fitWidth')}</Button>
      </Show>
      <Button size="sm" variant="outline" class={cn('h-7 px-2 text-xs', props.zoom.mode() === 'actual' && 'border-primary/40 bg-primary/10 text-primary')} disabled={props.zoom.scale() === null} aria-pressed={props.zoom.mode() === 'actual'} aria-label={i18n.t('uiCopy.preview.actualSize')} title={i18n.t('uiCopy.preview.actualSize')} onClick={() => props.zoom.selectMode('actual')}>1:1</Button>
    </div>
  );
}
