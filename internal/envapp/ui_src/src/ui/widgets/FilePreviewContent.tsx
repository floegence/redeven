import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Check, Copy } from '@floegence/floe-webapp-core/icons';
import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';
import { Button } from '@floegence/floe-webapp-core/ui';
import { renderRedevenFilePreviewBody } from '../file-preview/rendererRegistry';
import type { FilePreviewDescriptor } from '../utils/filePreview';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';

export interface FilePreviewContentProps {
  item?: FileItem | null;
  descriptor: FilePreviewDescriptor;
  showHeader?: boolean;
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
  const showHeader = () => props.showHeader !== false;
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
      <Show when={showHeader()}>
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
      </Show>

      <div
        ref={(element) => {
          props.contentRef?.(element);
        }}
        {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
        class="relative flex-1 min-h-0 overflow-auto bg-background"
      >
        <Show when={!resolvedError()}>
          {renderRedevenFilePreviewBody(props)}
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
