import { For, Show } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import type { FilePreviewDescriptor } from '../utils/filePreview';
import { DocxPreviewPane } from './DocxPreviewPane';
import { TextFilePreviewPane } from './TextFilePreviewPane';

export interface FilePreviewContentProps {
  item?: FileItem | null;
  descriptor: FilePreviewDescriptor;
  text?: string;
  draftText?: string;
  editing?: boolean;
  dirty?: boolean;
  saving?: boolean;
  saveError?: string | null;
  canEdit?: boolean;
  message?: string;
  objectUrl?: string;
  bytes?: Uint8Array<ArrayBuffer> | null;
  truncated?: boolean;
  loading?: boolean;
  error?: string | null;
  xlsxSheetName?: string;
  xlsxRows?: string[][];
  contentRef?: (element: HTMLDivElement) => void;
  onStartEdit?: () => void;
  onDraftChange?: (value: string) => void;
  onSelectionChange?: (selectionText: string) => void;
  onSave?: () => void;
  onDiscard?: () => void;
}

export function FilePreviewContent(props: FilePreviewContentProps) {
  const resolvedError = () => props.error;

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
        <Show when={props.descriptor.mode === 'text' && !resolvedError()}>
          <TextFilePreviewPane
            path={props.item?.path ?? 'preview.txt'}
            descriptor={props.descriptor}
            text={props.text ?? ''}
            draftText={props.draftText ?? props.text ?? ''}
            editing={props.editing}
            dirty={props.dirty}
            saving={props.saving}
            saveError={props.saveError}
            canEdit={props.canEdit}
            onStartEdit={props.onStartEdit}
            onDraftChange={props.onDraftChange}
            onSelectionChange={props.onSelectionChange}
            onSave={props.onSave}
            onDiscard={props.onDiscard}
          />
        </Show>

        <Show when={props.descriptor.mode === 'image' && !resolvedError()}>
          <div class="flex h-full items-center justify-center p-3">
            <img
              src={props.objectUrl}
              alt={props.item?.name ?? 'Preview'}
              class="max-h-full max-w-full object-contain"
            />
          </div>
        </Show>

        <Show when={props.descriptor.mode === 'pdf' && !resolvedError()}>
          <iframe src={props.objectUrl} class="h-full w-full border-0" title="PDF preview" />
        </Show>

        <Show when={props.descriptor.mode === 'docx' && !resolvedError()}>
          <DocxPreviewPane bytes={props.bytes} />
        </Show>

        <Show when={props.descriptor.mode === 'xlsx' && !resolvedError()}>
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

        <Show when={(props.descriptor.mode === 'binary' || props.descriptor.mode === 'unsupported') && !resolvedError()}>
          <div class="p-4 text-sm text-muted-foreground">
            <div class="mb-1 font-medium text-foreground">
              {props.descriptor.mode === 'binary' ? 'Binary file' : 'Preview not available'}
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
