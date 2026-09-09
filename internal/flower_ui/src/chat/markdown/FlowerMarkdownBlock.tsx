import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import type { Accessor, Component } from 'solid-js';
import { render } from 'solid-js/web';
import { Marked } from 'marked';
import { cn } from '@floegence/floe-webapp-core';
import { Check, Copy } from '@floegence/floe-webapp-core/icons';

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
  class?: string;
}

const marked = new Marked<string, string>({
  gfm: true,
  breaks: false,
  pedantic: false,
});
marked.use({ renderer: createFlowerMarkdownRenderer() });

export const FlowerMarkdownBlock: Component<FlowerMarkdownBlockProps> = (props) => {
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

  const decorateRegion = (element: Accessor<HTMLDivElement>, content: Accessor<unknown>) => {
    let buttons: readonly HTMLButtonElement[] = [];
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
      });
    });
    onCleanup(() => { for (const button of buttons) release(button); });
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
    decorateRegion(() => element, () => tail().kind === 'html' ? tail() : null);
    return <div ref={element} class="flower-chat-md-tail-frame"><StreamingMarkdownTail tail={tail()} /></div>;
  };

  return (
    <div ref={(node) => { rootRef = node; }} class={cn('flower-chat-md-block', props.class)} onClick={handleClick}>
      <For each={segmentKeys()}>{(key) => <HtmlSegment segmentKey={key} />}</For>
      <Show when={snapshot().tail.kind !== 'empty'}><TailFrame /></Show>
    </div>
  );
};
