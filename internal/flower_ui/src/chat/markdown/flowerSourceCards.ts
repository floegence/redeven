import { safeFlowerCitationURL } from './flowerCitations';
import { escapeFlowerMarkdownHtml as escape } from './markedConfig';

export type FlowerSourceCard = Readonly<{ number?: string; title?: string; url: string }>;
export type FlowerSourceCardLabels = Readonly<{ sources: string; copy?: string }>;

// This is an authored bibliography, not provider provenance. Only complete,
// plain-text fences made entirely of numbered title/URL pairs qualify.
export function parseFlowerSourceFence(token: { text: string; lang?: string; raw?: string }): readonly FlowerSourceCard[] | null {
  if (token.lang && !/^(text|plaintext)$/i.test(token.lang.trim())) return null;
  const lines = token.raw?.trimEnd().split('\n');
  const opening = /^ {0,3}(`{3,}|~{3,})/.exec(lines?.[0] ?? '');
  if (!opening || !lines || lines.length < 3) return null;
  const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}\\s*$`);
  if (!closing.test(lines.at(-1)!)) return null;
  const content = token.text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!content.length || content.length % 2) return null;
  const sources: FlowerSourceCard[] = [];
  const numbers = new Set<string>();
  for (let index = 0; index < content.length; index += 2) {
    const title = /^\[([1-9]\d*)\]\s+(.+)$/.exec(content[index]);
    const url = safeFlowerCitationURL(content[index + 1]);
    if (!title || !url || numbers.has(title[1])) return null;
    numbers.add(title[1]);
    sources.push({ number: title[1], title: title[2], url });
  }
  return sources;
}

export function renderFlowerSourceCards(sources: readonly FlowerSourceCard[], labels: FlowerSourceCardLabels, copyText?: string): string {
  const copy = labels.copy && copyText
    ? `<button type="button" class="flower-chat-source-copy flower-chat-md-code-copy" aria-label="${escape(labels.copy)}" title="${escape(labels.copy)}" data-flower-source-copy="${escape(copyText)}"></button>` : '';
  const rows = sources.map((source, index) => {
    const host = new URL(source.url).hostname;
    return `<li class="flower-chat-source-item"><a class="flower-chat-source-card" href="${escape(source.url)}" title="${escape(source.url)}" target="_blank" rel="noopener noreferrer"><span class="flower-chat-source-number">${escape(source.number ?? String(index + 1))}</span><span class="flower-chat-source-detail"><span class="flower-chat-source-title">${escape(source.title || host)}</span><span class="flower-chat-source-domain">${escape(host)}</span><span class="flower-chat-source-url">${escape(source.url)}</span></span></a></li>`;
  }).join('');
  return `<aside class="flower-chat-source-list" aria-label="${escape(labels.sources)}"><div class="flower-chat-source-toolbar"><span class="flower-chat-source-heading">${escape(labels.sources)}</span><span class="flower-chat-source-count">${sources.length}</span>${copy}</div><ol class="flower-chat-source-grid">${rows}</ol></aside>`;
}
