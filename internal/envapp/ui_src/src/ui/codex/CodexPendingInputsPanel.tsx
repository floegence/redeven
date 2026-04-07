import { For, Show, type Component } from 'solid-js';

import type { CodexDispatchingInput, CodexQueuedFollowup } from './types';

function pendingInputPreview(item: {
  text: string;
  attachments: readonly unknown[];
  mentions: readonly unknown[];
}): string {
  const text = String(item.text ?? '').trim();
  if (text) return text;
  if (item.attachments.length > 0 && item.mentions.length > 0) {
    return 'Attachment and file context';
  }
  if (item.attachments.length > 0) {
    return 'Attachment context';
  }
  if (item.mentions.length > 0) {
    return 'File context';
  }
  return 'Pending input';
}

function dispatchingLabel(item: CodexDispatchingInput): string {
  return item.source === 'auto_send'
    ? 'Sending'
    : 'Guiding';
}

function queuedLabel(item: CodexQueuedFollowup): string {
  return item.source === 'rejected_steer'
    ? 'Guide unavailable'
    : item.source === 'auto_send'
      ? 'Retry queued'
      : 'Queued';
}

export function CodexPendingInputsPanel(props: {
  dispatchingItems: readonly CodexDispatchingInput[];
  queuedItems: readonly CodexQueuedFollowup[];
  canGuideQueued: boolean;
  guideQueuedDisabledReason: string;
  onGuideQueued: (followupID: string) => void;
  onRestoreQueued: (followupID: string) => void;
  onRemoveQueued: (followupID: string) => void;
  onMoveQueued: (followupID: string, delta: number) => void;
}) {
  const guideTitle = () => (
    String(props.guideQueuedDisabledReason ?? '').trim() || 'Guide queued input into the current turn'
  );

  return (
    <div class="codex-pending-inputs-panel" aria-label="Pending Codex inputs">
      <div class="codex-pending-inputs-list" role="list">
        <For each={props.dispatchingItems}>
          {(item) => {
            const preview = pendingInputPreview(item);
            return (
              <div class="codex-pending-input-card codex-pending-input-card-dispatching" role="listitem">
                <div class="codex-pending-input-card-main codex-pending-input-card-main-static">
                  <span class="codex-pending-input-card-order" aria-hidden="true">
                    <QueuePromptIcon />
                  </span>
                  <span class="codex-pending-input-card-copy">
                    <span class="codex-pending-input-card-headline">
                      <span class="codex-pending-input-card-badge" data-codex-pending-tone="dispatching">
                        {dispatchingLabel(item)}
                      </span>
                      <span class="codex-pending-input-card-preview" title={preview}>
                        {preview}
                      </span>
                    </span>
                  </span>
                </div>
              </div>
            );
          }}
        </For>

        <For each={props.queuedItems}>
          {(item, index) => {
            const preview = pendingInputPreview(item);
            const tone = item.source === 'rejected_steer' ? 'blocked' : 'queued';
            return (
              <div class="codex-pending-input-card codex-pending-input-card-queued" role="listitem">
                <button
                  type="button"
                  class="codex-pending-input-card-main"
                  onClick={() => props.onRestoreQueued(item.id)}
                  title="Restore queued input to the composer"
                >
                  <span class="codex-pending-input-card-order" aria-hidden="true">
                    <QueuePromptIcon />
                  </span>
                  <span class="codex-pending-input-card-copy">
                    <span class="codex-pending-input-card-headline">
                      <span class="codex-pending-input-card-badge" data-codex-pending-tone={tone}>
                        {queuedLabel(item)}
                      </span>
                      <span class="codex-pending-input-card-preview" title={preview}>
                        {preview}
                      </span>
                    </span>
                  </span>
                </button>
                <div class="codex-pending-input-card-actions">
                  <Show when={props.queuedItems.length > 1}>
                    <button
                      type="button"
                      class="codex-pending-input-card-icon-action"
                      onClick={() => props.onMoveQueued(item.id, -1)}
                      disabled={index() === 0}
                      title="Move queued input earlier"
                      aria-label="Move queued input earlier"
                    >
                      <ChevronUpIcon />
                    </button>
                    <button
                      type="button"
                      class="codex-pending-input-card-icon-action"
                      onClick={() => props.onMoveQueued(item.id, 1)}
                      disabled={index() === props.queuedItems.length - 1}
                      title="Move queued input later"
                      aria-label="Move queued input later"
                    >
                      <ChevronDownIcon />
                    </button>
                  </Show>
                  <button
                    type="button"
                    class="codex-pending-input-card-action codex-pending-input-card-action-guide"
                    onClick={() => props.onGuideQueued(item.id)}
                    disabled={!props.canGuideQueued}
                    title={guideTitle()}
                  >
                    Guide
                  </button>
                  <button
                    type="button"
                    class="codex-pending-input-card-icon-action codex-pending-input-card-icon-action-danger"
                    onClick={() => props.onRemoveQueued(item.id)}
                    title="Remove queued input"
                    aria-label="Remove queued input"
                  >
                    <TrashIcon />
                  </button>
                </div>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

const QueuePromptIcon: Component = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    <path d="M7 7h7a3 3 0 0 1 3 3v1" />
    <path d="M10 14H7a3 3 0 0 1-3-3V7" />
    <path d="m13 14 4 0" />
    <path d="m15.5 11.5 2.5 2.5-2.5 2.5" />
  </svg>
);

const ChevronUpIcon: Component = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="m6 14 6-6 6 6" />
  </svg>
);

const ChevronDownIcon: Component = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="m6 10 6 6 6-6" />
  </svg>
);

const TrashIcon: Component = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);
