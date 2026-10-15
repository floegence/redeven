import { Show, createSignal, onCleanup } from 'solid-js';
import { ChevronDown, ChevronRight, Copy, Check, Loader2 } from '@floegence/floe-webapp-core/icons';
import { useI18n } from '../i18n';
import { writeTextToClipboard } from '../utils/clipboard';
import { getFilePreviewErrorMeta, type FilePreviewErrorType } from './filePreviewErrorUtils';

export type { FilePreviewErrorType } from './filePreviewErrorUtils';

export interface FilePreviewErrorStateProps {
  errorType: FilePreviewErrorType;
  message?: string | null;
  description?: string;
  path?: string;
  busy?: boolean;
  onRetry?: () => void;
  onOpenParent?: () => void | Promise<void>;
  onCopyPath?: () => boolean | Promise<boolean>;
}

export function FilePreviewErrorState(props: FilePreviewErrorStateProps) {
  const i18n = useI18n();
  const meta = () => getFilePreviewErrorMeta(props.errorType);
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [pathCopied, setPathCopied] = createSignal(false);
  const [openingParent, setOpeningParent] = createSignal(false);
  const [actionError, setActionError] = createSignal('');
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(copiedTimer));

  const handleOpenParent = async () => {
    if (openingParent()) return;
    setOpeningParent(true);
    setActionError('');
    try {
      await props.onOpenParent?.();
    } catch {
      setActionError(i18n.t('filePreview.errorGenericDescription'));
    } finally {
      setOpeningParent(false);
    }
  };

  const handleCopyPath = async () => {
    setActionError('');
    try {
      if (props.onCopyPath) {
        if (!await props.onCopyPath()) return;
      } else {
        await writeTextToClipboard(props.path!);
      }
      setPathCopied(true);
      clearTimeout(copiedTimer);
      copiedTimer = setTimeout(() => setPathCopied(false), 1600);
    } catch {
      setActionError(i18n.t('shell.notifications.clipboardCopyFailed'));
    }
  };

  return (
    <div
      class="flex h-full min-w-0 items-center justify-center overflow-auto p-6"
      aria-busy={props.busy ?? false}
      data-testid="file-preview-recovery"
    >
      <div class="w-full min-w-0 max-w-md text-left">
        <h2 class="text-sm font-medium">{i18n.t(meta().titleKey)}</h2>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">
          {props.description || i18n.t(meta().descriptionKey)}
        </p>

        <Show when={props.path}>
          <div class="mt-3 flex min-w-0 items-center gap-1.5">
            <code class="min-w-0 flex-1 select-text truncate text-xs text-muted-foreground" title={props.path}>
              {props.path}
            </code>
            <button
              type="button"
              class="inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label={i18n.t('filePreview.copyPath')}
              title={i18n.t(pathCopied() ? 'filePreview.pathCopied' : 'filePreview.copyPath')}
              onClick={() => void handleCopyPath()}
            >
              <Show when={pathCopied()} fallback={<Copy class="size-3.5" aria-hidden="true" />}>
                <Check class="size-3.5" aria-hidden="true" />
              </Show>
            </button>
            <span class="sr-only" role="status">{pathCopied() ? i18n.t('filePreview.pathCopied') : ''}</span>
          </div>
        </Show>

        <div class="mt-4 flex flex-wrap items-center gap-2">
          <Show when={props.onRetry}>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
              classList={{ 'cursor-wait': !!props.busy }}
              aria-disabled={props.busy}
              aria-busy={props.busy}
              onClick={() => { if (!props.busy) props.onRetry?.(); }}
            >
              <span class="inline-flex size-3 items-center justify-center" aria-hidden="true">
                <Show when={props.busy}><Loader2 class="size-3 animate-spin" /></Show>
              </span>
              {i18n.t('chatChrome.retry')}
            </button>
          </Show>
          <Show when={props.onOpenParent}>
            <button
              type="button"
              class="inline-flex cursor-pointer items-center whitespace-nowrap rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              classList={{ 'cursor-wait': openingParent() }}
              aria-disabled={openingParent()}
              aria-busy={openingParent()}
              onClick={() => void handleOpenParent()}
            >
              {i18n.t('files.navigationFailure.openParent')}
            </button>
          </Show>
        </div>

        <Show when={actionError()}>
          <p class="mt-2 text-xs text-muted-foreground" role="status">{actionError()}</p>
        </Show>

        <Show when={props.message?.trim()}>
          <button
            type="button"
            class="mt-4 inline-flex cursor-pointer items-center gap-1 whitespace-nowrap py-1 text-[11px] text-muted-foreground/70 hover:text-foreground"
            aria-expanded={detailsOpen()}
            onClick={() => setDetailsOpen(value => !value)}
          >
            <Show when={detailsOpen()} fallback={<ChevronRight class="size-3" aria-hidden="true" />}>
              <ChevronDown class="size-3" aria-hidden="true" />
            </Show>
            {i18n.t('filePreview.technicalDetails')}
          </button>
          <Show when={detailsOpen()}>
            <pre class="mt-2 select-text whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground">
              {[props.path, props.message].filter(Boolean).join('\n')}
            </pre>
          </Show>
        </Show>
      </div>
    </div>
  );
}
