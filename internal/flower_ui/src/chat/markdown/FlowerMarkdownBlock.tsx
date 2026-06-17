import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import type { Component } from 'solid-js';
import { render } from 'solid-js/web';
import { Marked } from 'marked';
import { cn } from '@floegence/floe-webapp-core';
import { Check, Copy } from '@floegence/floe-webapp-core/icons';

import { writeTextToClipboard } from '../../clipboard';
import { createFlowerMarkdownRenderer } from './markedConfig';
import { normalizeMarkdownForDisplay } from './normalizeMarkdownForDisplay';
import { buildMarkdownRenderSnapshot, type MarkdownRenderSnapshot } from './streamingMarkdownModel';
import { StreamingMarkdownTail } from './StreamingMarkdownTail';
import {
  applyFlowerMarkdownCodeCopyLabel,
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
  const snapshot = createMemo<MarkdownRenderSnapshot>(() => buildMarkdownRenderSnapshot(
    marked,
    displayContent(),
    props.streaming === true,
  ));
  const segmentKeys = createMemo(() => snapshot().committedSegments.map((segment) => segment.key));
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

  const disposeDetachedCopyButtons = () => {
    const root = rootRef;
    for (const button of Array.from(mountedButtons)) {
      if (root?.contains(button)) continue;
      iconCleanups.get(button)?.();
      mountedButtons.delete(button);
    }
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

  const decorateCodeBlocks = (root: HTMLDivElement, labels = copyLabels()) => {
    disposeDetachedCopyButtons();
    decorateFlowerMarkdownCodeBlocks(root, labels, mountCopyIcons);
  };

  createEffect(() => {
    snapshot();
    const labels = copyLabels();
    queueMicrotask(() => {
      const root = rootRef;
      if (!root) return;
      decorateCodeBlocks(root, labels);
      const buttons = root.querySelectorAll<HTMLButtonElement>('.flower-chat-md-code-copy');
      for (const button of Array.from(buttons)) {
        applyFlowerMarkdownCodeCopyLabel(button, labels);
      }
    });
  });

  return (
    <div ref={(node) => { rootRef = node; }} class={cn('flower-chat-md-block', props.class)} onClick={handleClick}>
      <For each={segmentKeys()}>
        {(key) => {
          const committedSegmentHtml = () => snapshot().committedSegments.find((segment) => segment.key === key)?.html ?? '';

          return (
            <div
              class="flower-chat-md-committed-segment"
              data-segment-key={key}
              innerHTML={committedSegmentHtml()}
            />
          );
        }}
      </For>
      <Show when={snapshot().tail.kind !== 'empty'}>
        <div class="flower-chat-md-tail-frame">
          <StreamingMarkdownTail tail={snapshot().tail} />
        </div>
      </Show>
    </div>
  );
};
