import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Check, Copy, Download, Loader2, Pencil, Save, X } from '@floegence/floe-webapp-core/icons';
import { FlowerNavigationIcon } from '../icons/FlowerSoftAuraIcon';
import { renderRedevenFilePreviewBody } from '../file-preview/rendererRegistry';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import type { FilePreviewDescriptor } from '../utils/filePreview';
import { readSelectionTextFromPreview } from '../utils/filePreviewSelection';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
import { FilePreviewErrorState } from './FilePreviewErrorState';
import { classifyFilePreviewError } from './filePreviewErrorUtils';
import { useI18n } from '../i18n';

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
  selectedText?: string;
  message?: string;
  objectUrl?: string;
  resourceUrl?: string;
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
  onDownload?: () => void;
  onAskFlower?: (selectionText: string) => void | Promise<void>;
  onRetry?: () => void;
}

const PREVIEW_HEADER_ICON_BUTTON_CLASS = [
  'inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent',
  'text-muted-foreground transition-colors duration-150',
  'hover:border-border/70 hover:bg-accent hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ');

export function FilePreviewContent(props: FilePreviewContentProps) {
  const i18n = useI18n();
  const resolvedError = () => props.error;
  const resolvedPath = () => String(props.item?.path ?? '').trim();
  const showHeader = () => props.showHeader !== false;
  const showEditorActions = () => (props.descriptor.mode === 'text' || props.descriptor.mode === 'markdown') && Boolean(props.canEdit);
  const [pathCopied, setPathCopied] = createSignal(false);
  let copyResetTimer: ReturnType<typeof globalThis.setTimeout> | undefined;
  let previewContentEl: HTMLDivElement | undefined;

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

  const handleAskFlower = () => {
    if (!props.onAskFlower || !props.item || props.loading) return;
    const selectionText = String(props.selectedText ?? '').trim() || readSelectionTextFromPreview(previewContentEl);
    void props.onAskFlower(selectionText);
  };

  return (
    <div class="flex h-full min-h-0 flex-col overflow-hidden">
      <Show when={showHeader()}>
        <div class="flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-2 sm:px-3">
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span class="hidden shrink-0 text-[11px] uppercase tracking-[0.08em] text-muted-foreground sm:inline">{i18n.t('filePreview.pathLabel')}</span>
            <span
              class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
              title={resolvedPath() || i18n.t('filePreview.unknownPath')}
            >
              {resolvedPath() || i18n.t('filePreview.unknownPath')}
            </span>
            <Show when={props.onCopyPath}>
              <button
                type="button"
                class={`${PREVIEW_HEADER_ICON_BUTTON_CLASS} ${
                  pathCopied() ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
                disabled={!resolvedPath()}
                aria-label={pathCopied() ? i18n.t('filePreview.pathCopied') : i18n.t('filePreview.copyPath')}
                title={pathCopied() ? i18n.t('filePreview.pathCopied') : i18n.t('filePreview.copyPath')}
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

          <div class="flex shrink-0 items-center justify-end gap-1">
            <Show when={showEditorActions() && !props.editing}>
              <button
                type="button"
                class={PREVIEW_HEADER_ICON_BUTTON_CLASS}
                aria-label={i18n.t('filePreview.editFile')}
                title={i18n.t('filePreview.editFile')}
                onClick={() => props.onStartEdit?.()}
              >
                <Pencil class="size-3.5" />
              </button>
            </Show>

            <Show when={showEditorActions() && props.editing}>
              <button
                type="button"
                class={PREVIEW_HEADER_ICON_BUTTON_CLASS}
                aria-label={i18n.t('filePreview.discardChanges')}
                title={i18n.t('filePreview.discardChanges')}
                disabled={props.saving}
                onClick={() => props.onDiscard?.()}
              >
                <X class="size-3.5" />
              </button>
              <button
                type="button"
                class={PREVIEW_HEADER_ICON_BUTTON_CLASS}
                aria-label={i18n.t('filePreview.saveFile')}
                title={i18n.t('filePreview.saveFile')}
                disabled={!props.dirty || props.saving}
                onClick={() => props.onSave?.()}
              >
                <Show when={props.saving} fallback={<Save class="size-3.5" />}>
                  <Loader2 class="size-3.5 animate-spin" />
                </Show>
              </button>
            </Show>

            <Show when={props.onAskFlower}>
              <button
                type="button"
                class={PREVIEW_HEADER_ICON_BUTTON_CLASS}
                aria-label={i18n.t('filePreview.askFlower')}
                title={i18n.t('filePreview.askFlower')}
                disabled={!props.item || props.loading}
                onClick={handleAskFlower}
              >
                <FlowerNavigationIcon class="size-5" />
              </button>
            </Show>

            <button
              type="button"
              class={PREVIEW_HEADER_ICON_BUTTON_CLASS}
              aria-label={i18n.t('filePreview.downloadFile')}
              title={i18n.t('filePreview.downloadFile')}
              disabled={!props.item || props.loading}
              onClick={() => props.onDownload?.()}
            >
              <Download class="size-3.5" />
            </button>
          </div>
        </div>
      </Show>

      <div
        ref={(element) => {
          previewContentEl = element;
          props.contentRef?.(element);
        }}
        {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
        class={cn('relative flex-1 min-h-0 overflow-auto', redevenSurfaceRoleClass('main'))}
      >
        <Show when={!resolvedError()}>
          {renderRedevenFilePreviewBody(props)}
        </Show>

        <Show when={resolvedError()}>
          <FilePreviewErrorState
            errorType={classifyFilePreviewError(resolvedError())}
            message={resolvedError()}
            onRetry={props.onRetry}
          />
        </Show>

        <RedevenLoadingCurtain
          visible={!!props.loading}
          eyebrow={i18n.t('filePreview.previewEyebrow')}
          message={props.message || i18n.t('filePreview.loadingFile')}
        />
      </div>
    </div>
  );
}
