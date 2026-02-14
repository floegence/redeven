// CodeBlock — code display with syntax highlighting (lazy-loaded shiki) and copy button.

import { createSignal, createEffect, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface CodeBlockProps {
  language: string;
  content: string;
  filename?: string;
  class?: string;
}

// Lazy-loaded shiki highlighter singleton
let highlighterPromise: Promise<any> | null = null;

function getHighlighter(): Promise<any> {
  if (highlighterPromise) return highlighterPromise;

  highlighterPromise = import('shiki')
    .then(async (shiki) => {
      const highlighter = await shiki.createHighlighter({
        themes: ['github-dark', 'github-light'],
        langs: [],
      });
      return highlighter;
    })
    .catch((err) => {
      console.error('Failed to load shiki:', err);
      highlighterPromise = null;
      return null;
    });

  return highlighterPromise;
}

// SVG icons for the copy button
const CopyIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
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

const CheckIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
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

/**
 * Renders a code block with optional syntax highlighting via shiki.
 * Falls back to plain text if shiki is unavailable or the language is not loaded.
 * Includes a copy-to-clipboard button.
 */
export const CodeBlock: Component<CodeBlockProps> = (props) => {
  const [highlightedHtml, setHighlightedHtml] = createSignal<string>('');
  const [copied, setCopied] = createSignal(false);

  // Highlight code when content or language changes
  createEffect(() => {
    const code = props.content;
    const lang = props.language;

    if (!code) {
      setHighlightedHtml('');
      return;
    }

    getHighlighter().then(async (highlighter) => {
      if (!highlighter) return;

      try {
        // Dynamically load the language if needed
        const loadedLangs = highlighter.getLoadedLanguages();
        if (lang && !loadedLangs.includes(lang)) {
          try {
            await highlighter.loadLanguage(lang);
          } catch {
            // Language not available — fall back to plain text
            setHighlightedHtml('');
            return;
          }
        }

        const html = highlighter.codeToHtml(code, {
          lang: lang || 'text',
          theme: 'github-dark',
        });
        setHighlightedHtml(html);
      } catch (err) {
        console.error('Shiki highlight error:', err);
        setHighlightedHtml('');
      }
    });
  });

  const handleCopy = () => {
    navigator.clipboard.writeText(props.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const showHeader = () => !!props.language || !!props.filename;

  return (
    <div class={cn('chat-code-block', props.class)}>
      <Show when={showHeader()}>
        <div class="chat-code-header">
          <div class="chat-code-info">
            <Show when={props.filename}>
              <span class="chat-code-filename">{props.filename}</span>
            </Show>
            <Show when={props.language}>
              <span class="chat-code-language">{props.language}</span>
            </Show>
          </div>
          <button
            class="chat-code-copy-btn"
            onClick={handleCopy}
            title={copied() ? 'Copied!' : 'Copy code'}
            aria-label={copied() ? 'Copied!' : 'Copy code'}
          >
            <Show when={copied()} fallback={<CopyIcon />}>
              <CheckIcon />
            </Show>
          </button>
        </div>
      </Show>

      <div class="chat-code-content">
        <Show
          when={highlightedHtml()}
          fallback={
            <pre class="chat-code-pre">
              <code>{props.content}</code>
            </pre>
          }
        >
          {/* eslint-disable-next-line solid/no-innerhtml */}
          <div innerHTML={highlightedHtml()} />
        </Show>
      </div>
    </div>
  );
};

export default CodeBlock;
