import { For, Show } from 'solid-js';

import type { CodexDispatchingInput, CodexQueuedFollowup } from './types';

const queuedTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

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

function pendingInputMeta(item: {
  runtime_config: { model?: string };
  attachments: readonly unknown[];
  mentions: readonly unknown[];
  created_at_unix_ms: number;
}): string {
  const parts: string[] = [];
  const model = String(item.runtime_config.model ?? '').trim();
  if (model) parts.push(model);
  if (item.attachments.length > 0) {
    parts.push(item.attachments.length === 1 ? '1 image' : `${item.attachments.length} images`);
  }
  if (item.mentions.length > 0) {
    parts.push(item.mentions.length === 1 ? '1 file' : `${item.mentions.length} files`);
  }
  if (item.created_at_unix_ms > 0) {
    parts.push(queuedTimeFormatter.format(new Date(item.created_at_unix_ms)));
  }
  return parts.join(' · ');
}

function dispatchingLabel(item: CodexDispatchingInput): string {
  return item.source === 'auto_send'
    ? 'Starting the next turn'
    : 'Appending to the current turn';
}

function queuedLabel(item: CodexQueuedFollowup): string {
  return item.source === 'rejected_steer'
    ? 'Saved after same-turn send was rejected'
    : item.source === 'auto_send'
      ? 'Returned to the queue after auto-send failed'
      : 'Waiting for the current turn to finish';
}

export function CodexPendingInputsPanel(props: {
  dispatchingItems: readonly CodexDispatchingInput[];
  queuedItems: readonly CodexQueuedFollowup[];
  onRestoreQueued: (followupID: string) => void;
  onRemoveQueued: (followupID: string) => void;
  onMoveQueued: (followupID: string, delta: number) => void;
}) {
  const totalCount = () => props.dispatchingItems.length + props.queuedItems.length;

  return (
    <div class="codex-pending-inputs-panel" aria-label="Pending Codex inputs">
      <div class="codex-pending-inputs-header">
        <div class="codex-pending-inputs-heading">
          <span class="codex-pending-inputs-kicker">Pending input</span>
          <div class="codex-pending-inputs-title-row">
            <span class="codex-pending-inputs-title">Ready above the composer</span>
            <span class="codex-pending-inputs-count">{totalCount()}</span>
          </div>
        </div>
        <div class="codex-pending-inputs-hint">
          Accepted prompts stay here until Codex appends them to the transcript or starts the next turn.
        </div>
      </div>

      <Show when={props.dispatchingItems.length > 0}>
        <section class="codex-pending-inputs-section" aria-label="Dispatching inputs">
          <div class="codex-pending-inputs-section-header">
            <span class="codex-pending-inputs-section-kicker">Sending</span>
            <span class="codex-pending-inputs-section-title">{props.dispatchingItems.length}</span>
          </div>
          <div class="codex-pending-inputs-list" role="list">
            <For each={props.dispatchingItems}>
              {(item) => (
                <div class="codex-pending-input-card codex-pending-input-card-dispatching" role="listitem">
                  <div class="codex-pending-input-card-copy">
                    <div class="codex-pending-input-card-state">{dispatchingLabel(item)}</div>
                    <div class="codex-pending-input-card-preview" title={pendingInputPreview(item)}>
                      {pendingInputPreview(item)}
                    </div>
                    <Show when={pendingInputMeta(item)}>
                      <div class="codex-pending-input-card-meta">{pendingInputMeta(item)}</div>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={props.queuedItems.length > 0}>
        <section class="codex-pending-inputs-section" aria-label="Queued inputs">
          <div class="codex-pending-inputs-section-header">
            <span class="codex-pending-inputs-section-kicker">Queued next</span>
            <span class="codex-pending-inputs-section-title">{props.queuedItems.length}</span>
          </div>
          <div class="codex-pending-inputs-list" role="list">
            <For each={props.queuedItems}>
              {(item, index) => (
                <div class="codex-pending-input-card" role="listitem">
                  <div class="codex-pending-input-card-order" aria-hidden="true">{index() + 1}</div>
                  <div class="codex-pending-input-card-copy">
                    <div class="codex-pending-input-card-state">{queuedLabel(item)}</div>
                    <div class="codex-pending-input-card-preview" title={pendingInputPreview(item)}>
                      {pendingInputPreview(item)}
                    </div>
                    <Show when={pendingInputMeta(item)}>
                      <div class="codex-pending-input-card-meta">{pendingInputMeta(item)}</div>
                    </Show>
                  </div>
                  <div class="codex-pending-input-card-actions">
                    <Show when={props.queuedItems.length > 1}>
                      <button
                        type="button"
                        class="codex-pending-input-card-action"
                        onClick={() => props.onMoveQueued(item.id, -1)}
                        disabled={index() === 0}
                        title="Move queued input earlier"
                      >
                        Earlier
                      </button>
                      <button
                        type="button"
                        class="codex-pending-input-card-action"
                        onClick={() => props.onMoveQueued(item.id, 1)}
                        disabled={index() === props.queuedItems.length - 1}
                        title="Move queued input later"
                      >
                        Later
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="codex-pending-input-card-action"
                      onClick={() => props.onRestoreQueued(item.id)}
                      title="Restore queued input to composer"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      class="codex-pending-input-card-action codex-pending-input-card-action-danger"
                      onClick={() => props.onRemoveQueued(item.id)}
                      title="Remove queued input"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>
    </div>
  );
}
