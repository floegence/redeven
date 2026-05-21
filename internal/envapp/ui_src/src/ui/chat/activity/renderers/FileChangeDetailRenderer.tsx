import { For, Show } from 'solid-js';
import type { Component } from 'solid-js';

import type { FileChangeDetailSection } from '../activityDetailTypes';

export const FileChangeDetailRenderer: Component<{ section: FileChangeDetailSection }> = (props) => (
  <section class="chat-activity-detail-section">
    <div class="chat-activity-detail-section-head">
      <div class="chat-activity-detail-section-title">File changes</div>
      <div class="chat-activity-detail-section-meta">{props.section.files.length} files</div>
    </div>
    <div class="chat-activity-file-list">
      <For each={props.section.files}>
        {(file) => (
          <div class="chat-activity-file-row">
            <span class="chat-activity-file-operation">{file.operation}</span>
            <div class="chat-activity-file-copy">
              <code class="chat-activity-file-path">{file.path}</code>
              <Show when={file.summary}>
                {(summary) => <div class="chat-activity-file-summary">{summary()}</div>}
              </Show>
              <Show when={file.diffPreview}>
                {(preview) => <pre class="chat-activity-diff-preview">{preview()}</pre>}
              </Show>
            </div>
          </div>
        )}
      </For>
    </div>
  </section>
);
