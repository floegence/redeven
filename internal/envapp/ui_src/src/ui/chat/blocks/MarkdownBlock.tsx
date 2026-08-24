// MarkdownBlock — renders markdown content as stable committed segments plus a live tail.
//
// During streaming, committed content keeps a stable HTML projection. Once a markdown tail has
// rendered, the UI keeps that tail visible until a fresher snapshot arrives instead of regressing
// it back into raw markdown source. Raw streaming text is only used before the first compatible
// snapshot exists or when the current snapshot still has no rendered tail.

import { batch, createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import type { Component } from 'solid-js';
import type { Marked } from 'marked';
import { cn } from '@floegence/floe-webapp-core';

import { StreamingMarkdownTail } from '../markdown/StreamingMarkdownTail';
import { createMarkdownRenderer } from '../markdown/markedConfig';
import { normalizeMarkdownForDisplay, normalizeMarkdownForStreamingDisplay } from '../markdown/normalizeMarkdownForDisplay';
import { AppendOnlyText, isAppendOnlyTextCompatible } from '../status/AppendOnlyText';
import { buildMarkdownRenderSnapshot } from '../markdown/streamingMarkdownModel';
import { StreamingCursor } from '../status/StreamingCursor';
import { StreamingShimmer } from '../status/StreamingShimmer';
import type { MarkdownRenderSnapshot } from '../types';
import { renderMarkdownSnapshot } from '../workers/markdownWorkerClient';
import { useI18n } from '../../i18n';

export interface MarkdownBlockProps {
  content: string;
  streaming?: boolean;
  class?: string;
}

type MarkedState = {
  instance: Marked<string, string> | null;
  loading: boolean;
  queue: Array<() => void>;
};

let markedState: MarkedState | null = null;

let markdownWorkerUnavailable = false;
let markdownWorkerErrorLogged = false;

function getMarkedState(): MarkedState {
  if (!markedState) markedState = { instance: null, loading: false, queue: [] };
  return markedState;
}

async function getMarked(): Promise<Marked<string, string> | null> {
  const state = getMarkedState();
  if (state.instance) return state.instance;

  return new Promise<Marked<string, string> | null>((resolve) => {
    state.queue.push(() => resolve(state?.instance ?? null));

    if (state.loading) return;
    state.loading = true;

    import('marked')
      .then(({ Marked }) => {
        const instance = new Marked<string, string>();
        instance.use({ renderer: createMarkdownRenderer() });
        state.instance = instance;
        state.loading = false;

        for (const callback of state.queue) callback();
        state.queue = [];
      })
      .catch((err) => {
        console.error('Failed to load marked:', err);
        state.loading = false;
        state.queue = [];
      });
  });
}

async function renderMarkdownFallback(
  content: string,
  streaming: boolean,
): Promise<MarkdownRenderSnapshot> {
  const marked = await getMarked();
  if (!marked) {
    throw new Error('marked failed to load');
  }
  return buildMarkdownRenderSnapshot(marked, content, streaming);
}

export const MarkdownBlock: Component<MarkdownBlockProps> = (props) => {
  const i18n = useI18n();
  const [renderedSnapshot, setRenderedSnapshot] = createSignal<MarkdownRenderSnapshot | null>(null);
  const [renderedText, setRenderedText] = createSignal('');
  const displayContent = createMemo(() => (
    props.streaming === true
      ? normalizeMarkdownForStreamingDisplay(String(props.content ?? ''))
      : normalizeMarkdownForDisplay(String(props.content ?? ''))
  ));
  const isEmptyStreaming = createMemo(() => props.streaming === true && displayContent() === '');
  const showStreamingCursor = createMemo(() => props.streaming === true && !isEmptyStreaming());

  let destroyed = false;
  let inFlight = false;
  let queuedContent: { content: string; streaming: boolean } | null = null;

  const clearSnapshot = () => {
    queuedContent = null;
    setRenderedSnapshot(null);
    setRenderedText('');
  };

  const startRender = (content: string, streaming: boolean) => {
    if (destroyed) return;
    const requested = String(content ?? '');
    if (!requested) {
      clearSnapshot();
      return;
    }

    void (async () => {
      inFlight = true;
      try {
        let snapshot: MarkdownRenderSnapshot | null = null;
        if (!markdownWorkerUnavailable) {
          snapshot = await renderMarkdownSnapshot(requested, { streaming }).catch(async (err) => {
            markdownWorkerUnavailable = true;
            if (!markdownWorkerErrorLogged) {
              markdownWorkerErrorLogged = true;
              console.warn('Markdown worker render failed; streaming parse disabled:', err);
            }
            if (streaming) {
              throw err;
            }
            return await renderMarkdownFallback(requested, streaming);
          });
        } else if (!streaming) {
          snapshot = await renderMarkdownFallback(requested, streaming);
        }

        if (destroyed || snapshot === null) return;
        batch(() => {
          setRenderedSnapshot(snapshot);
          setRenderedText(requested);
        });
      } catch (err) {
        if (!streaming) {
          console.error('Markdown render error:', err);
        }
      } finally {
        inFlight = false;
      }

      if (destroyed) return;

      const next = queuedContent;
      queuedContent = null;
      if (next && (
        next.content !== requested
        || next.streaming !== streaming
      )) {
        scheduleRender(next.content, next.streaming);
      }
    })();
  };

  const scheduleRender = (
    content: string,
    streaming: boolean,
  ) => {
    if (destroyed) return;

    if (!content) {
      clearSnapshot();
      return;
    }

    if (markdownWorkerUnavailable && streaming) {
      return;
    }

    if (inFlight) {
      queuedContent = { content, streaming };
      return;
    }

    startRender(content, streaming);
  };

  onCleanup(() => {
    destroyed = true;
    queuedContent = null;
  });

  createEffect(() => {
    scheduleRender(displayContent(), props.streaming === true);
  });

  const renderState = createMemo(() => {
    const snapshot = renderedSnapshot();
    if (!snapshot) return null;

    const base = renderedText();
    const current = displayContent();
    if (!isAppendOnlyTextCompatible(base, current)) return null;

    return {
      snapshot,
      current,
    };
  });

  return (
    <div class={cn('chat-markdown-block', props.class)}>
      <Show
        when={!isEmptyStreaming()}
        fallback={
          <div class="chat-markdown-empty-streaming" aria-label={i18n.t('chatChrome.assistantIsResponding')}>
            <StreamingShimmer />
          </div>
        }
      >
        <Show when={renderState()} fallback={<AppendOnlyText text={displayContent()} />}>
          {(stateAccessor) => {
            const state = () => stateAccessor();
            const shouldRenderRawSuffix = () =>
              state().snapshot.tail.kind !== 'html'
              && state().snapshot.committedSourceLength < state().current.length;
            const shouldRenderTailHtml = () =>
              state().snapshot.tail.kind === 'html';
            const committedSegmentKeys = () => state().snapshot.committedSegments.map((segment) => segment.key);
            const committedSegmentHtml = (key: string) =>
              state().snapshot.committedSegments.find((segment) => segment.key === key)?.html ?? '';

            return (
              <>
                <For each={committedSegmentKeys()}>
                  {(key) => (
                    <div
                      class="chat-markdown-committed-segment"
                      data-segment-key={key}
                      // eslint-disable-next-line solid/no-innerhtml
                      innerHTML={committedSegmentHtml(key)}
                    />
                  )}
                </For>

                <Show when={shouldRenderTailHtml()}>
                  <StreamingMarkdownTail tail={state().snapshot.tail} />
                </Show>

                <Show when={shouldRenderRawSuffix()}>
                  <AppendOnlyText
                    text={state().current}
                    offset={state().snapshot.committedSourceLength}
                  />
                </Show>
              </>
            );
          }}
        </Show>

        <Show when={showStreamingCursor()}>
          <div class="chat-markdown-streaming-cursor-row" aria-hidden="true">
            <StreamingCursor />
          </div>
        </Show>
      </Show>
    </div>
  );
};
