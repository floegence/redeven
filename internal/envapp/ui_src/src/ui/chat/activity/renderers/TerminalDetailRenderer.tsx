import { Show } from 'solid-js';
import type { Component } from 'solid-js';

import type { TerminalDetailSection } from '../activityDetailTypes';
import { useI18n } from '../../../i18n';

export const TerminalDetailRenderer: Component<{ section: TerminalDetailSection }> = (props) => {
  const i18n = useI18n();
  return (
    <section class="chat-activity-detail-section chat-activity-terminal-section">
      <div class="chat-activity-detail-section-head">
        <div class="chat-activity-detail-section-title">{i18n.t('chatActivity.command')}</div>
      </div>
      <div class="chat-activity-terminal-grid">
        <Show when={props.section.command}>
          {(command) => (
            <div class="chat-activity-terminal-command">
              <span class="chat-activity-detail-field-label">{i18n.t('chatActivity.command')}</span>
              <code>{command()}</code>
            </div>
          )}
        </Show>
        <Show when={props.section.cwd}>
          {(cwd) => (
            <div class="chat-activity-terminal-meta">
              <span class="chat-activity-detail-field-label">{i18n.t('chatActivity.workingDirectory')}</span>
              <code>{cwd()}</code>
            </div>
          )}
        </Show>
        <Show when={typeof props.section.exitCode === 'number'}>
          <div class="chat-activity-terminal-meta">
            <span class="chat-activity-detail-field-label">{i18n.t('chatActivity.exitCode')}</span>
            <span>{props.section.exitCode}</span>
          </div>
        </Show>
        <Show when={props.section.timeoutMs}>
          {(timeout) => (
            <div class="chat-activity-terminal-meta">
              <span class="chat-activity-detail-field-label">{i18n.t('chatActivity.timeout')}</span>
              <span>{timeout()}ms</span>
            </div>
          )}
        </Show>
      </div>
      <div class="chat-activity-output-panes">
        <Show when={props.section.stdout}>
          {(stdout) => (
            <div class="chat-activity-output-pane">
              <div class="chat-activity-output-title">stdout</div>
              <pre class="chat-activity-output-pre">{stdout()}</pre>
            </div>
          )}
        </Show>
        <Show when={props.section.stderr}>
          {(stderr) => (
            <div class="chat-activity-output-pane chat-activity-output-pane-error">
              <div class="chat-activity-output-title">stderr</div>
              <pre class="chat-activity-output-pre">{stderr()}</pre>
            </div>
          )}
        </Show>
        <Show when={!props.section.stdout && !props.section.stderr}>
          <div class="chat-activity-detail-empty">{i18n.t('chatActivity.noTerminalOutput')}</div>
        </Show>
      </div>
    </section>
  );
};
