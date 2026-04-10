import { Show, createMemo, createSignal } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Button, ConfirmDialog } from '@floegence/floe-webapp-core/ui';
import type { FilePreviewDescriptor } from '../utils/filePreview';
import { readSelectionTextFromPreview } from '../utils/filePreviewSelection';
import { FilePreviewContent } from './FilePreviewContent';
import { PREVIEW_WINDOW_Z_INDEX, PreviewWindow } from './PreviewWindow';
import { WindowModal } from './WindowModal';

export interface FilePreviewSurfaceProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: FileItem | null;
  descriptor: FilePreviewDescriptor;
  text?: string;
  draftText?: string;
  editing?: boolean;
  dirty?: boolean;
  saving?: boolean;
  saveError?: string | null;
  canEdit?: boolean;
  selectedText?: string;
  closeConfirmOpen?: boolean;
  closeConfirmMessage?: string;
  onCloseConfirmChange?: (open: boolean) => void;
  onConfirmDiscardClose?: () => void | Promise<void>;
  onStartEdit?: () => void;
  onDraftChange?: (value: string) => void;
  onSelectionChange?: (selectionText: string) => void;
  onSave?: () => void | Promise<void>;
  onDiscard?: () => void;
  message?: string;
  objectUrl?: string;
  bytes?: Uint8Array<ArrayBuffer> | null;
  truncated?: boolean;
  loading?: boolean;
  error?: string | null;
  xlsxSheetName?: string;
  xlsxRows?: string[][];
  onCopyPath?: () => boolean | Promise<boolean>;
  downloadLoading?: boolean;
  onDownload?: () => void;
  onAskFlower?: (selectionText: string) => void | Promise<void>;
}

export function FilePreviewSurface(props: FilePreviewSurfaceProps) {
  const layout = useLayout();
  const isMobile = createMemo(() => layout.isMobile());
  const [floatingSurfaceEl, setFloatingSurfaceEl] = createSignal<HTMLElement | null>(null);
  let previewContentEl: HTMLDivElement | undefined;
  const title = () => props.item?.name ?? 'File preview';
  const footerStatus = createMemo(() => {
    const saveError = String(props.saveError ?? '').trim();
    if (saveError) {
      return { label: 'Save failed', detail: saveError, tone: 'error' as const };
    }
    if (props.dirty) {
      return { label: 'Unsaved changes', detail: 'Editing with local changes', tone: 'warning' as const };
    }
    if (props.editing) {
      return { label: 'Editing', detail: 'No local changes', tone: 'brand' as const };
    }
    if (props.truncated) {
      return { label: 'Truncated preview', detail: 'Download the full file for the complete content.', tone: 'warning' as const };
    }
    if (props.loading) {
      return { label: 'Loading', detail: 'Fetching preview content', tone: 'neutral' as const };
    }
    return { label: 'Ready', detail: '', tone: 'neutral' as const };
  });
  const footerBadgeClass = createMemo(() => {
    switch (footerStatus().tone) {
      case 'error':
        return 'border-error/20 bg-error/10 text-error';
      case 'warning':
        return 'border-warning/20 bg-warning/12 text-warning';
      case 'brand':
        return 'border-primary/20 bg-primary/[0.08] text-primary';
      default:
        return 'border-border/70 bg-background/80 text-muted-foreground';
    }
  });
  const footerDetailClass = createMemo(() => {
    switch (footerStatus().tone) {
      case 'error':
        return 'text-error';
      case 'warning':
        return 'text-warning';
      case 'brand':
        return 'text-primary';
      default:
        return 'text-muted-foreground';
    }
  });
  const previewBody = () => (
    <FilePreviewContent
      item={props.item}
      descriptor={props.descriptor}
      text={props.text}
      draftText={props.draftText}
      editing={props.editing}
      dirty={props.dirty}
      saving={props.saving}
      saveError={props.saveError}
      canEdit={props.canEdit}
      message={props.message}
      objectUrl={props.objectUrl}
      bytes={props.bytes}
      truncated={props.truncated}
      loading={props.loading}
      error={props.error}
      xlsxSheetName={props.xlsxSheetName}
      xlsxRows={props.xlsxRows}
      onCopyPath={props.onCopyPath}
      onStartEdit={props.onStartEdit}
      onDraftChange={props.onDraftChange}
      onSelectionChange={props.onSelectionChange}
      onSave={props.onSave}
      onDiscard={props.onDiscard}
      contentRef={(element) => {
        previewContentEl = element;
      }}
    />
  );
  const hasAskFlowerAction = () => Boolean(props.onAskFlower);
  const footer = (
    <div data-testid="file-preview-footer" class="w-full">
      <div class={cn('flex w-full', isMobile() ? 'flex-col gap-2' : 'flex-col gap-2 sm:flex-row sm:items-center sm:justify-between')}>
        <div class={cn('min-w-0', isMobile() ? 'flex flex-col gap-1' : 'flex items-center gap-2')}>
          <span class={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]', footerBadgeClass())}>
            {footerStatus().label}
          </span>
          <Show when={footerStatus().detail}>
            <span class={cn(isMobile() ? 'text-xs leading-4 whitespace-normal break-words' : 'min-w-0 truncate text-xs', footerDetailClass())}>
              {footerStatus().detail}
            </span>
          </Show>
        </div>

        <div
          class={cn(
            'gap-2',
            isMobile()
              ? hasAskFlowerAction()
                ? 'grid w-full grid-cols-2'
                : 'grid w-full grid-cols-1'
              : 'flex w-full flex-col sm:w-auto sm:flex-row sm:justify-end',
          )}
        >
          <Show when={props.onAskFlower}>
            <Button
              size="sm"
              variant="outline"
              class="w-full sm:w-auto"
              disabled={!props.item || props.loading}
              onClick={() => {
                const selectionText = String(props.selectedText ?? '').trim() || readSelectionTextFromPreview(previewContentEl);
                void props.onAskFlower?.(selectionText);
              }}
            >
              Ask Flower
            </Button>
          </Show>

          <Button
            size="sm"
            variant="outline"
            class="w-full sm:w-auto"
            loading={props.downloadLoading}
            disabled={!props.item || props.loading}
            onClick={() => props.onDownload?.()}
          >
            Download
          </Button>
        </div>
      </div>
    </div>
  );
  const closeConfirmFooter = (
    <div class="border-t border-border/70 px-4 pt-3 pb-4">
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button size="sm" variant="outline" class="w-full sm:w-auto" onClick={() => props.onCloseConfirmChange?.(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="destructive" class="w-full sm:w-auto" onClick={() => void props.onConfirmDiscardClose?.()}>
          Discard changes
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <PreviewWindow
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={title()}
        footer={footer}
        persistenceKey="file-preview"
        zIndex={PREVIEW_WINDOW_Z_INDEX}
        surfaceRef={setFloatingSurfaceEl}
      >
        {previewBody()}
      </PreviewWindow>

      <Show when={isMobile()}>
        <ConfirmDialog
          open={!!props.closeConfirmOpen}
          onOpenChange={(open) => props.onCloseConfirmChange?.(open)}
          title="Discard unsaved changes?"
          description={props.closeConfirmMessage || 'Discard the current edits before continuing.'}
          confirmText="Discard changes"
          variant="destructive"
          onConfirm={() => void props.onConfirmDiscardClose?.()}
        />
      </Show>

      <Show when={!isMobile()}>
        <WindowModal
          open={!!props.closeConfirmOpen}
          host={floatingSurfaceEl()}
          title="Discard unsaved changes?"
          description={props.closeConfirmMessage || 'Discard the current edits before continuing.'}
          footer={closeConfirmFooter}
          class="w-[min(30rem,calc(100%-1rem))]"
          onOpenChange={(open) => props.onCloseConfirmChange?.(open)}
        />
      </Show>
    </>
  );
}
