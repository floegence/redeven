import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import DOMPurify from 'dompurify';
import './FileMarkdown.css';
import { extractMath, reinjectMath } from './mathPlugin';
import { setupMermaid, runMermaid } from './mermaidPlugin';
import { extractFrontmatter } from './frontmatterParser';
import { buildToc, type TocItem } from './tocBuilder';
import { postProcess } from './postProcess';
import { parseMarkdown } from './markedConfig';
import { resolveFileMarkdownLink } from './linkResolver';
import type { JSX } from 'solid-js';

export interface FileMarkdownFileLinkTarget {
  path: string;
  fragment: string;
  href: string;
}

export interface FileMarkdownProps {
  content: string;
  filePath?: string;
  showToc?: boolean;
  class?: string;
  onOpenFileLink?: (target: FileMarkdownFileLinkTarget) => void | Promise<void>;
  onUnresolvedLocalLink?: (href: string, reason: string) => void;
}

const FS_FILE_ENDPOINT = '/_redeven_proxy/api/fs/file';
const TOC_HEADING_SELECTOR = 'h1.fm-heading, h2.fm-heading, h3.fm-heading, h4.fm-heading';
const TOC_ACTIVE_ANCHOR_OFFSET_PX = 88;
const TOC_SCROLL_BOTTOM_EPSILON_PX = 2;
const TOC_NAVIGATION_SETTLE_MS = 520;
const TOC_SCROLL_TOP_OFFSET_PX = 8;

function resolveImagePaths(markdown: string, mdFilePath: string): string {
  const dir = mdFilePath.replace(/[/\\][^/\\]*$/, '') || '/';

  function resolve(relativePath: string): string {
    const path = relativePath.trim();
    // Keep external URLs and data URLs as-is
    if (/^https?:\/\//i.test(path) || /^data:/i.test(path)) {
      return path;
    }
    // Resolve relative path against the markdown file's directory
    const cleaned = path.replace(/^\.\//, '');
    const absPath = dir + '/' + cleaned;
    // Normalize and encode for query string
    const normalized = absPath.replace(/\/+/g, '/');
    return FS_FILE_ENDPOINT + '?path=' + encodeURIComponent(normalized);
  }

  // Replace markdown images: ![alt](path)
  let result = markdown.replace(
    /!\[([^\]]*)\]\(([^)\s]+)\)/g,
    (_match, alt: string, src: string) => {
      return '![' + alt + '](' + resolve(src) + ')';
    },
  );

  // Replace inline HTML img tags: <img src="path" ...>
  result = result.replace(
    /(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'])/gi,
    (_match, prefix: string, src: string, suffix: string) => {
      if (/^https?:\/\//i.test(src) || /^data:/i.test(src)) {
        return prefix + src + suffix;
      }
      return prefix + resolve(src) + suffix;
    },
  );

  return result;
}

export function FileMarkdown(props: FileMarkdownProps): JSX.Element {
  const [readingMode, setReadingMode] = createSignal(false);
  const [tocVisible, setTocVisible] = createSignal(props.showToc !== false);
  const [tocItems, setTocItems] = createSignal<TocItem[]>([]);
  const [activeTocId, setActiveTocId] = createSignal('');
  let containerRef!: HTMLDivElement;
  let activeTocUpdateRaf: number | undefined;
  let tocNavigationTargetId = '';
  let tocNavigationReleaseTimer: number | undefined;
  let themeRefreshRaf: number | undefined;
  let themeObserver: MutationObserver | undefined;
  let renderGen = 0;

  const showToc = () => props.showToc !== false;

  function detectMermaidTheme(): 'dark' | 'light' {
    const html = document.documentElement;
    if (html.classList.contains('dark')) return 'dark';
    if (html.classList.contains('light')) return 'light';
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }

  const renderedHtml = createMemo(() => {
    renderGen += 1;
    const gen = renderGen;

    // 0. Resolve relative image paths before parsing
    const mdPath = props.filePath ?? '';
    const contentWithResolvedImages = mdPath
      ? resolveImagePaths(props.content, mdPath)
      : props.content;

    // 1. Extract frontmatter
    const { body, html: fmHtml } = extractFrontmatter(contentWithResolvedImages);

    // 2. Extract and pre-render math
    const { renders: mathRenders, processed: processedMath } = extractMath(body);

    // 3. Parse markdown
    let html = parseMarkdown(processedMath);

    // 4. Reinject math
    html = reinjectMath(html, mathRenders);

    // 5. Prepend frontmatter
    if (fmHtml) {
      html = fmHtml + html;
    }

    // 6. Sanitize
    html = DOMPurify.sanitize(html, {
      ADD_TAGS: [
        'foreignObject', 'annotation-xml', 'semantics', 'annotation',
        'math', 'mi', 'mo', 'mn', 'mrow', 'msup', 'msub', 'msubsup',
        'mfrac', 'mspace', 'mtext', 'menclose', 'munder', 'mover',
        'munderover', 'mtable', 'mtr', 'mtd', 'mstyle',
        'svg', 'path', 'circle', 'line', 'rect', 'polyline', 'polygon',
        'text', 'tspan', 'g', 'defs', 'marker', 'use',
      ],
      ADD_ATTR: ['align', 'target', 'mathvariant', 'displaystyle', 'mathcolor', 'd', 'cx', 'cy', 'r',
        'x', 'y', 'x1', 'x2', 'y1', 'y2', 'width', 'height', 'viewBox', 'fill',
        'stroke', 'stroke-width', 'transform', 'marker-end', 'marker-start',
        'text-anchor', 'dominant-baseline', 'font-size', 'font-family', 'font-weight',
        'data-mermaid-src',
      ],
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });

    return { html, gen };
  });

  onMount(() => {
    setupMermaid(detectMermaidTheme());

    if (typeof MutationObserver === 'function') {
      themeObserver = new MutationObserver((records) => {
        const shouldRefreshCodeBlocks = records.some((record) => record.type === 'attributes');
        if (!shouldRefreshCodeBlocks || !containerRef) return;

        if (themeRefreshRaf !== undefined && typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(themeRefreshRaf);
        }

        const refresh = () => {
          themeRefreshRaf = undefined;
          postProcess(containerRef);
        };

        themeRefreshRaf = typeof window.requestAnimationFrame === 'function'
          ? window.requestAnimationFrame(refresh)
          : window.setTimeout(refresh, 16);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme', 'data-theme-switching'],
      });
    }
  });

  createEffect(() => {
    const { html, gen } = renderedHtml();
    if (!containerRef) return;

    containerRef.innerHTML = html;

    // Run mermaid after DOM update
    void runMermaid(containerRef).then(() => {
      if (gen !== renderGen) return; // Stale
      postProcess(containerRef);

      // Build TOC
      if (showToc()) {
        const nextTocItems = buildToc(containerRef);
        setTocItems(nextTocItems);
        updateActiveTocFromScrollNow();
      } else {
        setTocItems([]);
        setActiveTocId('');
      }
    });
  });

  function getTocHeadings(): HTMLElement[] {
    return Array.from(containerRef.querySelectorAll<HTMLElement>(TOC_HEADING_SELECTOR))
      .filter((heading) => heading.id !== '');
  }

  function isMarkdownBodyScrolledToBottom(): boolean {
    return containerRef.scrollTop + containerRef.clientHeight >= containerRef.scrollHeight - TOC_SCROLL_BOTTOM_EPSILON_PX;
  }

  function computeActiveTocIdFromScroll(): string {
    const headings = getTocHeadings();
    if (headings.length === 0) return '';

    const containerRect = containerRef.getBoundingClientRect();
    const anchorOffset = Math.min(
      TOC_ACTIVE_ANCHOR_OFFSET_PX,
      Math.max(TOC_SCROLL_TOP_OFFSET_PX, containerRect.height * 0.35),
    );
    const anchorY = containerRect.top + anchorOffset;

    let activeId = headings[0].id;

    if (isMarkdownBodyScrolledToBottom()) {
      const bottomY = containerRect.bottom - TOC_SCROLL_TOP_OFFSET_PX;
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top <= bottomY) {
          activeId = heading.id;
        }
      }
      return activeId;
    }

    for (const heading of headings) {
      if (heading.getBoundingClientRect().top <= anchorY) {
        activeId = heading.id;
      } else {
        break;
      }
    }

    return activeId;
  }

  function updateActiveTocFromScrollNow(): void {
    if (tocNavigationTargetId) return;

    const nextActiveId = computeActiveTocIdFromScroll();
    setActiveTocId(nextActiveId);
  }

  function scheduleActiveTocFromScroll(): void {
    if (tocNavigationTargetId) return;
    if (activeTocUpdateRaf !== undefined) return;

    if (typeof window.requestAnimationFrame !== 'function') {
      updateActiveTocFromScrollNow();
      return;
    }

    activeTocUpdateRaf = window.requestAnimationFrame(() => {
      activeTocUpdateRaf = undefined;
      updateActiveTocFromScrollNow();
    });
  }

  function clearTocNavigationReleaseTimer(): void {
    if (tocNavigationReleaseTimer === undefined) return;
    window.clearTimeout(tocNavigationReleaseTimer);
    tocNavigationReleaseTimer = undefined;
  }

  function finishTocNavigation(): void {
    tocNavigationTargetId = '';
    clearTocNavigationReleaseTimer();
  }

  function scheduleTocNavigationFinish(): void {
    clearTocNavigationReleaseTimer();
    tocNavigationReleaseTimer = window.setTimeout(finishTocNavigation, TOC_NAVIGATION_SETTLE_MS);
  }

  function startTocNavigation(targetId: string): void {
    tocNavigationTargetId = targetId;
    setActiveTocId(targetId);
    scheduleTocNavigationFinish();
  }

  function cancelTocNavigation(): void {
    tocNavigationTargetId = '';
    clearTocNavigationReleaseTimer();
  }

  function handleMarkdownScroll(): void {
    if (tocNavigationTargetId) {
      scheduleTocNavigationFinish();
      return;
    }

    scheduleActiveTocFromScroll();
  }

  function scrollMarkdownBodyToHeadingId(targetId: string): boolean {
    const id = String(targetId ?? '').trim();
    if (!id) return false;

    const target = containerRef.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!target) return false;

    startTocNavigation(id);
    scrollMarkdownBodyToHeading(target);
    return true;
  }

  function handleMarkdownClick(event: MouseEvent): void {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) return;

    const anchor = target.closest('a[href]');
    if (!(anchor instanceof HTMLAnchorElement) || !containerRef.contains(anchor)) return;

    const href = anchor.getAttribute('href') ?? '';
    const resolved = resolveFileMarkdownLink(href, props.filePath ?? '');

    if (resolved.kind === 'heading') {
      if (!scrollMarkdownBodyToHeadingId(resolved.targetId)) return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (resolved.kind === 'file') {
      event.preventDefault();
      event.stopPropagation();
      void props.onOpenFileLink?.({
        path: resolved.path,
        fragment: resolved.fragment,
        href: resolved.href,
      });
      return;
    }

    if (resolved.kind === 'unresolved-local') {
      event.preventDefault();
      event.stopPropagation();
      props.onUnresolvedLocalLink?.(resolved.href, resolved.reason);
    }
  }

  onCleanup(() => {
    themeObserver?.disconnect();
    if (themeRefreshRaf !== undefined) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(themeRefreshRaf);
      } else {
        window.clearTimeout(themeRefreshRaf);
      }
    }
    clearTocNavigationReleaseTimer();
    if (activeTocUpdateRaf !== undefined && typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(activeTocUpdateRaf);
    }
  });

  function scrollMarkdownBodyToHeading(target: HTMLElement): void {
    const containerRect = containerRef.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const top = containerRef.scrollTop + targetRect.top - containerRect.top - TOC_SCROLL_TOP_OFFSET_PX;

    if (typeof containerRef.scrollTo === 'function') {
      containerRef.scrollTo({
        top: Math.max(0, top),
        behavior: 'smooth',
      });
      return;
    }

    containerRef.scrollTop = Math.max(0, top);
  }

  const renderTocItem = (item: TocItem, depth: number): JSX.Element => (
    <li class="fm-toc-item" style={{ 'padding-left': `${(depth - 1) * 12}px` }}>
      <a
        href={`#${item.id}`}
        class={`fm-toc-link${activeTocId() === item.id ? ' fm-toc-active' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          scrollMarkdownBodyToHeadingId(item.id);
        }}
      >
        {item.text}
      </a>
      <Show when={item.children.length > 0}>
        <ul class="fm-toc-children">
          <For each={item.children}>
            {(child) => renderTocItem(child, depth + 1)}
          </For>
        </ul>
      </Show>
    </li>
  );

  const renderToolbar = (placement: 'toc' | 'floating'): JSX.Element => (
    <div
      class={`fm-toolbar${placement === 'toc' ? ' fm-toolbar-toc' : ' fm-toolbar-floating'}`}
      aria-label="Markdown preview controls"
    >
      <button
        type="button"
        class={`fm-toolbar-btn${readingMode() ? ' fm-toolbar-active' : ''}`}
        title="Reading mode"
        aria-pressed={readingMode()}
        onClick={() => setReadingMode(!readingMode())}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 2a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-1.5 0V2.75A.75.75 0 0 1 8 2Zm-5.25 2a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5A.75.75 0 0 1 2.75 4Zm10.5 0a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5a.75.75 0 0 1 .75-.75Z"/>
        </svg>
      </button>
      <Show when={showToc()}>
        <button
          type="button"
          class={`fm-toolbar-btn${tocVisible() ? ' fm-toolbar-active' : ''}`}
          title="Toggle table of contents"
          aria-pressed={tocVisible()}
          onClick={() => setTocVisible(!tocVisible())}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75ZM2.75 7.5h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5Zm0 3.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z"/>
          </svg>
        </button>
      </Show>
    </div>
  );

  return (
    <div class={`file-markdown-wrapper${props.class ? ` ${props.class}` : ''}`} style="display: flex; height: 100%; min-height: 0;">
      <div style="position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden;">
        <Show when={!(tocVisible() && tocItems().length > 0)}>
          {renderToolbar('floating')}
        </Show>

        <div
          ref={containerRef!}
          class={`file-markdown-body${readingMode() ? ' file-markdown-reading' : ''}`}
          style="flex: 1; min-width: 0; overflow-y: auto;"
          onClick={handleMarkdownClick}
          onScroll={handleMarkdownScroll}
          onPointerDown={cancelTocNavigation}
          onWheel={cancelTocNavigation}
          onTouchStart={cancelTocNavigation}
        />

        <Show when={tocVisible() && tocItems().length > 0}>
          <div
            class="fm-toc-panel"
            style={{ width: '280px', 'flex-shrink': 0 }}
          >
            {renderToolbar('toc')}
            <div class="fm-toc-title">Contents</div>
            <ul class="fm-toc-list">
              <For each={tocItems()}>
                {(item) => renderTocItem(item, 1)}
              </For>
            </ul>
          </div>
        </Show>
      </div>
    </div>
  );
}
