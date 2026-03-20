import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Check, Copy } from '@floegence/floe-webapp-core/icons';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button } from '@floegence/floe-webapp-core/ui';
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
  onCopyPath?: () => boolean | Promise<boolean>;
  contentRef?: (element: HTMLDivElement) => void;
  onStartEdit?: () => void;
  onDraftChange?: (value: string) => void;
  onSelectionChange?: (selectionText: string) => void;
  onSave?: () => void;
  onDiscard?: () => void;
}

export function FilePreviewContent(props: FilePreviewContentProps) {
  const resolvedError = () => props.error;
  const resolvedPath = () => String(props.item?.path ?? '').trim();
  const showEditorActions = () => props.descriptor.mode === 'text' && Boolean(props.canEdit);
  const [pathCopied, setPathCopied] = createSignal(false);
  let copyResetTimer: ReturnType<typeof globalThis.setTimeout> | undefined;

  const clearCopiedState = () => {
    if (copyResetTimer !== undefined) {
      globalThis.clearTimeout(copyResetTimer);
      copyResetTimer = undefined;
    }
    setPathCopied(false);
  };

  createEffect(() => {
    resolvedPath();
    clearCopiedState();
  });

  onCleanup(() => {
    clearCopiedState();
  });

  const handleCopyPath = async () => {
    if (!props.onCopyPath || !resolvedPath()) return;
    let copied: boolean | void = false;
    try {
      copied = await props.onCopyPath();
    } catch {
      return;
    }
    if (copied === false) return;
    setPathCopied(true);
    if (copyResetTimer !== undefined) {
      globalThis.clearTimeout(copyResetTimer);
    }
    copyResetTimer = globalThis.setTimeout(() => {
      copyResetTimer = undefined;
      setPathCopied(false);
    }, 1600);
  };

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <span class="shrink-0 text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Path</span>
          <span class="min-w-[12rem] flex-1 truncate font-mono text-xs text-muted-foreground">
            {resolvedPath() || '(unknown path)'}
          </span>
          <Show when={props.onCopyPath}>
            <button
              type="button"
              class={`inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 ${
                pathCopied() ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
              disabled={!resolvedPath()}
              aria-label={pathCopied() ? 'Path copied' : 'Copy path'}
              title={pathCopied() ? 'Path copied' : 'Copy path'}
              onClick={() => {
                void handleCopyPath();
              }}
            >
              <Show when={pathCopied()} fallback={<Copy class="size-3.5" />}>
                <Check class="size-3.5" />
              </Show>
            </button>
          </Show>
        </div>

        <Show when={showEditorActions() && !props.editing}>
          <Button size="sm" variant="outline" class="shrink-0" onClick={() => props.onStartEdit?.()}>
            Edit
          </Button>
        </Show>

        <Show when={showEditorActions() && props.editing}>
          <div class="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={props.saving}
              onClick={() => props.onDiscard?.()}
            >
              Discard
            </Button>
            <Button
              size="sm"
              variant="default"
              loading={props.saving}
              disabled={!props.dirty}
              onClick={() => props.onSave?.()}
            >
              Save
            </Button>
          </div>
        </Show>
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
            truncated={props.truncated}
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
