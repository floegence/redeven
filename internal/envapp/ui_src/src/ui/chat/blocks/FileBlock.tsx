// FileBlock — file attachment display with download link.

import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface FileBlockProps {
  name: string;
  size: number;
  mimeType: string;
  url?: string;
  class?: string;
}

/**
 * Format a byte count into a human-readable file size string.
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = bytes / Math.pow(k, i);

  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Download arrow icon
const DownloadIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

/**
 * Renders a file attachment card with file name, size, and an optional
 * download link. Clicking the card opens the file URL if available.
 */
export const FileBlock: Component<FileBlockProps> = (props) => {
  const handleClick = () => {
    if (props.url) {
      window.open(props.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div
      class={cn(
        'chat-file-block',
        props.url && 'chat-file-block-clickable',
        props.class,
      )}
      onClick={handleClick}
      style={{ cursor: props.url ? 'pointer' : 'default' }}
      role={props.url ? 'link' : undefined}
    >
      <span class="chat-file-icon" aria-hidden="true">
        {'\uD83D\uDCC4'}
      </span>
      <div class="chat-file-info">
        <div class="chat-file-name">{props.name}</div>
        <div class="chat-file-meta">
          {formatFileSize(props.size)}
          {props.mimeType ? ` \u00B7 ${props.mimeType}` : ''}
        </div>
      </div>
      <Show when={props.url}>
        <span class="chat-file-download" aria-label="Download">
          <DownloadIcon />
        </span>
      </Show>
    </div>
  );
};
