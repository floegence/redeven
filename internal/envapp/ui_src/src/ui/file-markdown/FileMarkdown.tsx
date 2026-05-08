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
import type { JSX } from 'solid-js';

export interface FileMarkdownProps {
  content: string;
  filePath?: string;
  showToc?: boolean;
  class?: string;
}

const FS_FILE_ENDPOINT = '/_redeven_proxy/api/fs/file';

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
  let tocObserver: IntersectionObserver | undefined;
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
        setTocItems(buildToc(containerRef));
      }

      // Set up TOC heading observer
      setupTocObserver();
    });
  });

  function setupTocObserver(): void {
    if (tocObserver) tocObserver.disconnect();

    const headings = containerRef.querySelectorAll<HTMLElement>('h1.fm-heading, h2.fm-heading, h3.fm-heading, h4.fm-heading');
    if (headings.length === 0) return;

    tocObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveTocId(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );

    for (const heading of headings) {
      tocObserver.observe(heading);
    }
  }

  onCleanup(() => {
    if (tocObserver) tocObserver.disconnect();
  });

  const renderTocItem = (item: TocItem, depth: number): JSX.Element => (
    <li class="fm-toc-item" style={{ 'padding-left': `${(depth - 1) * 12}px` }}>
      <a
        href={`#${item.id}`}
        class={`fm-toc-link${activeTocId() === item.id ? ' fm-toc-active' : ''}`}
        onClick={(e) => {
          e.preventDefault();
          const target = containerRef.querySelector(`#${CSS.escape(item.id)}`);
          if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
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

  return (
    <div class={`file-markdown-wrapper${props.class ? ` ${props.class}` : ''}`} style="display: flex; height: 100%; min-height: 0;">
      {/* Toolbar */}
      <div style="display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0;">
        <div class="fm-toolbar">
          <button
            type="button"
            class={`fm-toolbar-btn${readingMode() ? ' fm-toolbar-active' : ''}`}
            title="Reading mode"
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
              onClick={() => setTocVisible(!tocVisible())}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 3.75A.75.75 0 0 1 2.75 3h10.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 3.75ZM2.75 7.5h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1 0-1.5Zm0 3.75h4.5a.75.75 0 0 1 0 1.5h-4.5a.75.75 0 0 1 0-1.5Z"/>
              </svg>
            </button>
          </Show>
        </div>

        {/* Main content area */}
        <div style="display: flex; flex: 1; min-height: 0; overflow: hidden;">
          <div
            ref={containerRef!}
            class={`file-markdown-body${readingMode() ? ' file-markdown-reading' : ''}`}
            style="flex: 1; min-width: 0; overflow-y: auto;"
          />

          {/* TOC sidebar */}
          <Show when={tocVisible() && tocItems().length > 0}>
            <div
              class="fm-toc-panel"
              style={{ width: '280px', 'flex-shrink': 0 }}
            >
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
