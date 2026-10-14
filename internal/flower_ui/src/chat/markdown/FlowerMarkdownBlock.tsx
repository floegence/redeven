import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import type { Accessor, Component } from 'solid-js';
import { render } from 'solid-js/web';
import { Marked } from 'marked';
import { cn } from '@floegence/floe-webapp-core';
import { Check, Copy } from '@floegence/floe-webapp-core/icons';
import { enhanceCodeBlock } from '@floegence/floe-webapp-core/code-highlight';
import { MarkdownMedia, readMarkdownMediaPlaceholder, type MarkdownMediaLabels, type MarkdownMediaProps } from '@floegence/floe-webapp-core/chat';

import { writeTextToClipboard } from '../../clipboard';
import { createFlowerMarkdownRenderer } from './markedConfig';
import { normalizeMarkdownForDisplay } from './normalizeMarkdownForDisplay';
import { createMarkdownRenderModel, type MarkdownRenderSnapshot } from './streamingMarkdownModel';
import { StreamingMarkdownTail } from './StreamingMarkdownTail';
import { prepareFlowerCitations } from './flowerCitations';
import { parseFlowerSourceFence, renderFlowerSourceCards } from './flowerSourceCards';
import type { FlowerCitationSource } from '../../contracts/flowerSurfaceContracts';
import {
  decorateFlowerMarkdownCodeBlocks,
  flowerMarkdownCodeTextForCopyButton,
} from './codeBlockCopy';

export interface FlowerMarkdownBlockProps {
  content: string;
  sources?: readonly FlowerCitationSource[];
  citationLabels?: Readonly<{ sources: string; unavailable: string; copy?: string }>;
  streaming?: boolean;
  copyCodeLabel: string;
  codeCopiedLabel: string;
  mediaLabels?: MarkdownMediaLabels;
  resolveMedia?: MarkdownMediaProps['resolve'];
  class?: string;
}

export const FlowerMarkdownBlock: Component<FlowerMarkdownBlockProps> = (props) => {
  const marked = new Marked<string, string>({
    gfm: true,
    breaks: false,
    pedantic: false,
  });
  marked.use({ renderer: createFlowerMarkdownRenderer({
    media: props.mediaLabels !== undefined,
    sourceFence: token => {
      if (!props.citationLabels) return null;
      const sources = parseFlowerSourceFence(token);
      return sources ? renderFlowerSourceCards(sources, props.citationLabels, token.text) : null;
    },
  }) });

  const [copiedButton, setCopiedButton] = createSignal<HTMLButtonElement | null>(null);
  const citations = createMemo(() => props.citationLabels
    ? prepareFlowerCitations(String(props.content ?? ''), props.sources ?? [], props.citationLabels.unavailable, props.streaming === true)
    : { markdown: String(props.content ?? ''), html: [], remaining: [] });
  marked.use({ extensions: [{
    name: 'flowerCitation', level: 'inline',
    start(source) { return source.indexOf('\uE200flower-citation:'); },
    tokenizer(source) {
      const match = /^\uE200flower-citation:(\d+)\uE201/.exec(source);
      return match ? { type: 'flowerCitation', raw: match[0], index: Number(match[1]) } : undefined;
    },
    renderer(token) { return citations().html[Number(token.index)] ?? ''; },
  }] });
  const displayContent = createMemo(() => normalizeMarkdownForDisplay(citations().markdown));
  const renderMarkdown = createMarkdownRenderModel(marked);
  const snapshot = createMemo<MarkdownRenderSnapshot>(() => renderMarkdown(
    displayContent(),
    props.streaming === true,
    JSON.stringify([citations().html, props.citationLabels]),
  ));
  const segments = createMemo(() => new Map(snapshot().committedSegments.map((segment) => [segment.key, segment])));
  const segmentKeys = createMemo(() => [...segments().keys()]);
  const remainingSourcesHTML = createMemo(() => props.citationLabels ? renderFlowerSourceCards(
    citations().remaining,
    props.citationLabels,
    citations().remaining.map((source, index) => `[${index + 1}] ${source.title || new URL(source.url).hostname}\n${source.url}`).join('\n\n'),
  ) : '');
  let rootRef: HTMLDivElement | undefined;
  let copiedResetTimer: number | undefined;
  const iconCleanups = new WeakMap<HTMLButtonElement, () => void>();
  const mountedButtons = new Set<HTMLButtonElement>();

  onCleanup(() => {
    if (copiedResetTimer !== undefined) {
      window.clearTimeout(copiedResetTimer);
    }
    for (const button of Array.from(mountedButtons)) {
      iconCleanups.get(button)?.();
    }
    mountedButtons.clear();
  });

  const resetCopiedButton = () => {
    const button = copiedButton();
    if (!button) return;
    button.dataset.copied = 'false';
    const label = copyLabel(button);
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    setCopiedButton(null);
  };

  const mountCopyIcons = (button: HTMLButtonElement) => {
    if (iconCleanups.has(button)) return;
    const cleanup = render(() => (
      <>
        <Copy class="flower-chat-md-copy-svg flower-chat-md-copy-svg-idle h-3.5 w-3.5" />
        <Check class="flower-chat-md-copy-svg flower-chat-md-copy-svg-copied h-3.5 w-3.5" />
      </>
    ), button);
    iconCleanups.set(button, cleanup);
    mountedButtons.add(button);
  };

  const copyLabels = () => {
    return {
      copy: props.copyCodeLabel,
      copied: props.codeCopiedLabel,
    };
  };

  const copyLabel = (button: HTMLButtonElement) => button.hasAttribute('data-flower-source-copy')
    ? props.citationLabels?.copy ?? props.copyCodeLabel : props.copyCodeLabel;

  const handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button.flower-chat-md-code-copy');
    if (!(button instanceof HTMLButtonElement)) return;
    if (!rootRef?.contains(button)) return;
    const code = button.dataset.flowerSourceCopy ?? flowerMarkdownCodeTextForCopyButton(button);
    if (!code) return;
    event.preventDefault();
    event.stopPropagation();

    void writeTextToClipboard(code).then(() => {
      if (copiedResetTimer !== undefined) {
        window.clearTimeout(copiedResetTimer);
      }
      if (copiedButton() && copiedButton() !== button) {
        resetCopiedButton();
      }
      button.dataset.copied = 'true';
      button.setAttribute('aria-label', props.codeCopiedLabel);
      button.setAttribute('title', props.codeCopiedLabel);
      setCopiedButton(button);
      copiedResetTimer = window.setTimeout(resetCopiedButton, 1600);
    });
  };

  const decorateRegion = (element: Accessor<HTMLDivElement>, content: Accessor<unknown>, committed = true) => {
    let buttons: readonly HTMLButtonElement[] = [];
    const media = new Map<HTMLElement, () => void>();
    const highlighted = new Map<HTMLElement, () => void>();
    const release = (button: HTMLButtonElement) => {
      iconCleanups.get(button)?.();
      iconCleanups.delete(button);
      mountedButtons.delete(button);
    };
    createEffect(() => {
      content();
      const labels = copyLabels();
      let cancelled = false;
      onCleanup(() => { cancelled = true; });
      queueMicrotask(() => {
        if (cancelled) return;
        const root = element();
        for (const button of buttons) {
          if (!root.contains(button)) release(button);
        }
        const sourceButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('button[data-flower-source-copy]'));
        for (const button of sourceButtons) {
          mountCopyIcons(button);
          const label = button.dataset.copied === 'true' ? props.codeCopiedLabel : copyLabel(button);
          button.setAttribute('aria-label', label);
          button.setAttribute('title', label);
        }
        buttons = [...decorateFlowerMarkdownCodeBlocks(root, labels, mountCopyIcons), ...sourceButtons];
        for (const [node, dispose] of highlighted) {
          if (!root.contains(node)) { dispose(); highlighted.delete(node); }
        }
        // Only committed segments own enhancement. Streaming tails remain appendable.
        if (committed) {
          for (const code of root.querySelectorAll<HTMLElement>('pre.flower-chat-md-code-block > code')) {
            if (!highlighted.has(code)) highlighted.set(code, enhanceCodeBlock(code, code.dataset.flowerCodeLanguage ?? ''));
          }
        }
        for (const [node, dispose] of media) {
          if (!root.contains(node)) { dispose(); media.delete(node); }
        }
        for (const node of root.querySelectorAll<HTMLElement>('[data-floe-markdown-media]')) {
          if (media.has(node) || !props.mediaLabels) continue;
          const source = readMarkdownMediaPlaceholder(node);
          if (!source) continue;
          if (!committed) { node.textContent = source.title || source.src || props.mediaLabels.html; continue; }
          media.set(node, render(() => <MarkdownMedia source={source} labels={props.mediaLabels!} resolve={props.resolveMedia} />, node));
        }
      });
    });
    onCleanup(() => {
      for (const button of buttons) release(button);
      for (const dispose of media.values()) dispose();
      media.clear();
      for (const dispose of highlighted.values()) dispose();
      highlighted.clear();
    });
  };

  const HtmlSegment: Component<{ segmentKey: string }> = (segmentProps) => {
    let element!: HTMLDivElement;
    const html = createMemo(() => segments().get(segmentProps.segmentKey)?.html ?? '');
    decorateRegion(() => element, html);
    return <div ref={element} class="flower-chat-md-committed-segment" data-segment-key={segmentProps.segmentKey} innerHTML={html()} />;
  };

  const TailFrame: Component = () => {
    let element!: HTMLDivElement;
    const tail = createMemo(() => snapshot().tail);
    decorateRegion(() => element, () => tail().kind === 'html' ? tail() : null, false);
    return <div ref={element} class="flower-chat-md-tail-frame"><StreamingMarkdownTail tail={tail()} /></div>;
  };

  const RemainingSources: Component = () => {
    let element!: HTMLDivElement;
    decorateRegion(() => element, remainingSourcesHTML);
    return <div ref={element} innerHTML={remainingSourcesHTML()} />;
  };

  return (
    <div ref={(node) => { rootRef = node; }} class={cn('flower-chat-md-block', props.class)} onClick={handleClick}>
      <For each={segmentKeys()}>{(key) => <HtmlSegment segmentKey={key} />}</For>
      <Show when={snapshot().tail.kind !== 'empty'}><TailFrame /></Show>
      <Show when={citations().remaining.length > 0 && props.streaming !== true}>
        <RemainingSources />
      </Show>
    </div>
  );
};
