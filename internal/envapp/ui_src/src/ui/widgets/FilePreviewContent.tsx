import { Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { renderRedevenFilePreviewBody } from '../file-preview/rendererRegistry';
import { RedevenLoadingCurtain } from '../primitives/RedevenLoadingCurtain';
import type { FilePreviewDescriptor, FilePreviewSurface } from '../utils/filePreview';
import { redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';
import { REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchTextSelectionSurface';
import { FilePreviewErrorState } from './FilePreviewErrorState';
import { classifyFilePreviewError } from './filePreviewErrorUtils';
import { useI18n } from '../i18n';
import { FilePreviewActions } from './FilePreviewActions';

export interface FilePreviewContentProps {
  /** Surface ownership for the preview shell. Window is reserved for desktop floating hosts. */
  surface?: FilePreviewSurface;
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

export function FilePreviewContent(props: FilePreviewContentProps) {
  const i18n = useI18n();
  const resolvedError = () => props.error;
  const resolvedPath = () => String(props.item?.path ?? '').trim();
  const showHeader = () => props.showHeader !== false;
  let previewContentEl: HTMLDivElement | undefined;

  return (
    <div class={cn('redeven-file-preview', props.surface === 'window' && 'redeven-file-preview-surface-window', 'flex h-full min-h-0 flex-col overflow-hidden')}>
      <Show when={showHeader()}>
        <div class={cn('redeven-file-preview-toolbar flex shrink-0 items-center gap-2 border-b border-border px-2.5 py-2 sm:px-3', props.surface === 'window' && 'redeven-file-preview-toolbar-window')}>
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span class="hidden shrink-0 text-[11px] uppercase tracking-[0.08em] text-muted-foreground sm:inline">{i18n.t('filePreview.pathLabel')}</span>
            <span
              class="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
              title={resolvedPath() || i18n.t('filePreview.unknownPath')}
            >
              {resolvedPath() || i18n.t('filePreview.unknownPath')}
            </span>
          </div>
          <FilePreviewActions {...props} contentElement={previewContentEl} />
        </div>
      </Show>

      <div
        ref={(element) => {
          previewContentEl = element;
          props.contentRef?.(element);
        }}
        {...REDEVEN_WORKBENCH_TEXT_SELECTION_SCROLL_VIEWPORT_PROPS}
        class={cn('relative flex-1 min-h-0 overflow-auto', props.surface === 'window' ? 'redeven-file-preview-surface-window' : redevenSurfaceRoleClass('main'))}
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
