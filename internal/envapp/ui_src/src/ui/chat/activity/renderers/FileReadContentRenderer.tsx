import { Show } from 'solid-js';
import type { Component } from 'solid-js';

import type { FileContentSection } from '../activityDetailTypes';
import { useI18n } from '../../../i18n';

export const FileReadContentRenderer: Component<{ section: FileContentSection }> = (props) => {
  const i18n = useI18n();
  return (
    <section class="chat-activity-detail-section">
      <div class="chat-activity-detail-section-head">
        <div class="chat-activity-detail-section-title">{props.section.filePath}</div>
        <Show when={props.section.totalLines}>
          {(total) => {
            const lineCount = () => props.section.lineCount ?? props.section.totalLines;
            return (
              <div class="chat-activity-detail-section-meta">
                {i18n.t('chatActivity.fileLines', { shown: lineCount() ?? 0, total: total() })}
                <Show when={props.section.truncated}>
                  <span> ({i18n.t('chatActivity.truncated')})</span>
                </Show>
              </div>
            );
          }}
        </Show>
      </div>
      <Show
        when={props.section.content}
        fallback={<div class="chat-activity-detail-empty">{i18n.t('chatActivity.emptyFile')}</div>}
      >
        {(content) => <pre class="chat-activity-file-preview">{content()}</pre>}
      </Show>
    </section>
  );
};
