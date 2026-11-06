import { Match, Show, Switch, createEffect, createMemo, createSignal, on } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { FlowerContextSnapshotPreviewProps } from '../../../../../flower_ui/src';
import { useI18n } from '../i18n';
import { FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR, type FilePreviewDescriptor } from '../utils/filePreview';
import { fileItemFromPath } from '../utils/filePreviewItem';
import { FilePreviewContent } from './FilePreviewContent';
import { PreviewWindow } from './PreviewWindow';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';

export type FlowerContextPreviewState = Readonly<{
  title: string;
  subtitle: string;
  item: FileItem;
  descriptor: FilePreviewDescriptor;
  text?: string;
  snapshot?: boolean;
  message?: string;
  objectUrl?: string;
  bytes?: Uint8Array<ArrayBuffer> | null;
  truncated?: boolean;
  loading?: boolean;
  error?: string | null;
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
}>;

/** One preview presentation for Ask Flower and composer/chat snapshots. */
export function FlowerContextPreviewWindow(props: { preview: FlowerContextPreviewState | null; onClose: () => void }) {
  const i18n = useI18n();
  let opener: HTMLElement | null = null;
  const [imageFailed, setImageFailed] = createSignal(false);
  createEffect(on(() => props.preview?.objectUrl, () => setImageFailed(false)));
  createEffect(on(() => Boolean(props.preview), open => {
    if (open) opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }));
  const closePreview = () => {
    const restore = opener;
    props.onClose();
    queueMicrotask(() => { if (restore?.isConnected) restore.focus({ preventScroll: true }); });
  };
  return (
    <PreviewWindow
      open={!!props.preview}
      onOpenChange={(open) => {
        if (!open) closePreview();
      }}
      title={props.preview?.title || i18n.t('flowerTurnLauncher.contextPreviewTitle')}
      stackId="flower-turn-context-preview"
      stackLayer="flowerContext"
      persistenceKey="flower-turn-context-preview"
      defaultSize={{ width: 880, height: 640 }}
      minSize={{ width: 380, height: 280 }}
      surfaceRef={surface => surface?.querySelector<HTMLButtonElement>('[data-floe-floating-window-control="close"]')?.focus({ preventScroll: true })}
      floatingClass="flower-turn-launcher-related-surface flower-turn-context-surface flower-context-preview-window"
      mobileClass="flower-turn-launcher-related-surface flower-turn-context-surface flower-context-preview-window"
      headerActions={(
        <Show when={props.preview?.actionLabel && props.preview?.onAction}>
          <Button size="sm" variant="ghost" class="cursor-pointer" disabled={props.preview?.actionDisabled}
            onClick={(event) => {
              event.currentTarget.focus({ preventScroll: true });
              props.preview?.onAction?.();
            }}>{props.preview?.actionLabel}</Button>
        </Show>
      )}
    >
      <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <Show when={props.preview?.helper}>
          <div class={`shrink-0 border-b px-3 py-2 text-xs ${props.preview?.error ? 'border-error/20 bg-error/5 text-error' : 'border-border/70 bg-muted/25 text-muted-foreground'}`}>
            {props.preview?.helper}
          </div>
        </Show>
        <div class="min-h-0 flex-1 overflow-hidden">
          <Show when={props.preview}>
            {(preview) => (
              <Switch fallback={
                <FilePreviewContent surface="window" showHeader={false}
                  item={preview().item} descriptor={preview().descriptor} text={preview().text}
                  message={preview().message} objectUrl={preview().objectUrl} bytes={preview().bytes}
                  truncated={preview().truncated} loading={preview().loading} error={preview().error} />
              }>
                <Match when={preview().snapshot}>
                  <pre data-flower-context-preview-text tabindex="0"
                    {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
                    class="m-0 h-full overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-foreground">{preview().text}</pre>
                </Match>
                <Match when={preview().descriptor.mode === 'image' && preview().objectUrl}>
                  <Show when={!imageFailed()} fallback={
                    <div role="alert" class="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">{i18n.t('filePreview.errorRenderTitle')}</div>
                  }>
                    <img src={preview().objectUrl} alt={preview().title} class="block h-full w-full object-contain" onError={() => setImageFailed(true)} />
                  </Show>
                </Match>
              </Switch>
            )}
          </Show>
        </div>
      </div>
    </PreviewWindow>
  );
}

export function FlowerContextSnapshotPreview(props: FlowerContextSnapshotPreviewProps) {
  const preview = createMemo<FlowerContextPreviewState>(() => ({
    title: props.title,
    subtitle: props.subtitle,
    item: fileItemFromPath(props.sourcePath || props.subtitle || props.title, props.title),
    descriptor: FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR,
    text: props.body,
    snapshot: true,
    truncated: props.truncated,
    helper: props.statusMessage || (props.truncated ? props.truncatedLabel : undefined),
    actionLabel: props.actionLabel, onAction: props.onAction, actionDisabled: props.actionDisabled,
  }));
  return <FlowerContextPreviewWindow preview={preview()} onClose={props.onClose} />;
}
