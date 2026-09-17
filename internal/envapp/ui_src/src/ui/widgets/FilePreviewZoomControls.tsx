import { Match, Switch, type JSX } from 'solid-js';
import { Button, Dropdown, type DropdownItem } from '@floegence/floe-webapp-core/ui';
import { ArrowRightLeft, ChevronDown, Maximize, Minus, Plus, Search } from '@floegence/floe-webapp-core/icons';
import { useI18n } from '../i18n';
import { Tooltip } from '../primitives/Tooltip';
import type { PreviewZoom } from './createPreviewZoom';

export function FilePreviewZoomControls(props: { zoom: PreviewZoom; kind: 'Pdf' | 'Docx' | 'Image'; metadata?: JSX.Element }) {
  const i18n = useI18n();
  const modeLabel = () => {
    switch (props.zoom.mode()) {
      case 'contain': return i18n.t('uiCopy.preview.fitWindow');
      case 'width': return i18n.t('uiCopy.preview.fitWidth');
      case 'actual': return i18n.t('uiCopy.preview.actualSize');
      case 'manual': return i18n.t('uiCopy.preview.manualZoom');
    }
  };
  const items = (): DropdownItem[] => [
    ...(props.metadata ? [{ id: 'metadata', label: '', disabled: true, content: () => <span class="text-muted-foreground">{props.metadata}</span> }, { id: 'separator', label: '', separator: true }] : []),
    { id: 'contain', label: i18n.t('uiCopy.preview.fitWindow'), icon: () => <Maximize class="h-3.5 w-3.5" /> },
    ...(props.kind === 'Image' ? [] : [{ id: 'width', label: i18n.t('uiCopy.preview.fitWidth'), icon: () => <ArrowRightLeft class="h-3.5 w-3.5" /> }]),
    { id: 'actual', label: i18n.t('uiCopy.preview.actualSize') },
  ];
  return (
    <div class={`${props.kind.toLowerCase()}-preview-controls pointer-events-none absolute inset-x-2 top-2 z-10 flex justify-end`}>
      <div class="preview-zoom-controls pointer-events-auto flex max-w-full items-center gap-0.5 rounded-lg border border-border/60 bg-background/90 p-1 shadow-sm backdrop-blur-sm">
        <Tooltip content={i18n.t(`uiCopy.preview.zoomOut${props.kind}`)} placement="bottom">
          <Button size="sm" variant="ghost" class="h-8 w-8 shrink-0 px-0" disabled={!props.zoom.canZoomOut()} aria-label={i18n.t(`uiCopy.preview.zoomOut${props.kind}`)} onClick={props.zoom.zoomOut}><Minus class="h-3.5 w-3.5" /></Button>
        </Tooltip>
        <Dropdown align="end" class="min-w-0" disabled={props.zoom.scale() === null}
          triggerClass="flex h-8 min-w-0 items-center gap-1.5 rounded px-1.5 text-xs hover:bg-accent focus-visible:outline-none focus-visible:bg-accent"
          triggerAriaLabel={i18n.t('uiCopy.preview.zoomOptions', { mode: modeLabel(), percent: props.zoom.percent() })}
          trigger={<>
            <span class="flex h-3.5 w-4 shrink-0 items-center justify-center" aria-hidden="true">
              <Switch fallback={<Search class="h-3.5 w-3.5" />}>
                <Match when={props.zoom.mode() === 'contain'}><Maximize class="h-3.5 w-3.5" /></Match>
                <Match when={props.zoom.mode() === 'width'}><ArrowRightLeft class="h-3.5 w-3.5" /></Match>
                <Match when={props.zoom.mode() === 'actual'}><span class="text-[10px]">1:1</span></Match>
              </Switch>
            </span>
            <span class="min-w-10 text-center tabular-nums" aria-live="polite">{props.zoom.percent()}</span>
            <ChevronDown class="h-3 w-3 shrink-0 text-muted-foreground" />
          </>}
          items={items()} value={props.zoom.mode()}
          onSelect={mode => { if (mode === 'contain' || mode === 'width' || mode === 'actual') props.zoom.selectMode(mode); }} />
        <Tooltip content={i18n.t(`uiCopy.preview.zoomIn${props.kind}`)} placement="bottom">
          <Button size="sm" variant="ghost" class="h-8 w-8 shrink-0 px-0" disabled={!props.zoom.canZoomIn()} aria-label={i18n.t(`uiCopy.preview.zoomIn${props.kind}`)} onClick={props.zoom.zoomIn}><Plus class="h-3.5 w-3.5" /></Button>
        </Tooltip>
      </div>
    </div>
  );
}
