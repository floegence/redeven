import { Show } from 'solid-js';
import type { Component } from 'solid-js';

import type { FileContentSection } from '../activityDetailTypes';

export const FileReadContentRenderer: Component<{ section: FileContentSection }> = (props) => (
  <section class="chat-activity-detail-section">
    <div class="chat-activity-detail-section-head">
      <div class="chat-activity-detail-section-title">{props.section.filePath}</div>
      <Show when={props.section.totalLines}>
        {(total) => {
          const lineCount = () => props.section.lineCount ?? props.section.totalLines;
          return (
            <div class="chat-activity-detail-section-meta">
              {lineCount()} / {total()} lines
              <Show when={props.section.truncated}>
                <span> (truncated)</span>
              </Show>
            </div>
          );
        }}
      </Show>
    </div>
    <Show
      when={props.section.content}
      fallback={<div class="chat-activity-detail-empty">(empty file)</div>}
    >
      {(content) => <pre class="chat-activity-file-preview">{content()}</pre>}
    </Show>
  </section>
);
