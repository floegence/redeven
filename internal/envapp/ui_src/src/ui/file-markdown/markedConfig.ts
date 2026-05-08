import { Marked } from 'marked';
import type { Token, Tokens } from 'marked';
import markedFootnote from 'marked-footnote';
import { highlightCached } from './highlightCache';

const fileMarkdown = new Marked({
  gfm: true,
  breaks: true,
  pedantic: false,
});
let headingIdCounts = new Map<string, number>();

const GFM_ALERT_TYPES = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] as const;
type GfmAlertType = (typeof GFM_ALERT_TYPES)[number];

const ALERT_ICONS: Record<GfmAlertType, string> = {
  NOTE: '<svg class="fm-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  TIP: '<svg class="fm-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M8 1.5c-2.363 0-4.278 1.47-5.09 3.5h10.18c-.812-2.03-2.727-3.5-5.09-3.5ZM13.965 6.5H2.035c-.03.163-.035.33-.035.5 0 3.314 2.686 6 6 6s6-2.686 6-6c0-.17-.005-.337-.035-.5ZM2.342 5h11.316c.226-.309.42-.643.58-1H1.762c.16.357.354.691.58 1Z"/></svg>',
  IMPORTANT: '<svg class="fm-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M0 1.75C0 .784.784 0 1.75 0h12.5C15.216 0 16 .784 16 1.75v9.5A1.75 1.75 0 0 1 14.25 13H8.06l-2.573 2.573A1.458 1.458 0 0 1 3 14.543V13H1.75A1.75 1.75 0 0 1 0 11.25v-9.5ZM1.75 1.5a.25.25 0 0 0-.25.25v9.5c0 .138.112.25.25.25h2a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h6.5a.25.25 0 0 0 .25-.25v-9.5a.25.25 0 0 0-.25-.25H1.75ZM7 4.25a.75.75 0 0 1 .75-.75h.5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5ZM8 10a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  WARNING: '<svg class="fm-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 2.75a.25.25 0 0 0-.22.125L1.698 14.253a.25.25 0 0 0 .22.372h12.164a.25.25 0 0 0 .22-.372L8.22 2.875A.25.25 0 0 0 8 2.75ZM7.25 6a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0V6ZM8 11.5a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
  CAUTION: '<svg class="fm-alert-icon" viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg>',
};

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeLanguage(value: unknown): string {
  const raw = String(value ?? '').trim().split(/\s+/)[0] ?? '';
  return raw.toLowerCase().replace(/[^a-z0-9_+#.-]+/g, '-').replace(/^-+|-+$/g, '');
}

function slugHeadingText(text: string): string {
  const slug = String(text ?? '')
    .trim()
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

function nextHeadingId(text: string): string {
  const base = slugHeadingText(text);
  const count = headingIdCounts.get(base) ?? 0;
  headingIdCounts.set(base, count + 1);
  return count === 0 ? base : `${base}-${count}`;
}

function detectGfmAlertType(text: string): GfmAlertType | null {
  const match = String(text ?? '').match(/^\s*\[!([A-Z]+)\]\s*/i);
  if (!match) return null;
  const label = match[1].toUpperCase();
  return GFM_ALERT_TYPES.includes(label as GfmAlertType) ? (label as GfmAlertType) : null;
}

function stripGfmAlertMarkerFromParagraph(token: Tokens.Paragraph): Tokens.Paragraph | null {
  const next = { ...token, tokens: [...(token.tokens ?? [])] };
  next.raw = String(next.raw ?? '').replace(/^\s*\[![A-Z]+\]\s*/i, '');
  next.text = String(next.text ?? '').replace(/^\s*\[![A-Z]+\]\s*/i, '');
  const [firstInline, ...restInline] = next.tokens ?? [];
  if (firstInline?.type === 'text') {
    next.tokens = [
      {
        ...firstInline,
        raw: String((firstInline as Tokens.Text).raw ?? '').replace(/^\s*\[![A-Z]+\]\s*/i, ''),
        text: String((firstInline as Tokens.Text).text ?? '').replace(/^\s*\[![A-Z]+\]\s*/i, ''),
      },
      ...restInline,
    ];
  }

  while (next.tokens?.[0]?.type === 'text' && !String((next.tokens[0] as Tokens.Text).text ?? '').trim()) {
    next.tokens.shift();
  }
  while (next.tokens?.[0]?.type === 'br') {
    next.tokens.shift();
  }
  while (next.tokens?.[0]?.type === 'text' && !String((next.tokens[0] as Tokens.Text).text ?? '').trim()) {
    next.tokens.shift();
  }

  next.text = String(next.text ?? '').replace(/^\s+/, '');
  if (next.tokens?.length && next.tokens.every((entry) => entry.type === 'text' && !String((entry as Tokens.Text).text ?? '').trim())) {
    next.tokens = [];
  }

  return String(next.text ?? '').trim() || (next.tokens?.length ?? 0) > 0 ? next : null;
}

function renderAlertHeading(alertType: GfmAlertType): string {
  const title = alertType.charAt(0) + alertType.slice(1).toLowerCase();
  return `<div class="fm-alert-heading">${ALERT_ICONS[alertType]}<span>${title}</span></div>`;
}

function renderBlockTokens(tokens: Token[] | undefined): string {
  return fileMarkdown.parser(tokens ?? []);
}

function renderInlineTokens(tokens: Token[] | undefined): string {
  return fileMarkdown.Parser.parseInline(tokens ?? [], fileMarkdown.defaults);
}

fileMarkdown.use(markedFootnote());
fileMarkdown.use({
  renderer: {
    code(token: Tokens.Code): string {
      const lang = sanitizeLanguage(token.lang);
      const text = String(token.text ?? '');
      if (lang === 'mermaid') {
        return `<div class="mermaid" data-mermaid-src="${encodeURIComponent(text)}">${escapeHtml(text)}</div>`;
      }
      const highlighted = highlightCached(text, lang || undefined);
      const langClass = lang ? ` language-${escapeHtml(lang)}` : ' language-text';
      return `<pre class="fm-code-block"><code class="hljs${langClass}">${highlighted}</code></pre>`;
    },
    codespan(token: Tokens.Codespan): string {
      return `<code class="fm-inline-code">${escapeHtml(token.text)}</code>`;
    },
    blockquote(token: Tokens.Blockquote): string {
      const alertType = detectGfmAlertType(token.text);
      if (!alertType) {
        return `<blockquote class="fm-blockquote">${renderBlockTokens(token.tokens)}</blockquote>`;
      }

      const [firstToken, ...restTokens] = token.tokens ?? [];
      const strippedFirstToken = firstToken?.type === 'paragraph'
        ? stripGfmAlertMarkerFromParagraph(firstToken as Tokens.Paragraph)
        : firstToken;
      const bodyTokens = [
        ...(strippedFirstToken ? [strippedFirstToken] : []),
        ...restTokens,
      ];
      const typeClass = alertType.toLowerCase();
      return `<blockquote class="fm-alert fm-alert-${typeClass}">${renderAlertHeading(alertType)}${renderBlockTokens(bodyTokens)}</blockquote>`;
    },
    link(token: Tokens.Link): string {
      const href = escapeHtml(token.href);
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      const externalAttrs = /^https?:\/\//i.test(token.href) ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a class="fm-link" href="${href}"${externalAttrs}${title}>${renderInlineTokens(token.tokens)}</a>`;
    },
    image(token: Tokens.Image): string {
      const href = escapeHtml(token.href);
      const title = token.title ? ` title="${escapeHtml(token.title)}"` : '';
      return `<img class="fm-image" src="${href}" alt="${escapeHtml(token.text)}" loading="lazy"${title}>`;
    },
    heading(token: Tokens.Heading): string {
      const id = nextHeadingId(token.text);
      return `<h${token.depth} id="${escapeHtml(id)}" class="fm-heading">${renderInlineTokens(token.tokens)}</h${token.depth}>`;
    },
  },
});

export function parseMarkdown(markdown: string): string {
  headingIdCounts = new Map<string, number>();
  let html = fileMarkdown.parse(markdown) as string;

  html = html.replace(/<table>/g, '<div class="fm-table-wrap"><table class="fm-table">');
  html = html.replace(/<\/table>/g, '</table></div>');

  return html;
}
