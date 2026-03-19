// CodeBlock renders chat code with shared Shiki highlighting and copy support.

import { createEffect, createSignal, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { highlightCodeToHtml, resolveCodeHighlightTheme } from '../../utils/shikiHighlight';

export interface CodeBlockProps {
  language: string;
  content: string;
  filename?: string;
  class?: string;
}

const CHAT_CODE_THEME = resolveCodeHighlightTheme('dark');

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

export const CodeBlock: Component<CodeBlockProps> = (props) => {
  const [highlightedHtml, setHighlightedHtml] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  let highlightRequestSeq = 0;

  createEffect(() => {
    const code = props.content;
    const language = props.language;
    const seq = (highlightRequestSeq += 1);

    setHighlightedHtml('');
    if (!code) return;

    void highlightCodeToHtml({
      code,
      language,
      theme: CHAT_CODE_THEME,
    }).then((html) => {
      if (seq !== highlightRequestSeq) return;
      setHighlightedHtml(html ?? '');
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
          fallback={(
            <pre class="chat-code-pre">
              <code>{props.content}</code>
            </pre>
          )}
        >
          {/* eslint-disable-next-line solid/no-innerhtml */}
          <div innerHTML={highlightedHtml()} />
        </Show>
      </div>
    </div>
  );
};

export default CodeBlock;
