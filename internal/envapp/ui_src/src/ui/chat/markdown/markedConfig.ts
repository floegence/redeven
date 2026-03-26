import type { RendererObject } from 'marked';

import { parseMarkdownFileReference } from './markdownFileReference';
import type { MarkdownRendererOptions } from './markdownRendererOptions';

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

function renderDefaultLink(token: { href: string; title?: string | null; text: string }): string {
  const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : '';
  return `<a href="${escapeHtml(token.href)}" class="chat-md-link" target="_blank" rel="noopener noreferrer"${titleAttr}>${token.text}</a>`;
}

function renderCodexFileReference(token: { href: string; title?: string | null; text: string }): string | null {
  const reference = parseMarkdownFileReference(token.href, token.text);
  if (!reference) return null;

  const title = token.title ? String(token.title) : reference.title;
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  const line = reference.lineLabel
    ? `<span class="chat-md-file-ref-line">${escapeHtml(reference.lineLabel)}</span>`
    : '';

  return `<a href="${escapeHtml(reference.href)}" class="chat-md-link chat-md-file-ref" target="_blank" rel="noopener noreferrer"${titleAttr}><span class="chat-md-file-ref-name">${escapeHtml(reference.displayName)}</span>${line}</a>`;
}

export function createMarkdownRenderer(options?: MarkdownRendererOptions): RendererObject<string, string> {
  const variant = options?.variant === 'codex' ? 'codex' : 'default';

  return {
    link(token: { href: string; title?: string | null; text: string }) {
      if (variant === 'codex') {
        const fileReferenceLink = renderCodexFileReference(token);
        if (fileReferenceLink) return fileReferenceLink;
      }
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
