// Preview of attached files with remove buttons.

import { For, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import type { Attachment } from '../types';

export interface AttachmentPreviewProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

/**
 * Format file size into a human-readable string.
 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AttachmentPreview: Component<AttachmentPreviewProps> = (props) => {
  return (
    <div class="chat-attachment-preview">
      <For each={props.attachments}>
        {(att) => (
          <div class={cn('chat-attachment-item', att.error && 'chat-attachment-item-error')}>
            {/* Image thumbnail */}
            <Show when={att.type === 'image' && att.preview}>
              <img class="chat-attachment-image" src={att.preview} alt={att.file.name} />
            </Show>

            {/* File icon for non-image attachments */}
            <Show when={att.type === 'file'}>
              <div class="chat-attachment-file-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                </svg>
              </div>
            </Show>

            {/* File name and size info */}
            <div class="chat-attachment-info">
              <div class="chat-attachment-name">{att.file.name}</div>
              <div class="chat-attachment-size">{formatSize(att.file.size)}</div>
            </div>

            {/* Upload progress bar */}
            <Show when={att.status === 'uploading'}>
              <div class="chat-attachment-progress">
                <div
                  class="chat-attachment-progress-bar"
                  style={{ width: `${att.uploadProgress}%` }}
                />
              </div>
            </Show>

            {/* Error message */}
            <Show when={att.error}>
              <span class="chat-attachment-error">{att.error}</span>
            </Show>

            {/* Remove button */}
            <button
              class="chat-attachment-remove-btn"
              type="button"
              onClick={() => props.onRemove(att.id)}
              title="Remove attachment"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
      </For>
    </div>
  );
};
