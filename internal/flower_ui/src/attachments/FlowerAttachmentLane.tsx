import type { Component } from 'solid-js';
import { createEffect, createSignal, Index, Show } from 'solid-js';
import { FileText, FolderOpen, Refresh, XCircle } from '@floegence/floe-webapp-core/icons';

import type { FlowerAttachmentItem } from './createFlowerAttachmentController';

export type FlowerAttachmentLaneCopy = Readonly<{
  listLabel: string;
  retry: string;
  reselect: string;
  cancel: string;
  remove: string;
  restore: string;
  preview: string;
  copyReference: string;
  uploading: string;
  queued: string;
  ready: string;
  failed: string;
  incompatible: string;
  reselectRequired: string;
  errorTooLarge: string;
  errorCountExceeded: string;
  errorTotalSizeExceeded: string;
  errorUnsupported: string;
  errorInvalidEncoding: string;
  errorUploadFailed: string;
  errorUnavailable: string;
  lines: (count: number) => string;
  added: (name: string) => string;
  converted: (name: string) => string;
  uploaded: (name: string) => string;
  uploadFailedAnnouncement: (name: string) => string;
}>;

export type FlowerAttachmentLaneProps = Readonly<{
  items: readonly FlowerAttachmentItem[];
  copy: FlowerAttachmentLaneCopy;
  locale?: string;
  disabled?: boolean;
  onRetry: (localID: string) => void;
  onReselect: (localID: string) => void;
  onCancel: (localID: string) => void;
  onRemove: (localID: string) => void;
  onRestore: (localID: string) => void;
  onPreview?: (item: FlowerAttachmentItem) => void;
  onFocusFallback?: () => void;
}>;

function formatIECBytes(bytes: number, locale?: string): string {
  const normalized = Math.max(0, Number(bytes) || 0);
  const units = ['B', 'KiB', 'MiB', 'GiB'] as const;
  let value = normalized;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: unit === 0 ? 0 : value < 10 ? 1 : 0,
  });
  return `${formatter.format(value)} ${units[unit]}`;
}

function itemStatus(item: FlowerAttachmentItem, copy: FlowerAttachmentLaneCopy): string {
  switch (item.status) {
    case 'local_validating':
    case 'queued': return copy.queued;
    case 'uploading': return copy.uploading;
    case 'staged_ready': return copy.ready;
    case 'incompatible': return copy.incompatible;
    case 'reselect_required': return copy.reselectRequired;
    case 'validation_error':
    case 'upload_error': return copy.failed;
  }
}

function itemError(item: FlowerAttachmentItem, copy: FlowerAttachmentLaneCopy): string {
  switch (item.error_code) {
    case 'attachment_too_large': return copy.errorTooLarge;
    case 'attachment_count_exceeded': return copy.errorCountExceeded;
    case 'attachment_total_size_exceeded': return copy.errorTotalSizeExceeded;
    case 'attachment_unsupported': return copy.errorUnsupported;
    case 'attachment_invalid_text_encoding': return copy.errorInvalidEncoding;
    case 'attachment_upload_failed': return copy.errorUploadFailed;
    case 'attachment_unavailable': return copy.errorUnavailable;
    case 'attachment_restore_failed': return copy.errorUploadFailed;
    default: return '';
  }
}

export const FlowerAttachmentLane: Component<FlowerAttachmentLaneProps> = (props) => {
  const itemButtons = new Map<string, HTMLButtonElement>();
  const [announcement, setAnnouncement] = createSignal<Readonly<{ id: number; text: string }> | null>(null);
  let announcementID = 0;
  let previousStatuses = new Map<string, FlowerAttachmentItem['status']>();
  createEffect(() => {
    const messages: string[] = [];
    const currentStatuses = new Map<string, FlowerAttachmentItem['status']>();
    for (const item of props.items) {
      const previous = previousStatuses.get(item.local_id);
      currentStatuses.set(item.local_id, item.status);
      if (!previous && (item.status === 'upload_error' || item.status === 'validation_error')) {
        messages.push(props.copy.uploadFailedAnnouncement(item.name));
      } else if (!previous) {
        messages.push(item.source === 'long_text' ? props.copy.converted(item.name) : props.copy.added(item.name));
      } else if (previous !== item.status && item.status === 'staged_ready') {
        messages.push(props.copy.uploaded(item.name));
      } else if (previous !== item.status && (item.status === 'upload_error' || item.status === 'validation_error')) {
        messages.push(props.copy.uploadFailedAnnouncement(item.name));
      }
    }
    previousStatuses = currentStatuses;
    if (messages.length > 0) setAnnouncement({ id: ++announcementID, text: messages.join(' ') });
  });
  const removeWithFocus = (localID: string) => {
    const index = props.items.findIndex((item) => item.local_id === localID);
    const nextID = props.items[index + 1]?.local_id ?? props.items[index - 1]?.local_id;
    props.onRemove(localID);
    queueMicrotask(() => {
      if (nextID) itemButtons.get(nextID)?.focus();
      else props.onFocusFallback?.();
    });
  };

  return (
    <div class="flower-attachment-lane" role="list" aria-label={props.copy.listLabel}>
      <Show when={announcement()} keyed>
        {(message) => (
          <span
            class="flower-visually-hidden"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            data-announcement-id={message.id}
          >
            {message.text}
          </span>
        )}
      </Show>
      <Index each={props.items}>
        {(item) => {
          const status = () => itemStatus(item(), props.copy);
          const error = () => itemError(item(), props.copy);
          const errorDescriptionID = () => `flower-attachment-error-${item().local_id}`;
          const previewable = () => Boolean(item().staged && props.onPreview);
          const attachmentSummary = () => (
            <>
              <span class="flower-attachment-file-icon" aria-hidden="true"><FileText /></span>
              <span class="flower-attachment-body">
                <span class="flower-attachment-name" title={item().name}>{item().name}</span>
                <span class="flower-attachment-meta">
                  <span>{formatIECBytes(item().size_bytes, props.locale)}</span>
                  <Show when={item().text_stats}><span>{props.copy.lines(item().text_stats!.lines)}</span></Show>
                  <span>{item().mime_type}</span>
                  <span data-attachment-status-label>{status()}</span>
                </span>
                <Show when={item().status === 'uploading'}>
                  <Show
                    when={!item().progress_indeterminate && item().total_bytes !== undefined}
                    fallback={<span class="flower-attachment-progress-indeterminate" role="status">{props.copy.uploading}</span>}
                  >
                    <progress
                      class="flower-attachment-progress"
                      max={item().total_bytes}
                      value={item().loaded_bytes}
                      aria-label={`${item().name}: ${props.copy.uploading}`}
                    />
                  </Show>
                </Show>
                <Show when={item().error_code}>
                  <span id={errorDescriptionID()} class="flower-attachment-error">{error()}</span>
                </Show>
              </span>
            </>
          );
          return (
            <div
              class="flower-attachment-item"
              role="listitem"
              data-attachment-status={item().status}
              aria-label={[
                item().name,
                formatIECBytes(item().size_bytes, props.locale),
                item().text_stats ? props.copy.lines(item().text_stats!.lines) : '',
                item().mime_type,
                status(),
              ].filter(Boolean).join(', ')}
              aria-describedby={item().error_code ? errorDescriptionID() : undefined}
            >
              <Show
                when={previewable()}
                fallback={<div class="flower-attachment-preview-trigger" data-disabled="true">{attachmentSummary()}</div>}
              >
                <button
                  type="button"
                  class="flower-attachment-preview-trigger"
                  aria-label={`${props.copy.preview}: ${item().name}`}
                  title={`${props.copy.preview}: ${item().name}`}
                  disabled={props.disabled}
                  onClick={() => props.onPreview?.(item())}
                >
                  {attachmentSummary()}
                </button>
              </Show>
              <span class="flower-attachment-actions">
                <Show when={item().source === 'long_text'}>
                  <button
                    type="button"
                    class="flower-attachment-icon-button"
                    aria-label={props.copy.restore}
                    title={props.copy.restore}
                    disabled={props.disabled}
                    onClick={() => props.onRestore(item().local_id)}
                  >
                    <Refresh aria-hidden="true" />
                  </button>
                </Show>
                <Show when={item().status === 'uploading' || item().status === 'queued'}>
                  <button
                    ref={(node) => itemButtons.set(item().local_id, node)}
                    type="button"
                    class="flower-attachment-icon-button"
                    aria-label={props.copy.cancel}
                    title={props.copy.cancel}
                    disabled={props.disabled}
                    onClick={() => props.onCancel(item().local_id)}
                  ><XCircle /></button>
                </Show>
                <Show when={item().status === 'upload_error'}>
                  <button
                    ref={(node) => itemButtons.set(item().local_id, node)}
                    type="button"
                    class="flower-attachment-icon-button"
                    aria-label={props.copy.retry}
                    title={props.copy.retry}
                    disabled={props.disabled}
                    onClick={() => props.onRetry(item().local_id)}
                  ><Refresh /></button>
                </Show>
                <Show when={item().status === 'reselect_required'}>
                  <button
                    ref={(node) => itemButtons.set(item().local_id, node)}
                    type="button"
                    class="flower-attachment-icon-button"
                    aria-label={props.copy.reselect}
                    title={props.copy.reselect}
                    disabled={props.disabled}
                    onClick={() => props.onReselect(item().local_id)}
                  >
                    <FolderOpen aria-hidden="true" />
                  </button>
                </Show>
                <button
                  ref={(node) => itemButtons.set(item().local_id, node)}
                  type="button"
                  class="flower-attachment-icon-button"
                  aria-label={props.copy.remove}
                  title={props.copy.remove}
                  disabled={props.disabled}
                  onClick={() => removeWithFocus(item().local_id)}
                ><XCircle /></button>
              </span>
            </div>
          );
        }}
      </Index>
    </div>
  );
};
