import { Show, createEffect, createMemo, on } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Button } from '@floegence/floe-webapp-core/ui';
import type { FlowerContextSnapshotPreviewProps } from '../../../../../flower_ui/src';
import { useI18n } from '../i18n';
import { FALLBACK_TEXT_FILE_PREVIEW_DESCRIPTOR, type FilePreviewDescriptor } from '../utils/filePreview';
import { fileItemFromPath } from '../utils/filePreviewItem';
import { FilePreviewContent } from './FilePreviewContent';
import { PreviewWindow } from './PreviewWindow';

export type FlowerContextPreviewState = Readonly<{
  title: string;
  subtitle: string;
  item: FileItem;
  descriptor: FilePreviewDescriptor;
  text?: string;
  message?: string;
  objectUrl?: string;
  bytes?: Uint8Array<ArrayBuffer> | null;
  truncated?: boolean;
  loading?: boolean;
  error?: string | null;
  xlsxSheetName?: string;
  xlsxRows?: string[][];
  helper?: string;
  actionLabel?: string;
  onAction?: () => void;
}>;

/** One preview presentation for Ask Flower and composer/chat snapshots. */
export function FlowerContextPreviewWindow(props: { preview: FlowerContextPreviewState | null; onClose: () => void }) {
  const i18n = useI18n();
  let opener: HTMLElement | null = null;
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
      description={props.preview?.subtitle || undefined}
      stackId="flower-turn-context-preview"
      stackLayer="flowerContext"
      persistenceKey="flower-turn-context-preview"
      defaultSize={{ width: 880, height: 640 }}
      minSize={{ width: 380, height: 280 }}
      surfaceRef={surface => surface?.querySelector<HTMLButtonElement>('[data-flower-context-preview-close]')?.focus({ preventScroll: true })}
      floatingClass="flower-turn-launcher-related-surface flower-turn-context-surface flower-context-preview-window"
      mobileClass="flower-turn-launcher-related-surface flower-turn-context-surface flower-context-preview-window"
      footer={(
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          <Button size="sm" variant="outline" class="cursor-pointer" data-flower-context-preview-close onClick={closePreview}>
            {i18n.t('common.actions.close')}
          </Button>
          <Show when={props.preview?.actionLabel && props.preview?.onAction}>
            <Button
              size="sm"
              variant="default"
              class="cursor-pointer"
              onClick={() => {
                props.preview?.onAction?.();
              }}
            >
              {props.preview?.actionLabel}
            </Button>
          </Show>
        </div>
      )}
    >
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <Show when={props.preview?.helper}>
          <div class={`shrink-0 border-b px-3 py-2 text-xs ${props.preview?.error ? 'border-error/20 bg-error/5 text-error' : 'border-border/70 bg-muted/25 text-muted-foreground'}`}>
            {props.preview?.helper}
          </div>
        </Show>
        <div class="min-h-0 flex-1 overflow-hidden">
          <Show when={props.preview}>
            {(preview) => (
              <FilePreviewContent
                surface="window"
                item={preview().item}
                descriptor={preview().descriptor}
                text={preview().text}
                message={preview().message}
                objectUrl={preview().objectUrl}
                bytes={preview().bytes}
                truncated={preview().truncated}
                loading={preview().loading}
                error={preview().error}
                xlsxSheetName={preview().xlsxSheetName}
                xlsxRows={preview().xlsxRows}
              />
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
    truncated: props.truncated,
    helper: props.truncated ? props.truncatedLabel : undefined,
  }));
  return <FlowerContextPreviewWindow preview={preview()} onClose={props.onClose} />;
}
