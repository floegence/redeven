import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Check, Copy, Download, Loader2, Pencil, Save, X } from '@floegence/floe-webapp-core/icons';
import { FlowerNavigationIcon } from '../icons/FlowerSoftAuraIcon';
import { readSelectionTextFromPreview } from '../utils/filePreviewSelection';
import { useI18n } from '../i18n';
import type { FilePreviewContentProps } from './FilePreviewContent';

export interface FilePreviewActionsProps extends Pick<FilePreviewContentProps,
  'item' | 'descriptor' | 'canEdit' | 'editing' | 'dirty' | 'saving' | 'loading' | 'selectedText'
  | 'onCopyPath' | 'onStartEdit' | 'onSave' | 'onDiscard' | 'onAskFlower' | 'onDownload'
> {
  compact?: boolean;
  contentElement?: HTMLDivElement;
}

const PREVIEW_HEADER_ICON_BUTTON_CLASS = [
  'inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent',
  'text-muted-foreground transition-colors duration-150',
  'hover:border-border/70 hover:bg-accent hover:text-foreground',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ');

export function FilePreviewActions(props: FilePreviewActionsProps) {
  const i18n = useI18n();
  const resolvedPath = () => String(props.item?.path ?? '').trim();
  const buttonClass = () => cn(PREVIEW_HEADER_ICON_BUTTON_CLASS, props.compact ? 'size-7' : 'size-8');
  const showEditorActions = () => (props.descriptor.mode === 'text' || props.descriptor.mode === 'markdown') && Boolean(props.canEdit);
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

  const handleAskFlower = () => {
    if (!props.onAskFlower || !props.item || props.loading) return;
    const selectionText = String(props.selectedText ?? '').trim() || readSelectionTextFromPreview(props.contentElement);
    void props.onAskFlower(selectionText);
  };

  return (
    <div class="flex shrink-0 items-center justify-end gap-1">
      <Show when={props.onCopyPath}>
        <button
          type="button"
          class={`${buttonClass()} ${
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
      <Show when={showEditorActions() && !props.editing}>
        <button
          type="button"
          class={buttonClass()}
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
          class={buttonClass()}
          aria-label={i18n.t('filePreview.discardChanges')}
          title={i18n.t('filePreview.discardChanges')}
          disabled={props.saving}
          onClick={() => props.onDiscard?.()}
        >
          <X class="size-3.5" />
        </button>
        <button
          type="button"
          class={buttonClass()}
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
          class={buttonClass()}
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
        class={buttonClass()}
        aria-label={i18n.t('filePreview.downloadFile')}
        title={i18n.t('filePreview.downloadFile')}
        disabled={!props.item || props.loading}
        onClick={() => props.onDownload?.()}
      >
        <Download class="size-3.5" />
      </button>
    </div>
  );
}
