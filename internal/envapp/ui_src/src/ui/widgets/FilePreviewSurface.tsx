import { Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Button, Dialog, FloatingWindow } from '@floegence/floe-webapp-core/ui';
import type { PreviewMode } from '../utils/filePreview';
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

function readSelectionTextFromPreview(contentElement?: HTMLDivElement): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount <= 0) return '';

  const text = String(selection.toString() ?? '').trim();
  if (!text) return '';
  if (!contentElement) return text;

  const range = selection.getRangeAt(0);
  const containerNode = range.commonAncestorContainer;
  const containerElement =
    containerNode.nodeType === Node.ELEMENT_NODE
      ? (containerNode as Element)
      : containerNode.parentElement;
  if (!containerElement || !contentElement.contains(containerElement)) {
    return '';
  }

  return text;
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
  mode: PreviewMode;
  text?: string;
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
  const previewBody = () => (
    <FilePreviewContent
      item={props.item}
      mode={props.mode}
      text={props.text}
      message={props.message}
      objectUrl={props.objectUrl}
      bytes={props.bytes}
      truncated={props.truncated}
      loading={props.loading}
      error={props.error}
      xlsxSheetName={props.xlsxSheetName}
      xlsxRows={props.xlsxRows}
      contentRef={(element) => {
        previewContentEl = element;
      }}
    />
  );
  const footer = (
    <div class="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-h-4 min-w-0 text-[11px] text-muted-foreground">
        <Show when={props.truncated}>
          <div class="truncate">Truncated preview</div>
        </Show>
      </div>

      <div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
        <Show when={props.onAskFlower}>
          <Button
            size="sm"
            variant="outline"
            class="w-full sm:w-auto"
            disabled={!props.item || props.loading}
            onClick={() => {
              void props.onAskFlower?.(readSelectionTextFromPreview(previewContentEl));
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

  return layout.isMobile() ? (
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
  ) : (
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
  );
}
