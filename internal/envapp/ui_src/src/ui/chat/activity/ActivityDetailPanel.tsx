import { For, Show, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

import { writeTextToClipboard } from '../../utils/clipboard';
import type { ActivityDetailLoadState, ActivityDetailSection } from './activityDetailTypes';
import { ErrorDetailRenderer } from './renderers/ErrorDetailRenderer';
import { FileChangeDetailRenderer } from './renderers/FileChangeDetailRenderer';
import { FileReadContentRenderer } from './renderers/FileReadContentRenderer';
import { StructuredFieldsRenderer } from './renderers/StructuredFieldsRenderer';
import { TerminalDetailRenderer } from './renderers/TerminalDetailRenderer';
import { TodoDetailRenderer } from './renderers/TodoDetailRenderer';
import { WebDetailRenderer } from './renderers/WebDetailRenderer';

function renderSection(section: ActivityDetailSection) {
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
      return <div class="chat-activity-detail-empty">No detail content was captured.</div>;
  }
}

export const ActivityDetailPanel: Component<{
  state: ActivityDetailLoadState;
  panelId: string;
  onRetry: () => void;
}> = (props) => {
  const [copiedId, setCopiedId] = createSignal('');
  const copyTarget = async (id: string, text: string) => {
    if (!text) return;
    await writeTextToClipboard(text);
    setCopiedId(id);
  };

  return (
    <div id={props.panelId} class="chat-activity-detail-panel">
      <Show when={props.state.status !== 'loading'} fallback={<div class="chat-activity-detail-empty">Loading detail...</div>}>
        <Show when={props.state.status !== 'error'} fallback={(
          <div class="chat-activity-detail-error-state">
            <div class="chat-activity-detail-section-title">Detail unavailable</div>
            <div class="chat-activity-error-message">{props.state.status === 'error' ? props.state.message : 'The detail request failed.'}</div>
            <button type="button" class="chat-activity-detail-action" onClick={props.onRetry}>Retry</button>
          </div>
        )}>
          <Show
            when={props.state.status === 'ready' ? props.state.presentation : undefined}
            fallback={<div class="chat-activity-detail-empty">No detail content was captured for this tool call.</div>}
          >
            {(presentation) => (
              <>
                <div class="chat-activity-detail-header">
                  <div class="chat-activity-detail-heading">
                    <div class="chat-activity-detail-title">{presentation().title}</div>
                    <Show when={presentation().subtitle}>
                      {(subtitle) => <div class="chat-activity-detail-subtitle">{subtitle()}</div>}
                    </Show>
                  </div>
                  <div class="chat-activity-detail-chip-row">
                    <For each={presentation().chips}>
                      {(chip) => (
                        <span class={cn('chat-activity-detail-chip', chip.tone && `chat-activity-detail-chip-${chip.tone}`)}>
                          {chip.label}
                          <Show when={chip.value}>
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
                            void copyTarget(target.id, target.text);
                          }}
                        >
                          {copiedId() === target.id ? 'Copied' : target.label}
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
