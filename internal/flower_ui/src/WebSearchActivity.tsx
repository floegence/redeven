import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import { ChevronDown } from '@floegence/floe-webapp-core/icons';
import type { FlowerWebSearchCopy } from './copy';
import type { FlowerWebOperationDetail } from './flowerActivityPresentation';
import { safeWebFetchURL } from './flowerActivityPresentation';

const collapsedSourceCount = 3;

export function WebSearchActivity(props: {search: FlowerWebOperationDetail; copy: FlowerWebSearchCopy; openLabel: string}) {
  const [expanded, setExpanded] = createSignal(false);
  const listId = createUniqueId();
  const visible = createMemo(() => expanded() ? props.search.results : props.search.results.slice(0, collapsedSourceCount));
  return <section class="flower-activity-web-panel flower-web-operation">
    <div class="flower-activity-web-section">
      <ul id={listId} class="flower-activity-web-list" aria-label={props.copy.sourcesTitle}>
        <For each={visible()}>{(entry, index) => {
          const safe = safeWebFetchURL(entry.url);
          const url = safe ? new URL(safe) : undefined;
          const title = entry.title.trim();
          const content = <>
            <span class="flower-web-operation-source-primary">{title || url?.host || entry.url}</span>
            <Show when={url}>
              <span class="flower-web-operation-source-secondary" classList={{ 'flower-web-operation-source-domain': Boolean(title) }}>
                {title ? url?.host : (url?.pathname ?? '') + (url?.search ?? '') + (url?.hash ?? '')}
              </span>
            </Show>
          </>;
          return <li class="flower-activity-web-entry">
            <span class="flower-web-operation-source-number" aria-hidden="true">{index() + 1}.</span>
            <div class="flower-web-operation-source-body">
              <Show when={safe} fallback={<span class="flower-web-operation-source" title={entry.url}>{content}</span>}>
                <a class="flower-web-operation-source" href={safe} target="_blank" rel="noopener noreferrer" title={entry.url} aria-label={props.openLabel + ': ' + (title ? title + ' · ' : '') + entry.url} onClick={(event) => event.stopPropagation()}>{content}</a>
              </Show>
              <Show when={entry.snippet}><p class="flower-web-operation-snippet">{entry.snippet}</p></Show>
            </div>
          </li>;
        }}</For>
      </ul>
      <Show when={props.search.results.length > collapsedSourceCount}>
        <button type="button" class="flower-web-operation-more" aria-expanded={expanded()} aria-controls={listId} onClick={() => setExpanded(!expanded())}>
          {expanded() ? props.copy.showLess : props.copy.showMore(props.search.results.length - collapsedSourceCount)}
          <ChevronDown aria-hidden="true" />
        </button>
      </Show>
    </div>
  </section>;
}
