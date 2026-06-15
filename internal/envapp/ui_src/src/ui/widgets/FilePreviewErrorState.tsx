import { Show, createSignal, type JSX } from 'solid-js';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  EyeOff,
  FileText,
  Lock,
  WifiOffIcon,
} from '@floegence/floe-webapp-core/icons';

import type { FilePreviewErrorType } from './filePreviewErrorUtils';
import { getFilePreviewErrorMeta } from './filePreviewErrorUtils';
import { useI18n } from '../i18n';

export type { FilePreviewErrorType } from './filePreviewErrorUtils';

export interface FilePreviewErrorStateProps {
  errorType: FilePreviewErrorType;
  message?: string | null;
  description?: string;
  onRetry?: () => void;
}

const ERROR_ICON: Record<FilePreviewErrorType, (props: { class?: string }) => JSX.Element> = {
  not_found: (p) => <FileText {...p} />,
  permission_denied: (p) => <Lock {...p} />,
  file_too_large: (p) => <AlertTriangle {...p} />,
  unsupported: (p) => <EyeOff {...p} />,
  render_error: (p) => <AlertCircle {...p} />,
  connection_error: (p) => <WifiOffIcon {...p} />,
  generic_error: (p) => <AlertCircle {...p} />,
};

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function FilePreviewErrorState(props: FilePreviewErrorStateProps) {
  const i18n = useI18n();
  const meta = () => getFilePreviewErrorMeta(props.errorType);
  const resolvedTitle = () => i18n.t(meta().titleKey);
  const resolvedDescription = () => props.description || i18n.t(meta().descriptionKey);
  const resolvedMessage = () => (props.message ?? '').trim();
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const renderIcon = () => {
    const Icon = ERROR_ICON[props.errorType];
    return <Icon class="h-6 w-6 text-error" />;
  };

  const handleCopy = async () => {
    const text = [resolvedTitle(), resolvedMessage() || resolvedDescription()]
      .filter(Boolean)
      .join(': ');
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div class="flex h-full flex-col items-center justify-center p-6 text-center">
      <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-error/10">
        {renderIcon()}
      </div>

      <div class="mt-4 text-sm font-semibold">{resolvedTitle()}</div>

      <Show when={resolvedDescription()}>
        <div class="mt-1 max-w-md text-xs text-muted-foreground">{resolvedDescription()}</div>
      </Show>

      <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Show when={resolvedMessage() || resolvedTitle()}>
          <button
            type="button"
            class={[
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5',
              'text-xs text-muted-foreground transition-colors duration-150',
              'hover:border-border hover:bg-accent hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            ].join(' ')}
            onClick={handleCopy}
          >
            <Show
              when={copied()}
              fallback={<Copy class="h-3 w-3" />}
            >
              <span class="text-[11px] font-medium text-primary">{i18n.t('chatChrome.copied')}</span>
            </Show>
            <span>{i18n.t('filePreview.copyErrorDetails')}</span>
          </button>
        </Show>

        <Show when={props.onRetry}>
          <button
            type="button"
            class={[
              'inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5',
              'text-xs text-muted-foreground transition-colors duration-150',
              'hover:border-border hover:bg-accent hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            ].join(' ')}
            onClick={() => props.onRetry?.()}
          >
            {i18n.t('chatChrome.retry')}
          </button>
        </Show>
      </div>

      <Show when={resolvedMessage()}>
        <button
          type="button"
          class={[
            'mt-4 inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1',
            'text-[11px] text-muted-foreground/70 transition-colors duration-150',
            'hover:bg-accent hover:text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          ].join(' ')}
          aria-expanded={detailsOpen()}
          onClick={() => setDetailsOpen((prev) => !prev)}
        >
          <Show when={detailsOpen()} fallback={<ChevronRight class="h-3 w-3" />}>
            <ChevronDown class="h-3 w-3" />
          </Show>
          {i18n.t('filePreview.technicalDetails')}
        </button>

        <Show when={detailsOpen()}>
          <div class="mt-2 max-w-lg rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-left">
            <code class="whitespace-pre-wrap break-all text-[11px] leading-relaxed text-muted-foreground font-mono">
              {resolvedMessage()}
            </code>
          </div>
        </Show>
      </Show>
    </div>
  );
}
