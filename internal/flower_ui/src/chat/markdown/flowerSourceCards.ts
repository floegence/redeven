import { safeFlowerCitationURL } from './flowerCitations';
import { flowerSourceIconPlaceholder } from './flowerSourceIcons';
import { escapeFlowerMarkdownHtml as escape } from './markedConfig';

export type FlowerSourceCard = Readonly<{ number?: string; title?: string; url: string }>;
export type FlowerSourceCardLabels = Readonly<{ sources: string }>;

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

export function renderFlowerSourceCards(sources: readonly FlowerSourceCard[], labels: FlowerSourceCardLabels): string {
  if (!sources.length) return '';
  const sites = new Map<string, URL>();
  const rows = sources.map((source, index) => {
    const url = new URL(source.url);
    const host = url.hostname.replace(/^www\./, '');
    if (!sites.has(host)) sites.set(host, url);
    return `<li class="flower-chat-source-item"><a class="flower-chat-source-card" href="${escape(source.url)}" title="${escape((source.title || host) + '\n' + source.url)}" target="_blank" rel="noopener noreferrer"><span class="flower-chat-source-number">${escape(source.number ?? String(index + 1))}</span>${flowerSourceIconPlaceholder(url)}<span class="flower-chat-source-detail"><span class="flower-chat-source-title">${escape(source.title || host)}</span><span class="flower-chat-source-domain">${escape(host)}</span></span><span class="flower-chat-source-external" aria-hidden="true">↗</span></a></li>`;
  }).join('');
  const summary = [...sites.values()].slice(0, 4).map(flowerSourceIconPlaceholder).join('');
  const overflow = sites.size > 4 ? `<span class="flower-chat-source-overflow">+${sites.size - 4}</span>` : '';
  return `<aside class="flower-chat-source-list" aria-label="${escape(labels.sources)}"><div class="flower-chat-source-toolbar"><button type="button" class="flower-chat-source-toggle" aria-expanded="false"><span class="flower-chat-source-chevron" aria-hidden="true">›</span><span class="flower-chat-source-heading">${escape(labels.sources)}</span><span class="flower-chat-source-count">${sources.length}</span><span class="flower-chat-source-sites" aria-hidden="true">${summary}${overflow}</span></button></div><ol class="flower-chat-source-grid" hidden>${rows}</ol></aside>`;
}
