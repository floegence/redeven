// SourcesBlock — paginated source table for web citations (title + URL)
// with compact previews and one-click copy support.

import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface SourcesBlockProps {
  sources: Array<{ title: string; url: string }>;
  class?: string;
}

const PAGE_SIZE = 6;
const TITLE_PREVIEW_LIMIT = 64;
const URL_PREVIEW_LIMIT = 72;

function normalizeTitle(title: string, url: string): string {
  const cleaned = String(title ?? '').replace(/\s+/g, ' ').trim();
  return cleaned || url;
}

function truncateWithDots(text: string, maxLength: number): string {
  const value = String(text ?? '').trim();
  if (value.length <= maxLength) return value;
  if (maxLength <= 3) return '...';
  return `${value.slice(0, maxLength - 3).trimEnd()}...`;
}

function clampPage(page: number, totalPages: number): number {
  if (page < 1) return 1;
  if (page > totalPages) return totalPages;
  return page;
}

async function copyToClipboard(text: string): Promise<void> {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

export const SourcesBlock: Component<SourcesBlockProps> = (props) => {
  const [page, setPage] = createSignal(1);
  const [copiedRowKey, setCopiedRowKey] = createSignal<string | null>(null);

  const total = createMemo(() => props.sources.length);
  const totalPages = createMemo(() => Math.max(1, Math.ceil(total() / PAGE_SIZE)));
  const pageStart = createMemo(() => (page() - 1) * PAGE_SIZE);
  const pageEnd = createMemo(() => Math.min(total(), pageStart() + PAGE_SIZE));
  const pageSources = createMemo(() => props.sources.slice(pageStart(), pageEnd()));

  createEffect(() => {
    const maxPage = totalPages();
    setPage((current) => clampPage(current, maxPage));
  });

  const hasSources = createMemo(() => total() > 0);
  const canGoPrev = createMemo(() => page() > 1);
  const canGoNext = createMemo(() => page() < totalPages());

  const goToPage = (nextPage: number) => {
    const clamped = clampPage(nextPage, totalPages());
    setPage(clamped);
  };

  const showRange = createMemo(() => {
    if (!hasSources()) return '0-0';
    return `${pageStart() + 1}-${pageEnd()}`;
  });

  return (
    <div class={cn('chat-sources-block', props.class)}>
      <div class="chat-sources-header">
        <div class="chat-sources-header-main">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
          </svg>
          <span>Sources</span>
          <span class="chat-sources-count-badge">{total()}</span>
        </div>
        <span class="chat-sources-page-hint">Page {page()} / {totalPages()}</span>
      </div>

      <div class="chat-sources-table" role="table" aria-label="Sources table">
        <div class="chat-sources-table-header" role="row">
          <span class="chat-sources-th chat-sources-th-index" role="columnheader">
            #
          </span>
          <span class="chat-sources-th chat-sources-th-title" role="columnheader">
            Title
          </span>
          <span class="chat-sources-th chat-sources-th-url" role="columnheader">
            URL
          </span>
          <span class="chat-sources-th chat-sources-th-actions" role="columnheader" />
        </div>

        <Show
          when={hasSources()}
          fallback={<div class="chat-sources-empty-row">No sources available.</div>}
        >
          <For each={pageSources()}>
            {(src, index) => {
              const rowNumber = () => pageStart() + index() + 1;
              const rowKey = () => `${rowNumber()}::${src.url}`;
              const title = normalizeTitle(src.title, src.url);
              const previewTitle = truncateWithDots(title, TITLE_PREVIEW_LIMIT);
              const previewURL = truncateWithDots(src.url, URL_PREVIEW_LIMIT);
              const copied = () => copiedRowKey() === rowKey();

              const doCopy = async () => {
                const key = rowKey();
                await copyToClipboard(src.url);
                setCopiedRowKey(key);
                setTimeout(() => {
                  setCopiedRowKey((current) => (current === key ? null : current));
                }, 2000);
              };

              return (
                <div class="chat-sources-row" role="row">
                  <span class="chat-sources-cell chat-sources-cell-index" role="cell">
                    {rowNumber()}
                  </span>

                  <span
                    class="chat-sources-cell chat-sources-cell-title"
                    role="cell"
                    title={title}
                  >
                    {previewTitle}
                  </span>

                  <a
                    class="chat-sources-cell chat-sources-cell-url"
                    role="cell"
                    href={src.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={src.url}
                  >
                    {previewURL}
                  </a>

                  <button
                    class="chat-sources-action-btn chat-sources-copy-btn"
                    type="button"
                    onClick={doCopy}
                    aria-label={copied() ? 'Copied URL' : 'Copy URL'}
                    title={copied() ? 'Copied!' : 'Copy URL'}
                  >
                    <Show when={copied()} fallback={<CopyIcon />}>
                      <CheckIcon />
                    </Show>
                  </button>
                </div>
              );
            }}
          </For>
        </Show>
      </div>

      <Show when={totalPages() > 1}>
        <div class="chat-sources-pagination" role="navigation" aria-label="Sources pagination">
          <span class="chat-sources-pagination-meta">
            Showing {showRange()} of {total()}
          </span>

          <div class="chat-sources-pagination-controls">
            <button
              class="chat-sources-page-btn"
              type="button"
              onClick={() => goToPage(1)}
              disabled={!canGoPrev()}
              aria-label="First page"
              title="First page"
            >
              <DoubleChevronLeftIcon />
            </button>

            <button
              class="chat-sources-page-btn"
              type="button"
              onClick={() => goToPage(page() - 1)}
              disabled={!canGoPrev()}
              aria-label="Previous page"
              title="Previous page"
            >
              <ChevronLeftIcon />
            </button>

            <span class="chat-sources-page-indicator">
              {page()} / {totalPages()}
            </span>

            <button
              class="chat-sources-page-btn"
              type="button"
              onClick={() => goToPage(page() + 1)}
              disabled={!canGoNext()}
              aria-label="Next page"
              title="Next page"
            >
              <ChevronRightIcon />
            </button>

            <button
              class="chat-sources-page-btn"
              type="button"
              onClick={() => goToPage(totalPages())}
              disabled={!canGoNext()}
              aria-label="Last page"
              title="Last page"
            >
              <DoubleChevronRightIcon />
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
};

const CopyIcon: Component = () => (
  <svg
    class="chat-sources-action-icon"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon: Component = () => (
  <svg
    class="chat-sources-action-icon"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ChevronLeftIcon: Component = () => (
  <svg
    class="chat-sources-action-icon"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const ChevronRightIcon: Component = () => (
  <svg
    class="chat-sources-action-icon"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const DoubleChevronLeftIcon: Component = () => (
  <svg
    class="chat-sources-action-icon"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m11 17-5-5 5-5" />
    <path d="m18 17-5-5 5-5" />
  </svg>
);

const DoubleChevronRightIcon: Component = () => (
  <svg
    class="chat-sources-action-icon"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="m13 17 5-5-5-5" />
    <path d="m6 17 5-5-5-5" />
  </svg>
);
