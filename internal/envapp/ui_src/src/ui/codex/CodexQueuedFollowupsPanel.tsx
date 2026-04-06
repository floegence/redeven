import { For, Show } from 'solid-js';

import type { CodexQueuedFollowup } from './types';

const queuedTimeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

function followupPreview(item: CodexQueuedFollowup): string {
  const text = String(item.text ?? '').trim();
  if (text) return text;
  if (item.attachments.length > 0 && item.mentions.length > 0) {
    return 'Attachment and file context follow-up';
  }
  if (item.attachments.length > 0) {
    return 'Attachment follow-up';
  }
  if (item.mentions.length > 0) {
    return 'File context follow-up';
  }
  return 'Queued follow-up';
}

function followupMeta(item: CodexQueuedFollowup): string {
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

export function CodexQueuedFollowupsPanel(props: {
  items: readonly CodexQueuedFollowup[];
  onRestore: (followupID: string) => void;
  onRemove: (followupID: string) => void;
  onMove: (followupID: string, delta: number) => void;
}) {
  return (
    <div class="codex-queued-followups-panel">
      <div class="codex-queued-followups-header">
        <div class="codex-queued-followups-title-row">
          <span class="codex-queued-followups-title">Queued follow-ups</span>
          <span class="codex-queued-followups-count">{props.items.length}</span>
        </div>
        <div class="codex-queued-followups-hint">Queued messages start the next turn automatically when this thread becomes idle.</div>
      </div>

      <div class="codex-queued-followups-list">
        <For each={props.items}>
          {(item, index) => (
            <div class="codex-queued-followup-card">
              <div class="codex-queued-followup-copy">
                <div class="codex-queued-followup-preview" title={followupPreview(item)}>{followupPreview(item)}</div>
                <Show when={followupMeta(item)}>
                  <div class="codex-queued-followup-meta">{followupMeta(item)}</div>
                </Show>
              </div>
              <div class="codex-queued-followup-actions">
                <button
                  type="button"
                  class="codex-queued-followup-action"
                  onClick={() => props.onMove(item.id, -1)}
                  disabled={index() === 0}
                  title="Move queued follow-up earlier"
                >
                  Up
                </button>
                <button
                  type="button"
                  class="codex-queued-followup-action"
                  onClick={() => props.onMove(item.id, 1)}
                  disabled={index() === props.items.length - 1}
                  title="Move queued follow-up later"
                >
                  Down
                </button>
                <button
                  type="button"
                  class="codex-queued-followup-action"
                  onClick={() => props.onRestore(item.id)}
                  title="Restore queued follow-up to composer"
                >
                  Load
                </button>
                <button
                  type="button"
                  class="codex-queued-followup-action codex-queued-followup-action-danger"
                  onClick={() => props.onRemove(item.id)}
                  title="Remove queued follow-up"
                >
                  Remove
                </button>
              </div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

