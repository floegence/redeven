import type { RendererObject, Token } from 'marked';

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

function escapeHtml(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeLanguageClass(lang?: string): string {
  const value = String(lang ?? '').trim();
  if (!value) return '';
  const safe = value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe ? ` language-${safe}` : '';
}

function renderInlineTokens(tokens: readonly Token[] | undefined, fallbackText: string): string {
  if (!tokens?.length) return escapeHtml(fallbackText);

  return tokens.map((entry) => {
    const token = entry as MarkdownInlineToken;
    const text = String(token.text ?? '');
    switch (token.type) {
      case 'codespan':
        return `<code class="chat-md-inline-code">${escapeHtml(text)}</code>`;
      case 'strong':
        return `<strong>${renderInlineTokens(token.tokens, text)}</strong>`;
      case 'em':
        return `<em>${renderInlineTokens(token.tokens, text)}</em>`;
      case 'del':
        return `<del>${renderInlineTokens(token.tokens, text)}</del>`;
      case 'br':
        return '<br>';
      case 'link':
        return renderInlineTokens(token.tokens, text);
      case 'escape':
      case 'text':
        return escapeHtml(text);
      default:
        return escapeHtml(text || String(token.raw ?? ''));
    }
  }).join('');
}

function renderDefaultLink(token: MarkdownLinkToken): string {
  const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
  return `<a href="${escapeHtml(token.href)}" class="chat-md-link" target="_blank" rel="noopener noreferrer"${titleAttr}>${renderInlineTokens(token.tokens, token.text)}</a>`;
}

export function createMarkdownRenderer(): RendererObject<string, string> {
  return {
    link(token: MarkdownLinkToken) {
      return renderDefaultLink(token);
    },
    codespan(token: { text: string }) {
      return `<code class="chat-md-inline-code">${escapeHtml(token.text)}</code>`;
    },
    code(token: { text: string; lang?: string }) {
      const langClass = normalizeLanguageClass(token.lang).trim() || 'language-text';
      return `<pre class="chat-md-code-block"><code class="${langClass}">${escapeHtml(token.text)}</code></pre>`;
    },
    blockquote(token: { text: string }) {
      return `<blockquote class="chat-md-blockquote">${token.text}</blockquote>`;
    },
    image(token: { href: string; title?: string | null; text: string }) {
      const titleAttr = token.title ? ` title="${token.title}"` : '';
      return `<img src="${token.href}" alt="${token.text}" class="chat-md-image"${titleAttr} />`;
    },
  };
}
