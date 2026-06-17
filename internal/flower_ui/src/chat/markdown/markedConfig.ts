import type { RendererObject, Token, Tokens } from 'marked';

type MarkdownInlineToken = Token & {
  href?: string;
  raw?: string;
  text?: string;
  title?: string | null;
  tokens?: Token[];
};

type MarkdownLinkToken = {
  href: string;
  title?: string | null;
  text: string;
  tokens?: Token[];
};

export function escapeFlowerMarkdownHtml(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLanguageClass(lang?: string): string {
  const value = String(lang ?? '').trim();
  if (!value) return 'language-text';
  const safe = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe ? `language-${safe}` : 'language-text';
}

export function safeFlowerMarkdownHref(rawHref: string): string | null {
  const href = String(rawHref ?? '').trim();
  if (!href) return null;
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (href.startsWith('#') || href.startsWith('/')) return href;
  return null;
}

function renderInlineTokens(tokens: readonly Token[] | undefined, fallbackText: string): string {
  if (!tokens?.length) return escapeFlowerMarkdownHtml(fallbackText);

  return tokens.map((entry) => {
    const token = entry as MarkdownInlineToken;
    const text = String(token.text ?? '');
    switch (token.type) {
      case 'codespan':
        return `<code class="flower-chat-md-inline-code">${escapeFlowerMarkdownHtml(text)}</code>`;
      case 'strong':
        return `<strong>${renderInlineTokens(token.tokens, text)}</strong>`;
      case 'em':
        return `<em>${renderInlineTokens(token.tokens, text)}</em>`;
      case 'del':
        return `<del>${renderInlineTokens(token.tokens, text)}</del>`;
      case 'br':
        return '<br>';
      case 'link':
        return renderLink({
          href: String(token.href ?? ''),
          title: token.title,
          text,
          tokens: token.tokens,
        });
      case 'escape':
      case 'text':
        return escapeFlowerMarkdownHtml(text);
      case 'html':
        return escapeFlowerMarkdownHtml(text || String(token.raw ?? ''));
      default:
        return escapeFlowerMarkdownHtml(text || String(token.raw ?? ''));
    }
  }).join('');
}

function renderLink(token: MarkdownLinkToken): string {
  const safeHref = safeFlowerMarkdownHref(token.href);
  const label = renderInlineTokens(token.tokens, token.text);
  if (!safeHref) return label;
  const titleAttr = token.title ? ` title="${escapeFlowerMarkdownHtml(token.title)}"` : '';
  const externalAttrs = /^(https?:|mailto:)/i.test(safeHref) ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a href="${escapeFlowerMarkdownHtml(safeHref)}" class="flower-chat-md-link"${externalAttrs}${titleAttr}>${label}</a>`;
}

export function createFlowerMarkdownRenderer(): RendererObject<string, string> {
  return {
    html(token: { text?: string; raw?: string }) {
      return escapeFlowerMarkdownHtml(String(token.text ?? token.raw ?? ''));
    },
    link(token: MarkdownLinkToken) {
      return renderLink(token);
    },
    codespan(token: { text: string }) {
      return `<code class="flower-chat-md-inline-code">${escapeFlowerMarkdownHtml(token.text)}</code>`;
    },
    code(token: { text: string; lang?: string }) {
      const langClass = normalizeLanguageClass(token.lang);
      return `<pre class="flower-chat-md-code-block"><code class="${langClass}">${escapeFlowerMarkdownHtml(token.text)}</code></pre>`;
    },
    blockquote(token: Tokens.Blockquote) {
      return `<blockquote class="flower-chat-md-blockquote">${this.parser.parse(token.tokens)}</blockquote>`;
    },
    image(token: { href: string; title?: string | null; text: string }) {
      const safeHref = safeFlowerMarkdownHref(token.href);
      if (!safeHref) return escapeFlowerMarkdownHtml(token.text);
      const titleAttr = token.title ? ` title="${escapeFlowerMarkdownHtml(token.title)}"` : '';
      return `<img src="${escapeFlowerMarkdownHtml(safeHref)}" alt="${escapeFlowerMarkdownHtml(token.text)}" class="flower-chat-md-image"${titleAttr} />`;
    },
  };
}
