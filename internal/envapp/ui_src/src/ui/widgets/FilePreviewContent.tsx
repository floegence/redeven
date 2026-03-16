import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import type { PreviewMode } from '../utils/filePreview';

export interface FilePreviewContentProps {
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
  contentRef?: (element: HTMLDivElement) => void;
}

export function FilePreviewContent(props: FilePreviewContentProps) {
  const [docxRenderError, setDocxRenderError] = createSignal<string | null>(null);
  let docxHost: HTMLDivElement | undefined;

  const resolvedError = () => props.error ?? docxRenderError();

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
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <div class="shrink-0 truncate border-b border-border px-3 py-2 text-[11px] font-mono text-muted-foreground">
        {props.item?.path}
      </div>

      <div
        ref={(element) => {
          props.contentRef?.(element);
        }}
        class="relative flex-1 min-h-0 overflow-auto bg-background"
      >
        <Show when={props.mode === 'text' && !resolvedError()}>
          <pre class="p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words select-text">
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
  );
}
