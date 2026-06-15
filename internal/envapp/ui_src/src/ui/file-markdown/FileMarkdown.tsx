import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import DOMPurify from 'dompurify';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
} from '@floegence/floe-webapp-core/icons';
import './FileMarkdown.css';
import { extractMath, reinjectMath } from './mathPlugin';
import { setupMermaid, runMermaid } from './mermaidPlugin';
import { extractFrontmatter } from './frontmatterParser';
import { buildToc, type TocItem } from './tocBuilder';
import { postProcess } from './postProcess';
import { parseMarkdown } from './markedConfig';
import { resolveFileMarkdownLink } from './linkResolver';
import { buildRedevenFileResourceUrl } from '../utils/filePreviewResource';
import { useI18n } from '../i18n';
import { FilePreviewErrorState } from '../widgets/FilePreviewErrorState';
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

const TOC_HEADING_SELECTOR = 'h1.fm-heading, h2.fm-heading, h3.fm-heading, h4.fm-heading';
const TOC_ACTIVE_ANCHOR_OFFSET_PX = 88;
const TOC_SCROLL_BOTTOM_EPSILON_PX = 2;
const TOC_NAVIGATION_SETTLE_MS = 520;
const TOC_SCROLL_TOP_OFFSET_PX = 8;

interface MarkdownRenderResult {
  html: string;
  fatalIssue: MarkdownPreviewIssue | null;
}

type MarkdownPreviewIssuePhase = 'parse' | 'mermaid' | 'postprocess' | 'toc';

interface MarkdownPreviewIssue {
  severity: 'fatal' | 'warning';
  phase: MarkdownPreviewIssuePhase;
  message: string;
}

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
    return buildRedevenFileResourceUrl(normalized);
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

function formatMarkdownPreviewError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  const message = String(error ?? '').trim();
  return message || 'Unknown markdown render error';
}

function markdownPreviewIssuesEqual(
  left: MarkdownPreviewIssue | null,
  right: MarkdownPreviewIssue | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.severity === right.severity
    && left.phase === right.phase
    && left.message === right.message;
}

function formatMarkdownPreviewIssueDetails(issue: MarkdownPreviewIssue): string {
  return `${issue.phase}: ${issue.message}`;
}

function tocItemsEqual(left: readonly TocItem[], right: readonly TocItem[]): boolean {
  const pending: Array<readonly [readonly TocItem[], readonly TocItem[]]> = [[left, right]];

  while (pending.length > 0) {
    const [currentLeft, currentRight] = pending.pop()!;
    if (currentLeft === currentRight) continue;
    if (currentLeft.length !== currentRight.length) return false;

    for (let index = 0; index < currentLeft.length; index += 1) {
      const leftItem = currentLeft[index];
      const rightItem = currentRight[index];
      if (
        leftItem.id !== rightItem.id
        || leftItem.text !== rightItem.text
        || leftItem.level !== rightItem.level
        || leftItem.children.length !== rightItem.children.length
      ) {
        return false;
      }
      pending.push([leftItem.children, rightItem.children]);
    }
  }

  return true;
}

export function FileMarkdown(props: FileMarkdownProps): JSX.Element {
  const i18n = useI18n();
  const [readingMode, setReadingMode] = createSignal(true);
  const [tocVisible, setTocVisible] = createSignal(props.showToc !== false);
  const [tocItems, setTocItems] = createSignal<TocItem[]>([]);
  const [activeTocId, setActiveTocId] = createSignal('');
  const [fatalIssue, setFatalIssue] = createSignal<MarkdownPreviewIssue | null>(null);
  const [warningIssue, setWarningIssue] = createSignal<MarkdownPreviewIssue | null>(null);
  const [warningDetailsOpen, setWarningDetailsOpen] = createSignal(false);
  const [warningDetailsCopied, setWarningDetailsCopied] = createSignal(false);
  let containerRef!: HTMLDivElement;
  let activeTocUpdateRaf: number | undefined;
  let tocNavigationTargetId = '';
  let tocNavigationReleaseTimer: number | undefined;
  let warningCopyResetTimer: number | undefined;
  let themeRefreshRaf: number | undefined;
  let themeObserver: MutationObserver | undefined;
  let renderTaskSeq = 0;
  let disposed = false;

  const showToc = () => props.showToc !== false;

  function detectMermaidTheme(): 'dark' | 'light' {
    const html = document.documentElement;
    if (html.classList.contains('dark')) return 'dark';
    if (html.classList.contains('light')) return 'light';
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
    return 'light';
  }

  const renderedHtml = createMemo<MarkdownRenderResult>(() => {
    try {
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

      return { html, fatalIssue: null };
    } catch (error) {
      return {
        html: '',
        fatalIssue: {
          severity: 'fatal',
          phase: 'parse',
          message: formatMarkdownPreviewError(error),
        },
      };
    }
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
          runPostProcessForVisibleDocument();
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
    const { html, fatalIssue: nextFatalIssue } = renderedHtml();
    const shouldShowToc = showToc();
    const target = containerRef;
    const taskSeq = (renderTaskSeq += 1);
    let canceled = false;

    onCleanup(() => {
      canceled = true;
    });

    if (!target) return;

    const isCurrentTask = () => (
      !disposed
      && !canceled
      && taskSeq === renderTaskSeq
      && target === containerRef
      && target.isConnected
    );

    if (nextFatalIssue) {
      target.innerHTML = '';
      batch(() => {
        setFatalIssueIfChanged(nextFatalIssue);
        clearWarningIssue();
        setTocItemsIfChanged([]);
        setActiveTocIdIfChanged('');
      });
      return;
    }

    batch(() => {
      setFatalIssueIfChanged(null);
      clearWarningIssue();
    });
    target.innerHTML = html;

    void (async () => {
      try {
        await runMermaid(target, { shouldContinue: isCurrentTask });
      } catch (error) {
        if (!isCurrentTask()) return;
        console.error('Markdown preview Mermaid enhancement failed:', error);
        commitWarningIssue({
          severity: 'warning',
          phase: 'mermaid',
          message: formatMarkdownPreviewError(error),
        });
      }
      if (!isCurrentTask()) return;

      try {
        postProcess(target);
      } catch (error) {
        if (!isCurrentTask()) return;
        console.error('Markdown preview post-process failed:', error);
        batch(() => {
          commitWarningIssue({
            severity: 'warning',
            phase: 'postprocess',
            message: formatMarkdownPreviewError(error),
          });
          setTocItemsIfChanged([]);
          setActiveTocIdIfChanged('');
        });
        return;
      }
      if (!isCurrentTask()) return;

      try {
        commitTocState(target, shouldShowToc);
      } catch (error) {
        if (!isCurrentTask()) return;
        console.error('Markdown preview table of contents failed:', error);
        batch(() => {
          commitWarningIssue({
            severity: 'warning',
            phase: 'toc',
            message: formatMarkdownPreviewError(error),
          });
          setTocItemsIfChanged([]);
          setActiveTocIdIfChanged('');
        });
      }
    })();
  });

  function setFatalIssueIfChanged(nextIssue: MarkdownPreviewIssue | null): void {
    setFatalIssue((current) => (
      markdownPreviewIssuesEqual(current, nextIssue) ? current : nextIssue
    ));
  }

  function resetWarningDetailsState(): void {
    setWarningDetailsOpen(false);
    setWarningDetailsCopied(false);
    if (warningCopyResetTimer !== undefined) {
      window.clearTimeout(warningCopyResetTimer);
      warningCopyResetTimer = undefined;
    }
  }

  function commitWarningIssue(nextIssue: MarkdownPreviewIssue): void {
    let changed = false;
    setWarningIssue((current) => {
      if (markdownPreviewIssuesEqual(current, nextIssue)) return current;
      changed = true;
      return nextIssue;
    });
    if (changed) {
      resetWarningDetailsState();
    }
  }

  function clearWarningIssue(phase?: MarkdownPreviewIssuePhase): void {
    let changed = false;
    setWarningIssue((current) => {
      if (!current || (phase && current.phase !== phase)) return current;
      changed = true;
      return null;
    });
    if (changed) {
      resetWarningDetailsState();
    }
  }

  function setTocItemsIfChanged(nextTocItems: TocItem[]): void {
    setTocItems((current) => (
      tocItemsEqual(current, nextTocItems) ? current : nextTocItems
    ));
  }

  function setActiveTocIdIfChanged(nextActiveId: string): void {
    setActiveTocId((current) => (
      current === nextActiveId ? current : nextActiveId
    ));
  }

  function commitTocState(target: HTMLElement, shouldShowToc: boolean): void {
    if (!shouldShowToc) {
      batch(() => {
        setTocItemsIfChanged([]);
        setActiveTocIdIfChanged('');
      });
      return;
    }

    const nextTocItems = buildToc(target);
    batch(() => {
      setTocItemsIfChanged(nextTocItems);
      updateActiveTocFromScrollNow();
    });
  }

  function runPostProcessForVisibleDocument(): void {
    if (disposed || fatalIssue() || !containerRef?.isConnected) return;

    try {
      postProcess(containerRef);
      clearWarningIssue('postprocess');
    } catch (error) {
      console.error('Markdown preview post-process failed:', error);
      commitWarningIssue({
        severity: 'warning',
        phase: 'postprocess',
        message: formatMarkdownPreviewError(error),
      });
    }
  }

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
    setActiveTocIdIfChanged(nextActiveId);
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
    setActiveTocIdIfChanged(targetId);
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
    disposed = true;
    renderTaskSeq += 1;
    themeObserver?.disconnect();
    if (warningCopyResetTimer !== undefined) {
      window.clearTimeout(warningCopyResetTimer);
    }
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

  const renderToolbar = (placement: 'toc' | 'floating', inline = false): JSX.Element => (
    <div
      class={`fm-toolbar${placement === 'toc' ? ' fm-toolbar-toc' : ' fm-toolbar-floating'}${inline ? ' fm-toolbar-floating-inline' : ''}`}
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

  function warningTitle(issue: MarkdownPreviewIssue): string {
    switch (issue.phase) {
      case 'mermaid':
        return i18n.t('filePreview.markdownWarningMermaidTitle');
      case 'toc':
        return i18n.t('filePreview.markdownWarningTocTitle');
      case 'postprocess':
      case 'parse':
        return i18n.t('filePreview.markdownWarningPostprocessTitle');
    }
  }

  function warningDescription(issue: MarkdownPreviewIssue): string {
    switch (issue.phase) {
      case 'mermaid':
        return i18n.t('filePreview.markdownWarningMermaidDescription');
      case 'toc':
        return i18n.t('filePreview.markdownWarningTocDescription');
      case 'postprocess':
      case 'parse':
        return i18n.t('filePreview.markdownWarningPostprocessDescription');
    }
  }

  async function copyWarningDetails(issue: MarkdownPreviewIssue): Promise<void> {
    try {
      await navigator.clipboard.writeText(formatMarkdownPreviewIssueDetails(issue));
    } catch {
      return;
    }

    setWarningDetailsCopied(true);
    if (warningCopyResetTimer !== undefined) {
      window.clearTimeout(warningCopyResetTimer);
    }
    warningCopyResetTimer = window.setTimeout(() => {
      setWarningDetailsCopied(false);
      warningCopyResetTimer = undefined;
    }, 1600);
  }

  const renderWarningIssue = (issue: MarkdownPreviewIssue): JSX.Element => (
    <section class="fm-preview-warning" role="status" aria-live="polite">
      <AlertTriangle class="fm-preview-warning-icon" />
      <div class="fm-preview-warning-copy">
        <div class="fm-preview-warning-title">{warningTitle(issue)}</div>
        <div class="fm-preview-warning-description">{warningDescription(issue)}</div>
        <div class="fm-preview-warning-actions">
          <button
            type="button"
            class="fm-preview-warning-action"
            aria-expanded={warningDetailsOpen()}
            onClick={() => setWarningDetailsOpen((open) => !open)}
        >
          <Show when={warningDetailsOpen()} fallback={<ChevronRight class="fm-preview-warning-action-icon" />}>
            <ChevronDown class="fm-preview-warning-action-icon" />
            </Show>
            {i18n.t('filePreview.technicalDetails')}
          </button>
          <button
            type="button"
            class="fm-preview-warning-action"
            onClick={() => void copyWarningDetails(issue)}
          >
            <Show when={warningDetailsCopied()} fallback={<Copy class="fm-preview-warning-action-icon" />}>
              <span class="fm-preview-warning-copied">{i18n.t('chatChrome.copied')}</span>
            </Show>
            {i18n.t('filePreview.copyErrorDetails')}
          </button>
        </div>
        <Show when={warningDetailsOpen()}>
          <code class="fm-preview-warning-details">{formatMarkdownPreviewIssueDetails(issue)}</code>
        </Show>
      </div>
    </section>
  );

  return (
    <div class={`file-markdown-wrapper${props.class ? ` ${props.class}` : ''}`} style="display: flex; height: 100%; min-height: 0;">
      <div style="position: relative; display: flex; flex: 1; min-width: 0; min-height: 0; overflow: hidden;">
        <Show when={fatalIssue()}>
          {(issue) => (
            <div class="fm-preview-fatal">
              <FilePreviewErrorState
                errorType="render_error"
                message={formatMarkdownPreviewIssueDetails(issue())}
              />
            </div>
          )}
        </Show>

        <div
          class="fm-markdown-layout"
          hidden={fatalIssue() !== null}
          aria-hidden={fatalIssue() !== null ? 'true' : undefined}
        >
          <div class="fm-floating-toolbar-slot" classList={{ 'fm-floating-toolbar-slot-warning': warningIssue() !== null }}>
            {renderToolbar('floating', warningIssue() !== null)}
          </div>

          <div class="fm-markdown-column">
            <Show when={warningIssue()}>
              {(issue) => renderWarningIssue(issue())}
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
          </div>

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
    </div>
  );
}
