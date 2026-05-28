import { For, Show, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import { useI18n } from '../../i18n';
import { writeTextToClipboard } from '../../utils/clipboard';
import { localizedActivityText, localizedActivityValue } from './activityDetailI18n';
import type { ActivityDetailCopyTarget, ActivityDetailLoadState, ActivityDetailSection } from './activityDetailTypes';
import { ErrorDetailRenderer } from './renderers/ErrorDetailRenderer';
import { FileChangeDetailRenderer } from './renderers/FileChangeDetailRenderer';
import { FileReadContentRenderer } from './renderers/FileReadContentRenderer';
import { StructuredFieldsRenderer } from './renderers/StructuredFieldsRenderer';
import { TerminalDetailRenderer } from './renderers/TerminalDetailRenderer';
import { TodoDetailRenderer } from './renderers/TodoDetailRenderer';
import { WebDetailRenderer } from './renderers/WebDetailRenderer';

function renderSection(section: ActivityDetailSection) {
  const i18n = useI18n();
  switch (section.kind) {
    case 'terminal':
      return <TerminalDetailRenderer section={section} />;
    case 'todo_delta':
      return <TodoDetailRenderer section={section} />;
    case 'file_change':
      return <FileChangeDetailRenderer section={section} />;
    case 'file_read_content':
      return <FileReadContentRenderer section={section} />;
    case 'web_results':
      return <WebDetailRenderer section={section} />;
    case 'error':
      return <ErrorDetailRenderer section={section} />;
    case 'structured_fields':
      return <StructuredFieldsRenderer section={section} />;
    default:
      return <div class="chat-activity-detail-empty">{i18n.t('chatActivity.noDetailContent')}</div>;
  }
}

function localizedCopyText(i18n: ReturnType<typeof useI18n>, target: ActivityDetailCopyTarget): string {
  if (!target.textKey) {
    return target.text;
  }
  const fallback = i18n.t(target.textKey, target.textParams);
  const separator = target.textPrefixSeparator;
  if (!separator) {
    return target.text || fallback;
  }
  if (!target.text.trim()) {
    return fallback;
  }
  return target.text
    .split('\n')
    .map((line) => {
      const [status, ...rest] = line.split(separator);
      const content = rest.join(separator).trim();
      if (!status || content) {
        return line;
      }
      return `${status}${separator} ${fallback}`;
    })
    .join('\n');
}

export const ActivityDetailPanel: Component<{
  state: ActivityDetailLoadState;
  panelId: string;
  onRetry: () => void;
}> = (props) => {
  const i18n = useI18n();
  const [copiedId, setCopiedId] = createSignal('');
  const copyTarget = async (id: string, text: string) => {
    if (!text) return;
    await writeTextToClipboard(text);
    setCopiedId(id);
  };

  return (
    <div id={props.panelId} class="chat-activity-detail-panel">
      <Show when={props.state.status !== 'loading'} fallback={<div class="chat-activity-detail-empty">{i18n.t('chatActivity.loadingDetail')}</div>}>
        <Show when={props.state.status !== 'error'} fallback={(
          <div class="chat-activity-detail-error-state">
            <div class="chat-activity-detail-section-title">{i18n.t('chatActivity.detailUnavailable')}</div>
            <div class="chat-activity-error-message">{props.state.status === 'error' ? props.state.message : i18n.t('chatActivity.detailRequestFailed')}</div>
            <button type="button" class="chat-activity-detail-action" onClick={props.onRetry}>{i18n.t('common.actions.retry')}</button>
          </div>
        )}>
          <Show
            when={props.state.status === 'ready' ? props.state.presentation : undefined}
            fallback={<div class="chat-activity-detail-empty">{i18n.t('chatActivity.noToolDetailContent')}</div>}
          >
            {(presentation) => (
              <>
                <div class="chat-activity-detail-header">
                  <div class="chat-activity-detail-heading">
                    <div class="chat-activity-detail-title">
                      {localizedActivityText(i18n, {
                        label: presentation().title,
                        labelKey: presentation().titleKey,
                        labelParams: presentation().titleParams,
                      })}
                    </div>
                    <Show when={presentation().subtitle}>
                      {(subtitle) => <div class="chat-activity-detail-subtitle">{subtitle()}</div>}
                    </Show>
                  </div>
                  <div class="chat-activity-detail-chip-row">
                    <For each={presentation().chips}>
                      {(chip) => (
                        <span class={cn('chat-activity-detail-chip', chip.tone && `chat-activity-detail-chip-${chip.tone}`)}>
                          {localizedActivityText(i18n, chip)}
                          <Show when={localizedActivityValue(i18n, chip)}>
                            {(value) => <span>{value()}</span>}
                          </Show>
                        </span>
                      )}
                    </For>
                  </div>
                </div>
                <div class="chat-activity-detail-sections">
                  <For each={presentation().sections}>{renderSection}</For>
                </div>
                <Show when={presentation().copyTargets.length > 0}>
                  <div class="chat-activity-detail-actions">
                    <For each={presentation().copyTargets}>
                      {(target) => (
                        <button
                          type="button"
                          class="chat-activity-detail-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyTarget(target.id, localizedCopyText(i18n, target));
                          }}
                        >
                          {copiedId() === target.id ? i18n.t('common.actions.copied') : localizedActivityText(i18n, target)}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  );
};
