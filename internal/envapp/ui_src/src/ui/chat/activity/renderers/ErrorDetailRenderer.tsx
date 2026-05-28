import { Show } from 'solid-js';
import type { Component } from 'solid-js';

import type { ErrorDetailSection } from '../activityDetailTypes';
import { useI18n } from '../../../i18n';

export const ErrorDetailRenderer: Component<{ section: ErrorDetailSection }> = (props) => {
  const i18n = useI18n();
  return (
    <section class="chat-activity-detail-section chat-activity-error-section">
      <div class="chat-activity-detail-section-head">
        <div class="chat-activity-detail-section-title">{i18n.t('chatActivity.error')}</div>
        <Show when={props.section.code}>
          {(code) => <code class="chat-activity-error-code">{code()}</code>}
        </Show>
      </div>
      <div class="chat-activity-error-message">{props.section.message}</div>
      <Show when={props.section.recoveryAction}>
        {(action) => (
          <div class="chat-activity-error-recovery">
            <span class="chat-activity-detail-field-label">{i18n.t('chatActivity.recovery')}</span>
            <span>{action()}</span>
          </div>
        )}
      </Show>
      <Show when={props.section.retryable}>
        <div class="chat-activity-error-retryable">{i18n.t('chatActivity.retryable')}</div>
      </Show>
    </section>
  );
};
