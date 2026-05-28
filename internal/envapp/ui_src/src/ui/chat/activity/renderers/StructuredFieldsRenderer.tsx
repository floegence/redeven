import { For } from 'solid-js';
import type { Component } from 'solid-js';

import type { StructuredFieldsSection } from '../activityDetailTypes';
import { useI18n } from '../../../i18n';
import { localizedActivityText, localizedActivityValue } from '../activityDetailI18n';

export const StructuredFieldsRenderer: Component<{ section: StructuredFieldsSection }> = (props) => {
  const i18n = useI18n();
  return (
    <section class="chat-activity-detail-section">
      <div class="chat-activity-detail-section-head">
        <div class="chat-activity-detail-section-title">{localizedActivityText(i18n, props.section)}</div>
      </div>
      <div class="chat-activity-structured-groups">
        <For each={props.section.groups}>
          {(group) => (
            <div class="chat-activity-structured-group">
              <div class="chat-activity-structured-title">{localizedActivityText(i18n, group)}</div>
              <dl class="chat-activity-structured-fields">
                <For each={group.fields}>
                  {(field) => (
                    <div class="chat-activity-structured-field" data-secret={field.secret ? 'true' : 'false'}>
                      <dt>{localizedActivityText(i18n, field)}</dt>
                      <dd>{localizedActivityValue(i18n, field)}</dd>
                    </div>
                  )}
                </For>
              </dl>
            </div>
          )}
        </For>
      </div>
    </section>
  );
};
