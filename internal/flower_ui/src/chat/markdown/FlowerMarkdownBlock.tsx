import { batch, createEffect, createMemo, createSignal, createRoot, onCleanup, Show, untrack } from 'solid-js';
import type { Component, JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { createMarkdownParser } from '@floegence/floe-webapp-core/markdown';
import { cn } from '@floegence/floe-webapp-core';
import { Check, Copy } from '@floegence/floe-webapp-core/icons';
import { enhanceCodeBlock } from '@floegence/floe-webapp-core/code-highlight';
import { MarkdownMedia, readMarkdownMediaPlaceholder, type MarkdownMediaLabels, type MarkdownMediaProps } from '@floegence/floe-webapp-core/chat';

import { writeTextToClipboard } from '../../clipboard';
import { createFlowerMarkdownRenderer, isFlowerHTMLPreviewFence } from './markedConfig';
import { createMarkdownRenderModel } from './streamingMarkdownModel';
import { createIncrementalMarkdownDOM } from './incrementalMarkdownDOM';
import { createIncrementalCitations } from './incrementalCitations';
import { enhanceFlowerSourceIcons, type FlowerSourceIconResolver } from './flowerSourceIcons';
import { parseFlowerSourceFence, renderFlowerSourceCards } from './flowerSourceCards';
import type { FlowerCitationSource, FlowerMessageTextSource } from '../../contracts/flowerSurfaceContracts';
import {
  decorateFlowerMarkdownCodeBlocks,
  flowerMarkdownCodeTextForCopyButton,
} from './codeBlockCopy';
import { markdownMediaEnUS } from './mediaCopy';

export interface FlowerMarkdownBlockProps {
  content: string;
  textSource?: FlowerMessageTextSource;
  footer?: JSX.Element;
  sources?: readonly FlowerCitationSource[];
  citationLabels?: Readonly<{ sources: string; unavailable: string }>;
  streaming?: boolean;
  /** Keep media references inert even while localized media labels are loading. */
  mediaEnabled?: boolean;
  copyCodeLabel: string;
  codeCopiedLabel: string;
  mediaLabels?: MarkdownMediaLabels;
  resolveSourceIcon?: FlowerSourceIconResolver;
  resolveMedia?: MarkdownMediaProps['resolve'];
  onOpenMediaLink?: MarkdownMediaProps['onOpenLink'];
  onOpenMediaLinkError?: (error: unknown) => void;
  class?: string;
}

export const FlowerMarkdownBlock: Component<FlowerMarkdownBlockProps> = (props) => {
  const marked = createMarkdownParser({
    gfm: true,
    breaks: false,
    pedantic: false,
  });
  marked.use({ renderer: createFlowerMarkdownRenderer({
    media: props.mediaEnabled === true,
    sourceFence: token => {
      if (!props.citationLabels) return null;
      const sources = parseFlowerSourceFence(token);
      return sources ? renderFlowerSourceCards(sources, props.citationLabels) : null;
    },
  }) });

  const [copiedButton, setCopiedButton] = createSignal<HTMLButtonElement | null>(null);
  const citations = createIncrementalCitations(marked, {
    sources: () => props.sources ?? [], unavailable: () => props.citationLabels?.unavailable ?? '', streaming: () => props.streaming === true,
  });
  const [remainingSourcesHTML, setRemainingSourcesHTML] = createSignal('');
  let contentRef!: HTMLDivElement;
  let sourcesRef!: HTMLDivElement;
  let rootRef: HTMLDivElement | undefined;
  let copiedResetTimer: number | undefined;
  let activeLinkController: AbortController | undefined;
  const iconCleanups = new WeakMap<HTMLButtonElement, () => void>();
  const mountedButtons = new Set<HTMLButtonElement>();
  const resolvedMediaLabels = () => props.mediaLabels ?? markdownMediaEnUS;

  onCleanup(() => {
    if (copiedResetTimer !== undefined) {
      window.clearTimeout(copiedResetTimer);
    }
    activeLinkController?.abort();
    for (const button of Array.from(mountedButtons)) {
      iconCleanups.get(button)?.();
    }
    mountedButtons.clear();
  });

  const resetCopiedButton = () => {
    const button = copiedButton();
    if (!button) return;
    button.dataset.copied = 'false';
    const label = props.copyCodeLabel;
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

  const handleClick = (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const toggle = target.closest<HTMLButtonElement>('button.flower-chat-source-toggle');
    if (toggle && rootRef?.contains(toggle)) {
      const list = toggle.closest('.flower-chat-source-list')?.querySelector<HTMLOListElement>('.flower-chat-source-grid');
      if (list) { list.hidden = !list.hidden; toggle.setAttribute('aria-expanded', String(!list.hidden)); }
      return;
    }
    const button = target.closest('button.flower-chat-md-code-copy');
    if (button instanceof HTMLButtonElement && rootRef?.contains(button)) {
      const code = flowerMarkdownCodeTextForCopyButton(button);
      if (code) {
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
        return;
      }
    }

    const link = target.closest<HTMLAnchorElement>('a.flower-chat-md-link');
    const openMediaLink = props.onOpenMediaLink;
    if (!link || !rootRef?.contains(link) || props.mediaEnabled !== true || !openMediaLink) return;
    const href = link.getAttribute('href')?.trim() ?? '';
    // External URLs and fragment links retain native browser behavior. Local
    // paths are host-authorized so reports and other files open in the
    // existing file-preview floating window instead of navigating the shell.
    if (!href || href.startsWith('#') || href.startsWith('//') || href.startsWith('\\') || /^[a-z][a-z0-9+.-]*:/i.test(href)) return;
    event.preventDefault();
    event.stopPropagation();
    activeLinkController?.abort();
    const controller = new AbortController();
    activeLinkController = controller;
    const source = { kind: 'html' as const, src: href, title: link.textContent?.trim() ?? '' };
    void Promise.resolve()
      .then(() => openMediaLink(source, href, controller.signal))
      .catch(error => {
        if (!controller.signal.aborted) props.onOpenMediaLinkError?.(error);
      })
      .finally(() => {
        if (activeLinkController === controller) activeLinkController = undefined;
      });
  };

  const decorateRegion = (element: HTMLElement, token: import('marked').Token, live: boolean) => createRoot(dispose => {
    const cleanups: (() => void)[] = [];
    const finishers: (() => void)[] = [];
    let updatePreview: ((next: import('marked').Token, streaming: boolean) => boolean) | undefined;
    const buttons = decorateFlowerMarkdownCodeBlocks(element, copyLabels(), mountCopyIcons);
    for (const node of element.querySelectorAll<HTMLElement>('.flower-chat-source-list')) cleanups.push(enhanceFlowerSourceIcons(node, props.resolveSourceIcon));
    for (const code of element.querySelectorAll<HTMLElement>('pre.flower-chat-md-code-block > code')) {
      const enhance = () => cleanups.push(enhanceCodeBlock(code, code.dataset.flowerCodeLanguage ?? ''));
      if (!live || token.type === 'code' && isClosedFence(token.raw)) enhance();
      else finishers.push(enhance);
    }
    for (const node of element.querySelectorAll<HTMLElement>('[data-floe-markdown-media]')) {
      const source = readMarkdownMediaPlaceholder(node);
      if (!source) continue;
      const htmlPreviewToken = isFlowerHTMLPreviewFence(token) ? token : undefined;
      const state = htmlPreviewToken && !isClosedFence(htmlPreviewToken.raw)
        ? live ? 'generating' as const : 'incomplete' as const : undefined;
      const [mediaSource, setMediaSource] = createSignal(source);
      const [mediaState, setMediaState] = createSignal(state);
      if (htmlPreviewToken) {
        let current = htmlPreviewToken;
        updatePreview = (next, streaming) => {
          if (!isFlowerHTMLPreviewFence(next)) return false;
          current = next;
          batch(() => {
            setMediaSource({ ...source, html: next.text });
            setMediaState(isClosedFence(next.raw) ? undefined : streaming ? 'generating' : 'incomplete');
          });
          return true;
        };
        finishers.push(() => updatePreview?.(current, false));
      }
      cleanups.push(render(() => <MarkdownMedia loadTimeoutMs={15_000} source={mediaSource()} htmlState={mediaState()} labels={resolvedMediaLabels()} resolve={props.resolveMedia} onOpenLink={props.onOpenMediaLink} />, node));
    }
    onCleanup(() => {
      for (const cleanup of cleanups) cleanup();
      for (const button of buttons) { iconCleanups.get(button)?.(); iconCleanups.delete(button); mountedButtons.delete(button); }
    });
    return { dispose, update: (next: import('marked').Token, streaming: boolean) => updatePreview?.(next, streaming) ?? false,
      finish: () => { for (const finish of finishers.splice(0)) finish(); } };
  });
  const isClosedFence = (raw: string) => {
    const end = raw.trimEnd();
    const firstLine = end.indexOf('\n');
    if (firstLine < 0) return false;
    const opening = end.slice(0, firstLine).match(/^[ \t]{0,3}(\x60{3,}|~{3,})/)?.[1];
    const closing = end.slice(end.lastIndexOf('\n') + 1).match(/^[ \t]{0,3}(\x60+|~+)[ \t]*$/)?.[1];
    return !!opening && !!closing && opening[0] === closing[0] && closing.length >= opening.length;
  };
  let dom: ReturnType<typeof createIncrementalMarkdownDOM> | undefined;
  let model: ReturnType<typeof createMarkdownRenderModel> | undefined;
  let priorRenderingKey: string | undefined;
  let priorStreaming = false;
  let priorMediaEnabled = false;
  const renderingMetadata = createMemo(() => {
    const key = JSON.stringify([props.sources, props.citationLabels?.sources, props.citationLabels?.unavailable, props.mediaEnabled]);
    citations.sources();
    return key;
  });
  createEffect(() => {
    const streaming = props.streaming === true;
    const mediaEnabled = props.mediaEnabled === true;
    const textSource = props.textSource;
    const key = renderingMetadata();
    // Content is read only for a new record, snapshot replacement, or explicit
    // metadata boundary; source revision carries ordinary growth.
    void textSource?.revision;
    const fallback = textSource ? undefined : props.content;
    untrack(() => {
      dom ??= createIncrementalMarkdownDOM(marked, contentRef, decorateRegion, citations.locate, token => token.type === 'code' && 'text' in token && props.citationLabels && parseFlowerSourceFence(token as { text: string; lang?: string; raw?: string }) ? sourcesRef : contentRef, citations.forget);
      model ??= createMarkdownRenderModel(marked, (update, live) => dom!.apply(update, live), {
        reset: citations.reset, append: citations.index.append,
      });
      model.update(() => fallback ?? props.content, streaming, textSource, key);
      if (priorRenderingKey !== undefined && (priorRenderingKey !== key || priorStreaming && !streaming)) {
        dom.refresh((token, element) => {
          let citation = false;
          marked.walkTokens([token], child => { if (child.type === 'flowerCitation') citation = true; });
          return citation || priorRenderingKey !== key && Boolean(element.querySelector('.flower-chat-source-list'))
            || priorMediaEnabled !== mediaEnabled && Boolean(element.querySelector('[data-floe-markdown-media]'));
        }, streaming);
      }
      priorRenderingKey = key;
      priorStreaming = streaming;
      priorMediaEnabled = mediaEnabled;
      setRemainingSourcesHTML(!streaming && props.citationLabels ? renderFlowerSourceCards(citations.remaining(), props.citationLabels) : '');
    });
  });
  onCleanup(() => dom?.dispose());
  const RemainingSources: Component = () => {
    let element!: HTMLDivElement;
    createEffect(() => {
      const html = remainingSourcesHTML();
      element.innerHTML = html;
      const cleanups = [...element.querySelectorAll<HTMLElement>('.flower-chat-source-list')].map(node => enhanceFlowerSourceIcons(node, props.resolveSourceIcon));
      onCleanup(() => cleanups.forEach(cleanup => cleanup()));
    });
    return <div ref={element} />;
  };

  return (
    <div ref={(node) => { rootRef = node; }} class={cn('flower-chat-md-block', props.class)} onClick={handleClick}>
      <div ref={contentRef} class="flower-chat-md-content" />
      {props.footer}
      <div ref={sourcesRef} class="flower-chat-md-authored-sources" />
      <Show when={remainingSourcesHTML()}><RemainingSources /></Show>
    </div>
  );
};
