import type { Marked, Token, Tokens } from 'marked';
import type { FlowerCitationSource } from '../../contracts/flowerSurfaceContracts';
import { escapeFlowerMarkdownHtml } from './markedConfig';
import { mapFlowerCitationSources } from './flowerCitations';

/** Original Unicode positions indexed once as normalized source arrives. */
export function createMarkdownSourceIndex() {
  let positions: number[] = [];
  let points = 0; let priorCR = false; let priorHigh = false;
  return {
    reset() { positions = []; points = 0; priorCR = false; priorHigh = false; },
    append(delta: string) {
      for (let i = 0; i < delta.length; i++) {
        const code = delta.charCodeAt(i);
        const low = code >= 0xdc00 && code <= 0xdfff;
        const at = points - (low && priorHigh ? 1 : 0);
        if (!(priorCR && code === 10)) positions.push(at);
        if (!(low && priorHigh)) points++;
        priorHigh = code >= 0xd800 && code <= 0xdbff; priorCR = code === 13;
      }
    },
    point(offset: number) { return positions[offset] ?? points; },
  };
}

export function createIncrementalCitations(markdown: Marked<string, string>, input: {
  sources: () => readonly FlowerCitationSource[];
  unavailable: () => string;
  streaming: () => boolean;
}) {
  const positions = new WeakMap<object, number>();
  const used = new Map<number, readonly FlowerCitationSource[]>();
  let safe: readonly FlowerCitationSource[] = [];
  const index = createMarkdownSourceIndex();
  const render = (token: Token) => {
    const raw = token.raw;
    const at = positions.get(token);
    const complete = raw.endsWith('\uE201');
    const matching = at === undefined || !complete ? [] : safe.filter(source => source.start_index === at && source.end_index === at + [...raw].length);
    if (at !== undefined) { if (matching.length) used.set(at, matching); else used.delete(at); }
    if (!matching.length) return safe.length || input.streaming() ? '' : '<span class="flower-chat-citation-unavailable">' + escapeFlowerMarkdownHtml(input.unavailable()) + '</span>';
    return '<span class="flower-chat-citations">' + matching.map(source => {
      const title = source.title || new URL(source.url).hostname;
      return '<a class="flower-chat-citation" href="' + escapeFlowerMarkdownHtml(source.url) + '" title="' + escapeFlowerMarkdownHtml(title) + '" target="_blank" rel="noopener noreferrer">' + escapeFlowerMarkdownHtml(title) + '</a>';
    }).join(' ') + '</span>';
  };
  markdown.use({ extensions: [{ name: 'flowerCitation', level: 'inline',
    start(source) { return source.indexOf('\uE200'); },
    tokenizer(source) {
      const complete = /^\uE200cite\uE202[^\uE200\uE201]*\uE201/.exec(source);
      const pending = /^\uE200(?:c(?:i(?:t(?:e(?:\uE202[^\uE200\uE201]*)?)?)?)?)?$/.exec(source);
      const raw = complete?.[0] ?? pending?.[0];
      return raw ? { type: 'flowerCitation', raw } : undefined;
    },
    renderer(token) { return render(token); },
  }] });
  const forget = (start: number, length: number) => {
    const first = index.point(start); const end = index.point(start + length);
    for (const position of used.keys()) if (position >= first && position < end) used.delete(position);
  };
  // Walk existing leaf order against physical source. Containers strip quote
  // and list prefixes; table cells have no raw field. No second lexer is needed.
  const locate = (tokens: readonly Token[], start: number, raw: string) => {
    let cursor = 0;
    const walk = (token: Token) => {
      const nested = token as Token & { tokens?: Token[]; items?: Tokens.ListItem[] };
      if (token.type === 'table') {
        const table = token as Tokens.Table;
        for (const cell of [...table.header, ...table.rows.flat()]) for (const child of cell.tokens) walk(child);
      } else if (!['link', 'image', 'code', 'codespan', 'html'].includes(token.type) && (nested.tokens || nested.items)) {
        for (const child of nested.tokens ?? nested.items ?? []) walk(child);
      } else {
        const found = raw.indexOf(token.raw, cursor);
        if (found >= 0) {
          positions.set(token, index.point(start + found));
          cursor = found + token.raw.length;
        } else {
          // Text can span stripped prefixes or escaped pipes. Consume its
          // physical subsequence; citation markers always require exact offsets.
          let next = cursor;
          for (const character of token.raw) {
            const at = raw.indexOf(character, next);
            if (at < 0) break;
            next = at + character.length;
          }
          cursor = next;
        }
      }
    };
    for (const token of tokens) walk(token);
  };
  return {
    index,
    sources() { safe = mapFlowerCitationSources(input.sources()); },
    locate, forget,
    remaining() {
      const urls = new Set([...used.values()].flatMap(values => values.map(source => source.url + '\x00' + source.title)));
      return safe.filter((source, i) => !urls.has(source.url + '\x00' + source.title) && safe.findIndex(other => other.url === source.url && other.title === source.title) === i);
    },
    reset() { index.reset(); used.clear(); },
  };
}
