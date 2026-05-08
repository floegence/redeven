import { marked } from 'marked';
import type { TokenizerAndRendererExtension } from 'marked';
import { gfmHeadingId } from 'marked-gfm-heading-id';
import markedFootnote from 'marked-footnote';
import { highlightCached } from './highlightCache';

marked.setOptions({
  gfm: true,
  breaks: true,
  pedantic: false,
});

marked.use(gfmHeadingId());
marked.use(markedFootnote());

const GFM_ALERT_TYPES = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;
type GfmAlertType = (typeof GFM_ALERT_TYPES)[number];

const ALERT_ICONS: Record<string, string> = {
  NOTE: '<svg class="fm-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  TIP: '<svg class="fm-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1.5c-2.363 0-4.278 1.47-5.09 3.5h10.18c-.812-2.03-2.727-3.5-5.09-3.5ZM13.965 6.5H2.035c-.03.163-.035.33-.035.5 0 3.314 2.686 6 6 6s6-2.686 6-6c0-.17-.005-.337-.035-.5ZM2.342 5h11.316c.226-.309.42-.643.58-1H1.762c.16.357.354.691.58 1Z"/></svg>',
  IMPORTANT: '<svg class="fm-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25v-9.5ZM1.75 1.5a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25H1.75ZM7 4.25a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5ZM8 10a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  WARNING: '<svg class="fm-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 2.75a.25.25 0 0 0-.22.125L1.698 14.253a.25.25 0 0 0 .22.372h12.164a.25.25 0 0 0 .22-.372L8.22 2.875A.25.25 0 0 0 8 2.75ZM7.25 6a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0V6ZM8 11.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  CAUTION: '<svg class="fm-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function detectGfmAlertType(text: string): GfmAlertType | null {
  const m = text.match(/^\[!([A-Z]+)\]\s*/);
  if (!m) return null;
  const label = m[1].toUpperCase();
  return GFM_ALERT_TYPES.includes(label as GfmAlertType) ? (label as GfmAlertType) : null;
}

const codeExtension: TokenizerAndRendererExtension = {
  name: 'fileMarkdownCode',
  level: 'block',
  renderer(token) {
    const t = token as unknown as { text: string; lang?: string };
    if (t.lang === 'mermaid') {
      const encoded = encodeURIComponent(t.text);
      return `<div class="mermaid" data-mermaid-src="${encoded}">${escapeHtml(t.text)}</div>`;
    }

    const lang = (typeof t.lang === 'string' && t.lang.length > 0) ? t.lang : undefined;
    const highlighted = highlightCached(t.text, lang);
    const langLabel = lang ? `<span class="fm-code-lang">${escapeHtml(lang)}</span>` : '';
    const copyBtn = `<button class="fm-code-copy" data-code="${encodeURIComponent(t.text)}" title="Copy code"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25v-7.5Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg></button>`;
    return `<div class="fm-code-block-wrapper">${langLabel}${copyBtn}<pre><code class="hljs${lang ? ` language-${escapeHtml(lang)}` : ''}">${highlighted}</code></pre></div>`;
  },
};

const blockquoteExtension: TokenizerAndRendererExtension = {
  name: 'fileMarkdownBlockquote',
  level: 'block',
  renderer(token) {
    const t = token as unknown as { text: string };
    const alertType = detectGfmAlertType(t.text);
    if (alertType) {
      const cleanedText = t.text.replace(/^\[![A-Z]+\]\s*/i, '');
      const icon = ALERT_ICONS[alertType] ?? '';
      const typeClass = alertType.toLowerCase();
      return `<blockquote class="fm-alert fm-alert-${typeClass}"><div class="fm-alert-heading">${icon}<span>${alertType}</span></div>${cleanedText}</blockquote>`;
    }
    return `<blockquote class="fm-blockquote">${t.text}</blockquote>`;
  },
};

marked.use({
  extensions: [codeExtension, blockquoteExtension],
});

export function parseMarkdown(markdown: string): string {
  let html = marked.parse(markdown) as string;

  // Post-process HTML to add file-markdown CSS classes
  html = html.replace(/<table>/g, '<div class="fm-table-wrap"><table class="fm-table">');
  html = html.replace(/<\/table>/g, '</table></div>');
  html = html.replace(/<a\b/g, '<a class="fm-link"');
  html = html.replace(/<a class="fm-link" href="(https?:\/\/[^"]*)"/g,
    '<a class="fm-link" href="$1" target="_blank" rel="noopener noreferrer"');
  html = html.replace(/<img\b/g, '<img class="fm-image" loading="lazy"');
  html = html.replace(/<code>(?!<\/pre>)/g, '<code class="fm-inline-code">');

  // Add heading IDs and class
  html = html.replace(/<h([1-6])\b/g, '<h$1 class="fm-heading"');
  html = html.replace(/<h([1-6]) class="fm-heading">([^<]*)<\/h\1>/g, (_match, depth, text) => {
    const id = text
      .toLowerCase()
      .replace(/<[^>]*>/g, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
    return `<h${depth} id="${id}" class="fm-heading">${text}</h${depth}>`;
  });

  return html;
}
