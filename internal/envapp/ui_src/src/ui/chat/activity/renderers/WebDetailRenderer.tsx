import { For, Show } from 'solid-js';
import type { Component } from 'solid-js';

import type { WebDetailSection } from '../activityDetailTypes';
import { useI18n } from '../../../i18n';
import { localizedActivityText } from '../activityDetailI18n';

export const WebDetailRenderer: Component<{ section: WebDetailSection }> = (props) => {
  const i18n = useI18n();
  return (
    <section class="chat-activity-detail-section">
      <div class="chat-activity-detail-section-head">
        <div class="chat-activity-detail-section-title">{i18n.t('chatActivity.research')}</div>
        <Show when={props.section.query}>
          {(query) => <div class="chat-activity-detail-section-meta">{query()}</div>}
        </Show>
      </div>
      <Show when={props.section.sources.length > 0} fallback={<div class="chat-activity-detail-empty">{i18n.t('chatActivity.noSources')}</div>}>
        <div class="chat-activity-source-list">
          <For each={props.section.sources}>
            {(source) => (
              <div class="chat-activity-source-row">
                <div class="chat-activity-source-title">{localizedActivityText(i18n, source)}</div>
                <Show when={source.url}>
                  {(url) => <div class="chat-activity-source-url">{url()}</div>}
                </Show>
                <Show when={source.snippet}>
                  {(snippet) => <div class="chat-activity-source-snippet">{snippet()}</div>}
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>
    </section>
  );
};
