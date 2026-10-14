import { Marked, type Token } from 'marked';
import type { FlowerCitationSource } from '../../contracts/flowerSurfaceContracts';
import { escapeFlowerMarkdownHtml } from './markedConfig';

export function safeFlowerCitationURL(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https?:\/\/[^/?#]/i.test(value) || /[\s\\]|\p{Cc}/u.test(value)) return null;
  try {
    const url = new URL(value);
    return url.hostname && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function mapFlowerCitationSources(value: unknown): readonly FlowerCitationSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((source): FlowerCitationSource[] => {
    if (!source || typeof source !== 'object') return [];
    const record = source as Record<string, unknown>;
    const url = safeFlowerCitationURL(record.url);
    if (!url) return [];
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    const start = record.start_index;
    const end = record.end_index;
    const located = typeof start === 'number' && typeof end === 'number' && Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start;
    return [{ url, title, ...(located ? { start_index: start, end_index: end } : {}) }];
  });
}

type Marker = { start: number; end: number; raw: string; complete: boolean };
const markerPattern = /\uE200cite\uE202[^\uE200\uE201]*\uE201/g;
const pendingMarkerPattern = /\uE200(?:c(?:i(?:t(?:e(?:\uE202[^\uE200\uE201]*)?)?)?)?)?$/;

// Marked owns code and Markdown semantics. Only provider markers in prose are
// adapted; code spans/fences, link destinations and escaped examples stay literal.
function proseMarkers(content: string): Marker[] {
  const all = [...content.matchAll(markerPattern)].map(match => ({ start: match.index, end: match.index + match[0].length, raw: match[0], complete: true }));
  const pending = pendingMarkerPattern.exec(content);
  if (pending) all.push({ start: pending.index, end: content.length, raw: pending[0], complete: false });
  if (!all.length) return [];
  const protectedRanges: [number, number][] = [];
  const protect = (tokens: readonly Token[], base: number) => {
    let cursor = base;
    for (const token of tokens) {
      const at = content.indexOf(token.raw, cursor);
      const start = at >= 0 ? at : cursor;
      if (['code', 'codespan', 'html', 'link', 'image'].includes(token.type)) {
        if (at >= 0) protectedRanges.push([start, start + token.raw.length]);
        else for (const marker of all) if (token.raw.includes(marker.raw)) protectedRanges.push([marker.start, marker.end]);
      } else {
        const nested = token as Token & { tokens?: Token[]; items?: { tokens: Token[] }[] };
        if (nested.tokens) protect(nested.tokens, start);
        for (const item of nested.items ?? []) protect(item.tokens, start);
      }
      if (at >= 0) cursor = start + token.raw.length;
    }
  };
  protect(new Marked({ gfm: true }).lexer(content), 0);
  return all.filter(marker => {
    const slashes = content.slice(0, marker.start).match(/\\+$/)?.[0].length ?? 0;
    return slashes % 2 === 0 && !protectedRanges.some(([start, end]) => marker.start >= start && marker.end <= end);
  });
}

export function flowerMessageTextForCopy(content: string): string {
  let result = content;
  for (const marker of proseMarkers(content).reverse()) result = result.slice(0, marker.start) + result.slice(marker.end);
  return result;
}

export type FlowerCitationPresentation = Readonly<{
  markdown: string;
  html: readonly string[];
  remaining: readonly FlowerCitationSource[];
}>;

export function prepareFlowerCitations(content: string, sources: readonly FlowerCitationSource[], unavailable: string, streaming: boolean): FlowerCitationPresentation {
  const safe = mapFlowerCitationSources(sources);
  const used = new Set<number>();
  const replacements: { marker: Marker; text: string }[] = [];
  const html: string[] = [];
  for (const marker of proseMarkers(content)) {
    const start = [...content.slice(0, marker.start)].length;
    const end = start + [...marker.raw].length;
    const matching = marker.complete ? safe.flatMap((source, index) => source.start_index === start && source.end_index === end ? [{ source, index }] : []) : [];
    if (matching.length) {
      const links = matching.map(({ source, index }) => {
        used.add(index);
        const title = source.title || new URL(source.url).hostname;
        return `<a class="flower-chat-citation" href="${escapeFlowerMarkdownHtml(source.url)}" title="${escapeFlowerMarkdownHtml(title)}" target="_blank" rel="noopener noreferrer">${escapeFlowerMarkdownHtml(title)}</a>`;
      }).join(' ');
      replacements.push({ marker, text: `\uE200flower-citation:${html.length}\uE201` });
      html.push(`<span class="flower-chat-citations">${links}</span>`);
    } else {
      replacements.push({ marker, text: safe.length || streaming ? '' : `\uE200flower-citation:${html.length}\uE201` });
      if (!safe.length && !streaming) html.push(`<span class="flower-chat-citation-unavailable">${escapeFlowerMarkdownHtml(unavailable)}</span>`);
    }
  }
  let markdown = content;
  for (const { marker, text } of replacements.reverse()) markdown = markdown.slice(0, marker.start) + text + markdown.slice(marker.end);
  const remaining = safe.filter((_, index) => !used.has(index)).filter((source, index, list) => list.findIndex(other => other.url === source.url && other.title === source.title) === index);
  return { markdown, html, remaining };
}
