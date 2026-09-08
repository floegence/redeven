import { createMemo, createSignal, For, Show } from 'solid-js';
import type { FlowerWebSearchCopy } from './copy';
import type { FlowerWebOperationDetail } from './flowerActivityPresentation';
import { safeWebFetchURL } from './flowerActivityPresentation';

export function WebSearchActivity(props: {search: FlowerWebOperationDetail; copy: FlowerWebSearchCopy; openLabel: string}) {
  const [expanded, setExpanded] = createSignal(false);
  const queries = createMemo(() => props.search.query.split('\n').map((query) => query.trim()).filter(Boolean));
  const visible = createMemo(() => expanded() ? props.search.results : props.search.results.slice(0, 5));
  const link = (url: string, title: string) => {
    const safe = safeWebFetchURL(url);
    return <Show when={safe} fallback={<span>{title}</span>}>
      <a href={safe} target="_blank" rel="noopener noreferrer" title={`${props.openLabel}: ${url}`} onClick={(event) => event.stopPropagation()}>{title}</a>
    </Show>;
  };
  return <section class="flower-activity-web-panel flower-web-operation">
    <Show when={queries().length}>
      <div class="flower-activity-web-section">
        <div class="flower-activity-detail-heading">{props.copy.queryLabel}</div>
        <For each={queries()}>{(query) => <p class="flower-web-operation-value">{query}</p>}</For>
      </div>
    </Show>
    <Show when={props.search.url}>
      <div class="flower-activity-web-section">
        <div class="flower-activity-detail-heading">{props.copy.targetLabel}</div>
        <div class="flower-web-operation-value">{link(props.search.url, props.search.url)}</div>
      </div>
    </Show>
    <Show when={props.search.pattern}>
      <div class="flower-activity-web-section">
        <div class="flower-activity-detail-heading">{props.copy.patternLabel}</div>
        <p class="flower-web-operation-value">{props.search.pattern}</p>
      </div>
    </Show>
    <Show when={props.search.results.length}>
      <div class="flower-activity-web-section">
        <div class="flower-activity-detail-heading">{props.copy.sourcesTitle}</div>
        <ul class="flower-activity-web-list">
          <For each={visible()}>{(entry) => {
            const safe = safeWebFetchURL(entry.url);
            const domain = safe ? new URL(safe).host : '';
            return <li class="flower-activity-web-entry">
              <div class="flower-activity-web-entry-title">{link(entry.url, entry.title || entry.url)}</div>
              <Show when={entry.url}>
                <details class="flower-web-operation-address">
                  <summary class="flower-activity-web-entry-meta" title={entry.url}>{domain || props.copy.targetLabel}</summary>
                  <div class="flower-web-operation-url">{entry.url}</div>
                </details>
              </Show>
              <Show when={entry.snippet}><p class="flower-activity-web-entry-snippet">{entry.snippet}</p></Show>
            </li>;
          }}</For>
        </ul>
        <Show when={props.search.results.length > 5}>
          <button type="button" class="flower-web-operation-more" aria-expanded={expanded()} onClick={() => setExpanded(!expanded())}>
            {expanded() ? props.copy.showLess : props.copy.showMore(props.search.results.length - 5)}
          </button>
        </Show>
      </div>
    </Show>
    <Show when={props.search.notice}><p class="flower-web-operation-notice">{props.search.notice}</p></Show>
  </section>;
}
