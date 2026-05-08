import { Show, createMemo } from 'solid-js';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import { Button, ConfirmDialog } from '@floegence/floe-webapp-core/ui';

import type { FilePreviewDescriptor } from '../utils/filePreview';
import { FilePreviewContent } from './FilePreviewContent';
import { WindowModal } from './WindowModal';

export interface FilePreviewPanelProps {
  item?: FileItem | null;
  descriptor: FilePreviewDescriptor;
  text?: string;
  draftText?: string;
  editing?: boolean;
  dirty?: boolean;
  saving?: boolean;
  saveError?: string | null;
  canEdit?: boolean;
  selectedText?: string;
  closeConfirmOpen?: boolean;
  closeConfirmMessage?: string;
  onCloseConfirmChange?: (open: boolean) => void;
  onConfirmDiscardClose?: () => void | Promise<void>;
  onStartEdit?: () => void;
  onDraftChange?: (value: string) => void;
  onSelectionChange?: (selectionText: string) => void;
  onSave?: () => void | Promise<void>;
  onDiscard?: () => void;
  message?: string;
  objectUrl?: string;
  bytes?: Uint8Array<ArrayBuffer> | null;
  truncated?: boolean;
  loading?: boolean;
  error?: string | null;
  xlsxSheetName?: string;
  xlsxRows?: string[][];
  onCopyPath?: () => boolean | Promise<boolean>;
  downloadLoading?: boolean;
  onDownload?: () => void;
  onAskFlower?: (selectionText: string) => void | Promise<void>;
  closeConfirmVariant?: 'dialog' | 'floating' | 'none';
  closeConfirmHost?: HTMLElement | null;
}

export function FilePreviewPanel(props: FilePreviewPanelProps) {
  const closeConfirmVariant = createMemo(() => props.closeConfirmVariant ?? 'none');

  const closeConfirmFooter = (
    <div class="border-t border-border/70 px-4 pt-3 pb-4">
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
        <Button size="sm" variant="outline" class="w-full sm:w-auto" onClick={() => props.onCloseConfirmChange?.(false)}>
          Cancel
        </Button>
        <Button size="sm" variant="destructive" class="w-full sm:w-auto" onClick={() => void props.onConfirmDiscardClose?.()}>
          Discard changes
        </Button>
      </div>
    </div>
  );

  return (
    <>
      <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <div class="min-h-0 flex-1 overflow-hidden">
          <FilePreviewContent
            item={props.item}
            descriptor={props.descriptor}
            text={props.text}
            draftText={props.draftText}
            editing={props.editing}
            dirty={props.dirty}
            saving={props.saving}
            saveError={props.saveError}
            canEdit={props.canEdit}
            selectedText={props.selectedText}
            message={props.message}
            objectUrl={props.objectUrl}
            bytes={props.bytes}
            truncated={props.truncated}
            loading={props.loading}
            error={props.error}
            xlsxSheetName={props.xlsxSheetName}
            xlsxRows={props.xlsxRows}
            onCopyPath={props.onCopyPath}
            onStartEdit={props.onStartEdit}
            onDraftChange={props.onDraftChange}
            onSelectionChange={props.onSelectionChange}
            onSave={props.onSave}
            onDiscard={props.onDiscard}
            downloadLoading={props.downloadLoading}
            onDownload={props.onDownload}
            onAskFlower={props.onAskFlower}
          />
        </div>
      </div>

      <Show when={closeConfirmVariant() === 'dialog'}>
        <ConfirmDialog
          open={!!props.closeConfirmOpen}
          onOpenChange={(open) => props.onCloseConfirmChange?.(open)}
          title="Discard unsaved changes?"
          description={props.closeConfirmMessage || 'Discard the current edits before continuing.'}
          confirmText="Discard changes"
          variant="destructive"
          onConfirm={() => void props.onConfirmDiscardClose?.()}
        />
      </Show>

      <Show when={closeConfirmVariant() === 'floating'}>
        <WindowModal
          open={!!props.closeConfirmOpen}
          host={props.closeConfirmHost ?? null}
          title="Discard unsaved changes?"
          description={props.closeConfirmMessage || 'Discard the current edits before continuing.'}
          footer={closeConfirmFooter}
          class="w-[min(30rem,calc(100%-1rem))]"
          onOpenChange={(open) => props.onCloseConfirmChange?.(open)}
        />
      </Show>
    </>
  );
}
