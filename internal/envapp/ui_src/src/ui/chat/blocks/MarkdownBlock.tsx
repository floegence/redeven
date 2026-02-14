// MarkdownBlock — renders markdown content as HTML.
// When streaming, displays raw text to avoid jank from re-parsing on every delta.

import { createMemo, createSignal, createEffect, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface MarkdownBlockProps {
  content: string;
  streaming?: boolean;
  class?: string;
}

// Lazy-loaded marked instance with custom renderer configuration
let markedInstance: any = null;
let markedLoading = false;
let markedLoadQueue: Array<() => void> = [];

async function getMarked(): Promise<any> {
  if (markedInstance) return markedInstance;

  return new Promise<any>((resolve) => {
    markedLoadQueue.push(() => resolve(markedInstance));

    if (markedLoading) return;
    markedLoading = true;

    import('marked')
      .then(({ Marked }) => {
        const instance = new Marked();

        // Configure custom renderer
        const renderer = {
          link(token: { href: string; title?: string | null; text: string }) {
            const titleAttr = token.title ? ` title="${token.title}"` : '';
            return `<a href="${token.href}" class="chat-md-link" target="_blank" rel="noopener noreferrer"${titleAttr}>${token.text}</a>`;
          },
          codespan(token: { text: string }) {
            return `<code class="chat-md-inline-code">${token.text}</code>`;
          },
          code(token: { text: string; lang?: string }) {
            const langClass = token.lang ? ` class="language-${token.lang}"` : '';
            return `<pre class="chat-md-code-block"><code${langClass}>${token.text}</code></pre>`;
          },
          blockquote(token: { text: string }) {
            return `<blockquote class="chat-md-blockquote">${token.text}</blockquote>`;
          },
          image(token: { href: string; title?: string | null; text: string }) {
            const titleAttr = token.title ? ` title="${token.title}"` : '';
            return `<img src="${token.href}" alt="${token.text}" class="chat-md-image"${titleAttr} />`;
          },
        };

        instance.use({ renderer });
        markedInstance = instance;

        // Flush all waiting callers
        for (const cb of markedLoadQueue) cb();
        markedLoadQueue = [];
      })
      .catch((err) => {
        console.error('Failed to load marked:', err);
        markedLoading = false;
        markedLoadQueue = [];
      });
  });
}

/**
 * Renders markdown content. When streaming, shows raw text to minimize
 * layout thrashing; once streaming stops, parses and renders as HTML.
 */
export const MarkdownBlock: Component<MarkdownBlockProps> = (props) => {
  const [renderedHtml, setRenderedHtml] = createSignal<string>('');
  const [isReady, setIsReady] = createSignal(false);

  // Render markdown to HTML when content changes and not streaming
  createEffect(() => {
    const content = props.content;
    const streaming = props.streaming;

    if (streaming) {
      setIsReady(false);
      return;
    }

    if (!content) {
      setRenderedHtml('');
      setIsReady(true);
      return;
    }

    getMarked().then((marked) => {
      if (!marked) {
        // Fallback: display as plain text if marked failed to load
        setRenderedHtml('');
        setIsReady(false);
        return;
      }
      try {
        const html = marked.parse(content, { async: false }) as string;
        setRenderedHtml(html);
        setIsReady(true);
      } catch (err) {
        console.error('Markdown parse error:', err);
        setRenderedHtml('');
        setIsReady(false);
      }
    });
  });

  return (
    <div class={cn('chat-markdown-block', props.class)}>
      <Show
        when={!props.streaming && isReady()}
        fallback={
          <div style={{ 'white-space': 'pre-wrap' }}>{props.content}</div>
        }
      >
        {/* eslint-disable-next-line solid/no-innerhtml */}
        <div innerHTML={renderedHtml()} />
      </Show>
    </div>
  );
};
