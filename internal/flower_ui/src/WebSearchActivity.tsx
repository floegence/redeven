import { createMemo, createSignal, createUniqueId, For, Show } from 'solid-js';
import { ChevronDown, Search } from '@floegence/floe-webapp-core/icons';
import type { FlowerWebSearchCopy } from './copy';
import type { FlowerWebOperationDetail } from './flowerActivityPresentation';
import { safeWebFetchURL } from './flowerActivityPresentation';

const collapsedSourceCount = 3;

export function WebSearchActivity(props: {search: FlowerWebOperationDetail; copy: FlowerWebSearchCopy; openLabel: string}) {
  const [expanded, setExpanded] = createSignal(false);
  const listId = createUniqueId();
  const queries = createMemo(() => props.search.query.split('\n').map((query) => query.trim()).filter(Boolean));
  const visible = createMemo(() => expanded() ? props.search.results : props.search.results.slice(0, collapsedSourceCount));
  const link = (url: string, title: string) => {
    const safe = safeWebFetchURL(url);
    return <Show when={safe} fallback={<span>{title}</span>}>
      <a href={safe} target="_blank" rel="noopener noreferrer" title={props.openLabel + ': ' + url} onClick={(event) => event.stopPropagation()}>{title}</a>
    </Show>;
  };
  return <section class="flower-activity-web-panel flower-web-operation">
    <Show when={queries().length}>
      <div class="flower-activity-web-section">
        <For each={queries()}>{(query) => <div class="flower-web-operation-searchbox" data-floe-input-surface>
          <Search aria-hidden="true" />
          <input type="text" readOnly value={query} aria-label={props.copy.queryLabel} title={query} spellcheck={false} />
        </div>}</For>
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
        <div class="flower-activity-detail-heading">{props.copy.sourcesTitle} · {props.search.results.length}</div>
        <ul id={listId} class="flower-activity-web-list" aria-label={props.copy.sourcesTitle}>
          <For each={visible()}>{(entry, index) => {
            const safe = safeWebFetchURL(entry.url);
            const url = safe ? new URL(safe) : undefined;
            const title = entry.title.trim();
            const tooltip = [title, entry.url, entry.snippet].filter(Boolean).join('\n');
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
              <Show when={safe} fallback={<span class="flower-web-operation-source" title={tooltip}>{content}</span>}>
                <a class="flower-web-operation-source" href={safe} target="_blank" rel="noopener noreferrer" title={tooltip} aria-label={props.openLabel + ': ' + (title ? title + ' · ' : '') + entry.url} onClick={(event) => event.stopPropagation()}>{content}</a>
              </Show>
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
    </Show>
    <Show when={props.search.notice}><p class="flower-web-operation-notice">{props.search.notice}</p></Show>
  </section>;
}
