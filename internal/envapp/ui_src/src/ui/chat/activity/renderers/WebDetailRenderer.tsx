import { For, Show } from 'solid-js';
import type { Component } from 'solid-js';

import type { WebDetailSection } from '../activityDetailTypes';

export const WebDetailRenderer: Component<{ section: WebDetailSection }> = (props) => (
  <section class="chat-activity-detail-section">
    <div class="chat-activity-detail-section-head">
      <div class="chat-activity-detail-section-title">Research</div>
      <Show when={props.section.query}>
        {(query) => <div class="chat-activity-detail-section-meta">{query()}</div>}
      </Show>
    </div>
    <Show when={props.section.sources.length > 0} fallback={<div class="chat-activity-detail-empty">No sources were captured.</div>}>
      <div class="chat-activity-source-list">
        <For each={props.section.sources}>
          {(source) => (
            <div class="chat-activity-source-row">
              <div class="chat-activity-source-title">{source.title}</div>
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
