import { For } from 'solid-js';
import type { Component } from 'solid-js';

import type { StructuredFieldsSection } from '../activityDetailTypes';

export const StructuredFieldsRenderer: Component<{ section: StructuredFieldsSection }> = (props) => (
  <section class="chat-activity-detail-section">
    <div class="chat-activity-detail-section-head">
      <div class="chat-activity-detail-section-title">{props.section.title}</div>
    </div>
    <div class="chat-activity-structured-groups">
      <For each={props.section.groups}>
        {(group) => (
          <div class="chat-activity-structured-group">
            <div class="chat-activity-structured-title">{group.title}</div>
            <dl class="chat-activity-structured-fields">
              <For each={group.fields}>
                {(field) => (
                  <div class="chat-activity-structured-field" data-secret={field.secret ? 'true' : 'false'}>
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
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
