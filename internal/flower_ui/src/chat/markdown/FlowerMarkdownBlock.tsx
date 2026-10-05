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
import {
  decorateFlowerMarkdownCodeBlocks,
  flowerMarkdownCodeTextForCopyButton,
} from './codeBlockCopy';

export interface FlowerMarkdownBlockProps {
  content: string;
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
  marked.use({ renderer: createFlowerMarkdownRenderer({ media: props.mediaLabels !== undefined }) });

  const [copiedButton, setCopiedButton] = createSignal<HTMLButtonElement | null>(null);
  const displayContent = createMemo(() => normalizeMarkdownForDisplay(String(props.content ?? '')));
  const renderMarkdown = createMarkdownRenderModel(marked);
  const snapshot = createMemo<MarkdownRenderSnapshot>(() => renderMarkdown(
    displayContent(),
    props.streaming === true,
  ));
  const segments = createMemo(() => new Map(snapshot().committedSegments.map((segment) => [segment.key, segment])));
  const segmentKeys = createMemo(() => [...segments().keys()]);
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
    button.setAttribute('aria-label', props.copyCodeLabel);
    button.setAttribute('title', props.copyCodeLabel);
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

  const handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest('button.flower-chat-md-code-copy');
    if (!(button instanceof HTMLButtonElement)) return;
    if (!rootRef?.contains(button)) return;
    const code = flowerMarkdownCodeTextForCopyButton(button);
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
        buttons = decorateFlowerMarkdownCodeBlocks(root, labels, mountCopyIcons);
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

  return (
    <div ref={(node) => { rootRef = node; }} class={cn('flower-chat-md-block', props.class)} onClick={handleClick}>
      <For each={segmentKeys()}>{(key) => <HtmlSegment segmentKey={key} />}</For>
      <Show when={snapshot().tail.kind !== 'empty'}><TailFrame /></Show>
    </div>
  );
};
