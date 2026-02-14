// SourcesBlock — audit-friendly display of web source links (title + URL),
// with copy-to-clipboard and collapsible overflow.

import { For, Show, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface SourcesBlockProps {
  sources: Array<{ title: string; url: string }>;
  class?: string;
}

/** Visible-by-default threshold; sources beyond this are collapsed. */
const VISIBLE_LIMIT = 4;

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function normalizeTitle(title: string, url: string): string {
  const cleaned = String(title ?? '').replace(/\s+/g, ' ').trim();
  return cleaned || url;
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
  const [expanded, setExpanded] = createSignal(false);
  const [copiedURL, setCopiedURL] = createSignal<string | null>(null);

  const visibleSources = () => {
    if (expanded() || props.sources.length <= VISIBLE_LIMIT) {
      return props.sources;
    }
    return props.sources.slice(0, VISIBLE_LIMIT);
  };

  const hiddenCount = () => Math.max(0, props.sources.length - VISIBLE_LIMIT);

  return (
    <div class={cn('chat-sources-block', props.class)}>
      {/* Header */}
      <div class="chat-sources-header">
        {/* BookOpen icon */}
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
        <span class="chat-sources-count-badge">{props.sources.length}</span>
      </div>

      {/* Source list */}
      <div class="chat-sources-list">
        <For each={visibleSources()}>
          {(src, index) => {
            const domain = extractDomain(src.url);
            const title = normalizeTitle(src.title, src.url);
            const copied = () => copiedURL() === src.url;

            const doCopy = async () => {
              await copyToClipboard(src.url);
              setCopiedURL(src.url);
              setTimeout(() => {
                setCopiedURL((prev) => (prev === src.url ? null : prev));
              }, 2000);
            };

            return (
              <div class="chat-sources-item">
                <div class="chat-sources-badge">
                  <span class="chat-sources-badge-number">{index() + 1}</span>
                </div>

                <a
                  class="chat-sources-link"
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span class="chat-sources-title">{title}</span>
                  <span class="chat-sources-url">{src.url}</span>
                  <span class="chat-sources-domain">{domain}</span>
                </a>

                <button
                  class="chat-sources-action-btn"
                  type="button"
                  onClick={doCopy}
                  aria-label={copied() ? 'Copied' : 'Copy URL'}
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
      </div>

      {/* Expand / collapse toggle */}
      <Show when={hiddenCount() > 0}>
        <button
          class="chat-sources-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          <svg
            class={cn('chat-sources-toggle-icon', expanded() && 'chat-sources-toggle-icon-open')}
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
          {expanded()
            ? 'Show less'
            : `Show ${hiddenCount()} more source${hiddenCount() > 1 ? 's' : ''}`}
        </button>
      </Show>
    </div>
  );
};

// -- Inline SVG icons --

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
