// MarkdownBlock — renders markdown content as HTML.
//
// During streaming, it throttles markdown parsing and keeps it off the main thread
// (via a shared Web Worker) to avoid UI jank while still showing rendered markdown.

import { createSignal, createEffect, Show, onCleanup, createMemo } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { renderMarkdownHtml } from '../workers/markdownWorkerClient';
import { StreamingCursor } from '../status/StreamingCursor';

export interface MarkdownBlockProps {
  content: string;
  streaming?: boolean;
  class?: string;
}

const STREAM_RENDER_DEBOUNCE_MS = 160;
const STREAM_RENDER_MAX_WAIT_MS = 1000;
const STREAM_APPEND_GUARD_LEN = 64;

// Lazy-loaded marked instance with custom renderer configuration
let markedInstance: any = null;
let markedLoading = false;
let markedLoadQueue: Array<() => void> = [];

let markdownWorkerUnavailable = false;
let markdownWorkerErrorLogged = false;

function escapeHtml(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLanguageClass(lang?: string): string {
  const v = String(lang ?? '').trim();
  if (!v) return '';
  const safe = v.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe ? ` language-${safe}` : '';
}

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
            return `<code class="chat-md-inline-code">${escapeHtml(token.text)}</code>`;
          },
          code(token: { text: string; lang?: string }) {
            const langClass = normalizeLanguageClass(token.lang).trim() || 'language-text';
            return `<pre class="chat-md-code-block"><code class="${langClass}">${escapeHtml(token.text)}</code></pre>`;
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

async function renderMarkdownFallback(content: string): Promise<string> {
  const marked = await getMarked();
  if (!marked) {
    throw new Error('marked failed to load');
  }
  return marked.parse(content, { async: false }) as string;
}

type StreamingTextProps = {
  text: string;
  offset?: number;
  class?: string;
};

// StreamingText incrementally appends text to the DOM to avoid O(n) textContent
// updates on every stream delta (which becomes O(n^2) for long outputs).
const StreamingText: Component<StreamingTextProps> = (props) => {
  const [el, setEl] = createSignal<HTMLDivElement | null>(null);

  let lastOffset = 0;
  let lastLen = 0;
  let lastGuard = '';

  let pending = '';
  let rafId: number | null = null;

  const scheduleFlush = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const node = el();
      if (!node) return;
      if (!pending) return;
      const text = pending;
      pending = '';
      node.appendChild(document.createTextNode(text));
    });
  };

  const reset = (fullText: string, offset: number) => {
    const node = el();
    if (!node) return;

    node.textContent = '';
    pending = fullText.slice(offset);

    lastOffset = offset;
    lastLen = fullText.length;

    const guardLen = Math.min(STREAM_APPEND_GUARD_LEN, lastLen);
    lastGuard = guardLen > 0 ? fullText.slice(lastLen - guardLen, lastLen) : '';
    scheduleFlush();
  };

  createEffect(() => {
    const node = el();
    if (!node) return;

    const fullText = String(props.text ?? '');
    const rawOffset = typeof props.offset === 'number' && Number.isFinite(props.offset) ? props.offset : 0;
    const offset = Math.max(0, Math.min(rawOffset, fullText.length));

    if (offset !== lastOffset || fullText.length < lastLen) {
      reset(fullText, offset);
      return;
    }

    const guardLen = Math.min(STREAM_APPEND_GUARD_LEN, lastLen);
    if (guardLen > 0) {
      const currentGuard = fullText.slice(lastLen - guardLen, lastLen);
      if (currentGuard !== lastGuard) {
        reset(fullText, offset);
        return;
      }
    }

    if (fullText.length === lastLen) return;

    pending += fullText.slice(lastLen);
    lastLen = fullText.length;

    const newGuardLen = Math.min(STREAM_APPEND_GUARD_LEN, lastLen);
    lastGuard = newGuardLen > 0 ? fullText.slice(lastLen - newGuardLen, lastLen) : '';
    scheduleFlush();
  });

  onCleanup(() => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  });

  return (
    <div
      ref={(node) => setEl(node)}
      class={cn('chat-streaming-text', props.class)}
      style={{ 'white-space': 'pre-wrap' }}
    />
  );
};

/**
 * Renders markdown content. While streaming, it throttles re-render frequency.
 */
export const MarkdownBlock: Component<MarkdownBlockProps> = (props) => {
  const [renderedHtml, setRenderedHtml] = createSignal<string>('');
  const [renderedText, setRenderedText] = createSignal<string>('');
  const isEmptyStreaming = createMemo(() => props.streaming === true && String(props.content ?? '') === '');

  let destroyed = false;
  let inFlight = false;
  let queuedContent: { content: string; force: boolean } | null = null;

  let hasRenderedOnce = false;
  let latestContent = '';

  let debounceTimer: number | null = null;
  let maxWaitTimer: number | null = null;
  let lastStartAtMs = 0;

  const clearDebounceTimer = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  const clearMaxWaitTimer = () => {
    if (maxWaitTimer !== null) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const startRender = (content: string, force: boolean) => {
    if (destroyed) return;
    const requested = String(content ?? '');
    if (!requested) return;

    clearDebounceTimer();
    clearMaxWaitTimer();
    lastStartAtMs = Date.now();

    // Overwrite any stale queued content so we never render older text after this request.
    queuedContent = { content: requested, force: false };

    void (async () => {
      inFlight = true;
      try {
        let html: string | null = null;
        if (!markdownWorkerUnavailable) {
          html = await renderMarkdownHtml(requested).catch(async (err) => {
            markdownWorkerUnavailable = true;
            if (!markdownWorkerErrorLogged) {
              markdownWorkerErrorLogged = true;
              console.warn('Markdown worker render failed; streaming parse disabled:', err);
            }
            if (!force) {
              throw err;
            }
            return await renderMarkdownFallback(requested);
          });
        } else if (force) {
          html = await renderMarkdownFallback(requested);
        }

        if (destroyed) return;
        if (html === null) return;

        setRenderedHtml(String(html ?? ''));
        setRenderedText(requested);
        hasRenderedOnce = true;
      } catch (err) {
        // Keep the previous HTML if available; streaming text remains visible.
        if (force) {
          console.error('Markdown render error:', err);
        }
      } finally {
        inFlight = false;
      }
      if (destroyed) return;

      const next = queuedContent;
      queuedContent = null;
      if (next && next.content !== requested) {
        scheduleRender(next.content, next.force);
      }
    })();
  };

  const scheduleRender = (content: string, force: boolean) => {
    if (destroyed) return;
    const text = String(content ?? '');
    latestContent = text;

    if (!text) {
      clearDebounceTimer();
      clearMaxWaitTimer();
      queuedContent = null;
      setRenderedHtml('');
      setRenderedText('');
      hasRenderedOnce = false;
      return;
    }

    if (markdownWorkerUnavailable && !force) {
      return;
    }

    if (inFlight) {
      queuedContent = { content: text, force: queuedContent?.force === true ? true : force };
      return;
    }

    if (force || !hasRenderedOnce) {
      startRender(text, force);
      return;
    }

    clearDebounceTimer();

    // Debounce: wait for a short pause. If streaming never pauses, maxWait triggers.
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      if (destroyed) return;
      if (markdownWorkerUnavailable && !force) return;
      if (inFlight) {
        queuedContent = { content: latestContent, force: false };
        return;
      }
      startRender(latestContent, force);
    }, STREAM_RENDER_DEBOUNCE_MS);

    // Max-wait: keep markdown styling fresh during long continuous streams.
    if (maxWaitTimer === null) {
      const now = Date.now();
      const sinceLastStart = lastStartAtMs > 0 ? now - lastStartAtMs : 0;
      const dueIn = Math.max(0, STREAM_RENDER_MAX_WAIT_MS - sinceLastStart);
      maxWaitTimer = window.setTimeout(() => {
        maxWaitTimer = null;
        if (destroyed) return;
        if (markdownWorkerUnavailable && !force) return;
        if (inFlight) {
          queuedContent = { content: latestContent, force: false };
          return;
        }
        startRender(latestContent, force);
      }, dueIn);
    }
  };

  onCleanup(() => {
    destroyed = true;
    clearDebounceTimer();
    clearMaxWaitTimer();
    queuedContent = null;
  });

  const canUseHtml = createMemo(() => {
    const html = renderedHtml();
    if (!html) return false;
    const base = renderedText();
    if (!base) return false;
    const current = String(props.content ?? '');
    if (current.length < base.length) return false;

    // Hot-path: avoid O(n) startsWith checks on every stream delta. For markdown blocks,
    // the content is expected to be append-only (block-delta). We validate with a small
    // suffix guard instead of full prefix comparison to keep streaming smooth.
    const guardLen = Math.min(STREAM_APPEND_GUARD_LEN, base.length);
    if (guardLen === 0) return true;
    const guard = base.slice(base.length - guardLen);
    return current.slice(base.length - guardLen, base.length) === guard;
  });

  // Render markdown to HTML when content changes (including during streaming).
  createEffect(() => {
    const content = String(props.content ?? '');
    const streaming = props.streaming === true;
    // When streaming stops, force a final parse to avoid leaving a throttled frame behind.
    scheduleRender(content, !streaming);
  });

  return (
    <div class={cn('chat-markdown-block', props.class)}>
      <Show when={!isEmptyStreaming()} fallback={
        <div class="chat-markdown-empty-streaming" aria-label="Assistant is responding">
          <StreamingCursor />
        </div>
      }>
        <Show when={canUseHtml()} fallback={<StreamingText text={String(props.content ?? '')} />}>
          {/* eslint-disable-next-line solid/no-innerhtml */}
          <div innerHTML={renderedHtml()} />
          <StreamingText
            text={String(props.content ?? '')}
            offset={renderedText().length}
          />
        </Show>
      </Show>
    </div>
  );
};
