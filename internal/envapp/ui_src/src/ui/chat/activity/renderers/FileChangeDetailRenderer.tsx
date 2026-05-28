import { For, Show } from 'solid-js';
import type { Component } from 'solid-js';

import type { FileChangeDetailSection } from '../activityDetailTypes';
import { useI18n } from '../../../i18n';

export const FileChangeDetailRenderer: Component<{ section: FileChangeDetailSection }> = (props) => {
  const i18n = useI18n();
  const operationLabel = (operation: FileChangeDetailSection['files'][number]['operation']): string => {
    switch (operation) {
      case 'created':
        return i18n.t('chatActivity.fileOperation.created');
      case 'updated':
        return i18n.t('chatActivity.fileOperation.updated');
      case 'deleted':
        return i18n.t('chatActivity.fileOperation.deleted');
      case 'renamed':
        return i18n.t('chatActivity.fileOperation.renamed');
      case 'read':
        return i18n.t('chatActivity.fileOperation.read');
      default:
        return i18n.t('chatActivity.fileOperation.unknown');
    }
  };

  return (
    <section class="chat-activity-detail-section">
      <div class="chat-activity-detail-section-head">
        <div class="chat-activity-detail-section-title">{i18n.t('chatActivity.fileChanges')}</div>
        <div class="chat-activity-detail-section-meta">{i18n.tn('chatActivity.fileCount', props.section.files.length)}</div>
      </div>
      <div class="chat-activity-file-list">
        <For each={props.section.files}>
          {(file) => (
            <div class="chat-activity-file-row">
              <span class="chat-activity-file-operation">{operationLabel(file.operation)}</span>
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
};
