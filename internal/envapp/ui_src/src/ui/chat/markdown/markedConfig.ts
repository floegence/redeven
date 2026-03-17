import type { RendererObject } from 'marked';

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

export function createMarkdownRenderer(): RendererObject<string, string> {
  return {
    link(token: { href: string; title?: string | null; text: string }) {
      const titleAttr = token.title ? ` title="${token.title}"` : '';
      return `<a href="${token.href}" class="chat-md-link" target="_blank" rel="noopener noreferrer"${titleAttr}>${token.text}</a>`;
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
