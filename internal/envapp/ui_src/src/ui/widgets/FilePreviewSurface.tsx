import { Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Button, ConfirmDialog, Dialog, FloatingWindow } from '@floegence/floe-webapp-core/ui';
import type { FilePreviewDescriptor } from '../utils/filePreview';
import { readSelectionTextFromPreview } from '../utils/filePreviewSelection';
import { FilePreviewContent } from './FilePreviewContent';

const WINDOW_MARGIN_DESKTOP = 16;
const WINDOW_DEFAULT_WIDTH = 1040;
const WINDOW_DEFAULT_HEIGHT = 760;
const WINDOW_MIN_WIDTH = 420;
const WINDOW_MIN_HEIGHT = 320;
const WINDOW_Z_INDEX = 120;

type ViewportSize = {
  width: number;
  height: number;
};

function currentViewportSize(): ViewportSize {
  if (typeof window === 'undefined') return { width: 1440, height: 900 };
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(320, window.innerHeight),
  };
}

function resolveDesktopWindowSizing(viewport: ViewportSize) {
  const maxWidth = Math.max(320, viewport.width - WINDOW_MARGIN_DESKTOP * 2);
  const maxHeight = Math.max(320, viewport.height - WINDOW_MARGIN_DESKTOP * 2);

  return {
    defaultSize: {
      width: Math.min(WINDOW_DEFAULT_WIDTH, maxWidth),
      height: Math.min(WINDOW_DEFAULT_HEIGHT, maxHeight),
    },
    minSize: {
      width: Math.min(WINDOW_MIN_WIDTH, maxWidth),
      height: Math.min(WINDOW_MIN_HEIGHT, maxHeight),
    },
    maxSize: {
      width: maxWidth,
      height: maxHeight,
    },
  };
}

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
  downloadLoading?: boolean;
  onDownload?: () => void;
  onAskFlower?: (selectionText: string) => void | Promise<void>;
}

export function FilePreviewSurface(props: FilePreviewSurfaceProps) {
  const layout = useLayout();
  const [viewport, setViewport] = createSignal(currentViewportSize());
  let previewContentEl: HTMLDivElement | undefined;

  onMount(() => {
    const syncViewport = () => setViewport(currentViewportSize());
    syncViewport();
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);
    onCleanup(() => {
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
    });
  });

  const desktopSizing = createMemo(() => resolveDesktopWindowSizing(viewport()));
  const title = () => props.item?.name ?? 'File preview';
  const footerStatus = createMemo(() => {
    if ((props.saveError ?? '').trim()) return props.saveError ?? '';
    if (props.dirty) return 'Unsaved changes';
    if (props.editing) return 'Editing';
    if (props.truncated) return 'Truncated preview';
    return '';
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
  const footer = (
    <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class={cn('min-h-4 min-w-0 truncate text-[11px]', (props.saveError ?? '').trim() ? 'text-error' : 'text-muted-foreground')}>
        {footerStatus()}
      </div>

      <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
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
  );

  return (
    <>
      <Show
        when={layout.isMobile()}
        fallback={(
          <FloatingWindow
            open={props.open}
            onOpenChange={props.onOpenChange}
            title={title()}
            defaultSize={desktopSizing().defaultSize}
            minSize={desktopSizing().minSize}
            maxSize={desktopSizing().maxSize}
            zIndex={WINDOW_Z_INDEX}
            class={cn(
              'file-preview-floating-window overflow-hidden rounded-md',
              '[&>div:nth-child(2)]:min-h-0 [&>div:nth-child(2)]:flex [&>div:nth-child(2)]:flex-1 [&>div:nth-child(2)]:flex-col [&>div:nth-child(2)]:!overflow-hidden [&>div:nth-child(2)]:!p-0',
            )}
            footer={footer}
          >
            {previewBody()}
          </FloatingWindow>
        )}
      >
        <Dialog
          open={props.open}
          onOpenChange={props.onOpenChange}
          title={title()}
          footer={footer}
          class={cn(
            'flex max-w-none flex-col overflow-hidden rounded-md p-0',
            '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
            '[&>div:nth-child(2)]:min-h-0 [&>div:nth-child(2)]:flex [&>div:nth-child(2)]:flex-1 [&>div:nth-child(2)]:flex-col [&>div:nth-child(2)]:!overflow-hidden [&>div:nth-child(2)]:!p-0',
            'h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none',
          )}
        >
          {previewBody()}
        </Dialog>
      </Show>

      <ConfirmDialog
        open={!!props.closeConfirmOpen}
        onOpenChange={(open) => props.onCloseConfirmChange?.(open)}
        title="Discard unsaved changes?"
        description={props.closeConfirmMessage || 'Discard the current edits before continuing.'}
        confirmText="Discard changes"
        variant="destructive"
        onConfirm={() => void props.onConfirmDiscardClose?.()}
      />
    </>
  );
}
