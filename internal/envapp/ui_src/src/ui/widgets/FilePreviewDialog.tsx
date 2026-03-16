import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { cn, useLayout } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Button, Dialog } from '@floegence/floe-webapp-core/ui';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import type { PreviewMode } from '../utils/filePreview';

export interface FilePreviewDialogProps {
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

export function FilePreviewDialog(props: FilePreviewDialogProps) {
  const layout = useLayout();
  const [docxRenderError, setDocxRenderError] = createSignal<string | null>(null);
  let docxHost: HTMLDivElement | undefined;
  let previewContentEl: HTMLDivElement | undefined;

  const resolvedError = () => props.error ?? docxRenderError();

  const readSelectionText = (): string => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount <= 0) return '';

    const text = String(selection.toString() ?? '').trim();
    if (!text) return '';

    if (previewContentEl) {
      const range = selection.getRangeAt(0);
      const containerNode = range.commonAncestorContainer;
      const containerElement =
        containerNode.nodeType === Node.ELEMENT_NODE
          ? (containerNode as Element)
          : containerNode.parentElement;
      if (!containerElement || !previewContentEl.contains(containerElement)) {
        return '';
      }
    }

    return text;
  };

  createEffect(() => {
    const mode = props.mode;
    const bytes = props.bytes;
    const host = docxHost;

    setDocxRenderError(null);
    if (host) {
      host.innerHTML = '';
    }
    if (mode !== 'docx' || !bytes || !host || props.error) return;

    let disposed = false;

    void (async () => {
      try {
        const module = await import('docx-preview');
        if (disposed) return;

        const renderAsync = (module as any).renderAsync as
          | ((buffer: ArrayBuffer, container: HTMLElement, styleContainer?: HTMLElement, options?: any) => Promise<void>)
          | undefined;
        if (!renderAsync) {
          throw new Error('renderAsync not found');
        }

        await renderAsync(bytes.buffer, host, undefined, {
          className: 'docx-preview-container',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          useBase64URL: false,
        });
      } catch (error) {
        if (disposed) return;
        setDocxRenderError(error instanceof Error ? error.message : String(error));
      }
    })();

    onCleanup(() => {
      disposed = true;
      if (host) {
        host.innerHTML = '';
      }
    });
  });

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={props.item?.name ?? 'File preview'}
      footer={(
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
                  void props.onAskFlower?.(readSelectionText());
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
              disabled={!props.item || props.loading || !!resolvedError()}
              onClick={() => props.onDownload?.()}
            >
              Download
            </Button>
          </div>
        </div>
      )}
      class={cn(
        'flex max-w-none flex-col overflow-hidden rounded-md p-0',
        '[&>div:first-child]:border-b-0 [&>div:first-child]:pb-2',
        '[&>div:nth-child(2)]:min-h-0 [&>div:nth-child(2)]:flex [&>div:nth-child(2)]:flex-1 [&>div:nth-child(2)]:flex-col [&>div:nth-child(2)]:!overflow-hidden [&>div:nth-child(2)]:!p-0',
        layout.isMobile()
          ? 'h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none'
          : 'max-h-[88vh] w-[min(1100px,94vw)]',
      )}
    >
      <div class="flex h-full min-h-0 flex-col overflow-hidden">
        <div class="shrink-0 border-b border-border px-3 py-2 text-[11px] font-mono text-muted-foreground truncate">
          {props.item?.path}
        </div>

        <div
          ref={previewContentEl}
          class="relative flex-1 min-h-0 overflow-auto bg-background"
        >
          <Show when={props.mode === 'text' && !resolvedError()}>
            <pre class="p-3 text-xs leading-relaxed font-mono whitespace-pre-wrap break-words select-text">
              {props.text}
            </pre>
          </Show>

          <Show when={props.mode === 'image' && !resolvedError()}>
            <div class="flex h-full items-center justify-center p-3">
              <img
                src={props.objectUrl}
                alt={props.item?.name ?? 'Preview'}
                class="max-h-full max-w-full object-contain"
              />
            </div>
          </Show>

          <Show when={props.mode === 'pdf' && !resolvedError()}>
            <iframe src={props.objectUrl} class="h-full w-full border-0" title="PDF preview" />
          </Show>

          <Show when={props.mode === 'docx' && !resolvedError()}>
            <div ref={docxHost} class="p-3" />
          </Show>

          <Show when={props.mode === 'xlsx' && !resolvedError()}>
            <div class="p-3">
              <Show when={props.xlsxSheetName}>
                <div class="mb-2 text-[11px] text-muted-foreground">Sheet: {props.xlsxSheetName}</div>
              </Show>

              <div class="overflow-auto rounded-md border border-border">
                <table class="w-full text-xs">
                  <tbody>
                    <For each={props.xlsxRows ?? []}>
                      {(row) => (
                        <tr class="border-b border-border last:border-b-0">
                          <For each={row}>
                            {(cell) => (
                              <td class="border-r border-border px-2 py-1 align-top whitespace-pre-wrap break-words last:border-r-0">
                                {cell}
                              </td>
                            )}
                          </For>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </div>
          </Show>

          <Show when={(props.mode === 'binary' || props.mode === 'unsupported') && !resolvedError()}>
            <div class="p-4 text-sm text-muted-foreground">
              <div class="mb-1 font-medium text-foreground">
                {props.mode === 'binary' ? 'Binary file' : 'Preview not available'}
              </div>
              <div class="text-xs">{props.message || 'Preview is not available.'}</div>
            </div>
          </Show>

          <Show when={resolvedError()}>
            <div class="p-4 text-sm text-error">
              <div class="mb-1 font-medium">Failed to load file</div>
              <div class="text-xs text-muted-foreground">{resolvedError()}</div>
            </div>
          </Show>

          <LoadingOverlay visible={!!props.loading} message="Loading file..." />
        </div>
      </div>
    </Dialog>
  );
}
