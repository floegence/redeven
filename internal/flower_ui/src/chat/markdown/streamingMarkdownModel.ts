import type { Links, Marked, Token, TokensList } from 'marked';
import { retainEqualValue } from '../../presentationIdentity';

export type MarkdownCommittedSegment = Readonly<{
  key: string;
  html: string;
  media?: Readonly<{ html: string; state?: 'generating' | 'incomplete' }>;
}>;

export type MarkdownTail =
  | Readonly<{ kind: 'empty'; key: 'empty' }>
  | Readonly<{ kind: 'html'; key: string; html: string }>
  | Readonly<{ kind: 'raw'; key: string; text: string }>;

export type MarkdownRenderSnapshot = Readonly<{
  sourceLength: number;
  committedSourceLength: number;
  committedSegments: readonly MarkdownCommittedSegment[];
  tail: MarkdownTail;
}>;

type MarkdownParser = Pick<Marked<string, string>, 'lexer' | 'parser'>;

// Each mounted message owns only the tokens used by its latest render. Full
// lexing still resolves references and block boundaries before HTML is reused.
export function createMarkdownRenderModel(markdown: MarkdownParser) {
  let previous: MarkdownRenderSnapshot | undefined;
  let previousLinks: Links | undefined;
  let previousRenderingKey: string | undefined;
  let cache = new Map<string, { token: Token; html: string }>();
  return (content: string, streaming: boolean, renderingKey = '', mediaEnabled = false): MarkdownRenderSnapshot => {
    if (previousRenderingKey !== renderingKey) cache.clear();
    previousRenderingKey = renderingKey;
    const nextCache = new Map<string, { token: Token; html: string }>();
    const cachedParser: MarkdownParser = {
      lexer(source, options) {
        const tokens = markdown.lexer(source, options);
        const links = retainEqualValue(previousLinks, tokens.links);
        if (links !== previousLinks) cache.clear();
        previousLinks = links;
        return tokens;
      },
      parser(tokens, options) {
        const token = tokens[0]!;
        const key = `${token.type}:${token.raw}`;
        const cached = cache.get(key);
        const result = cached && retainEqualValue(cached.token, token) === cached.token
          ? cached
          : { token, html: String(markdown.parser(tokens, options) ?? '') };
        nextCache.set(key, result);
        return result.html;
      },
    };
    const snapshot = buildMarkdownRenderSnapshot(cachedParser, content, streaming, mediaEnabled);
    cache = nextCache;
    previous = retainEqualValue(previous, snapshot);
    return previous;
  };
}

type TokenEntry = {
  token: Token;
  start: number;
  end: number;
};

function toTokenEntries(tokens: TokensList): { entries: TokenEntry[]; links: Links } {
  const entries: TokenEntry[] = [];
  let offset = 0;

  for (const token of Array.from(tokens)) {
    const raw = String((token as { raw?: string }).raw ?? '');
    const start = offset;
    offset += raw.length;
    entries.push({
      token,
      start,
      end: offset,
    });
  }

  return {
    entries,
    links: tokens.links,
  };
}

function createTokensList(tokens: Token[], links: Links): TokensList {
  const list = tokens.slice() as TokensList;
  list.links = links;
  return list;
}

function renderTokenHtml(markdown: MarkdownParser, token: Token, links: Links): string {
  return String(markdown.parser(createTokensList([token], links)) ?? '');
}

function renderCommittedSegments(
  markdown: MarkdownParser,
  entries: TokenEntry[],
  links: Links,
  mediaEnabled = false,
  streaming = false,
): MarkdownCommittedSegment[] {
  const segments: MarkdownCommittedSegment[] = [];

  for (const entry of entries) {
    if (mediaEnabled && entry.token.type === 'code' && entry.token.lang?.trim().toLowerCase() === 'html preview') {
      const closed = isClosedFence(String(entry.token.raw ?? ''));
      segments.push({ key: entry.start + ':html-preview', html: '', media: {
        html: entry.token.text,
        state: closed ? undefined : streaming ? 'generating' : 'incomplete',
      } });
      continue;
    }
    const html = renderTokenHtml(markdown, entry.token, links);
    if (!html.trim()) continue;
    segments.push({
      key: `${entry.start}:${entry.end}:${entry.token.type}`,
      html,
    });
  }

  return segments;
}

function emptyTail(): MarkdownTail {
  return {
    kind: 'empty',
    key: 'empty',
  };
}

function isClosedFence(raw: string): boolean {
  const lines = raw.trimEnd().split('\n');
  const opening = lines[0]?.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
  const mark = opening?.[1];
  if (!mark || lines.length < 2) return false;
  const closing = lines.at(-1)?.match(/^[ \t]{0,3}(`+|~+)[ \t]*$/)?.[1];
  return !!closing && closing[0] === mark[0] && closing.length >= mark.length;
}

function findUnclosedCodeBlock(entries: TokenEntry[], fromIndex: number): number {
  for (let index = fromIndex; index >= 0; index -= 1) {
    const token = entries[index]?.token;
    if (token?.type === 'code' && /^[ \t]{0,3}(`{3,}|~{3,})/.test(String(token.raw ?? '')) && !isClosedFence(String(token.raw ?? ''))) return index;
  }
  return -1;
}

export function buildMarkdownRenderSnapshot(
  markdown: MarkdownParser,
  content: string,
  streaming: boolean,
  mediaEnabled = false,
): MarkdownRenderSnapshot {
  const source = String(content ?? '');
  if (!source) {
    return {
      sourceLength: 0,
      committedSourceLength: 0,
      committedSegments: [],
      tail: emptyTail(),
    };
  }

  const tokens = markdown.lexer(source);
  const { entries, links } = toTokenEntries(tokens);

  let lastMeaningfulIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    if (entries[index]?.token.type !== 'space') {
      lastMeaningfulIndex = index;
      break;
    }
  }

  if (lastMeaningfulIndex < 0) {
    return {
      sourceLength: source.length,
      committedSourceLength: source.length,
      committedSegments: [],
      tail: emptyTail(),
    };
  }

  if (!streaming) {
    return {
      sourceLength: source.length,
      committedSourceLength: source.length,
      committedSegments: renderCommittedSegments(
        markdown,
        entries.slice(0, lastMeaningfulIndex + 1),
        links, mediaEnabled, streaming,
      ),
      tail: emptyTail(),
    };
  }

  const unclosedCodeIndex = findUnclosedCodeBlock(entries, lastMeaningfulIndex);
  if (unclosedCodeIndex >= 0) {
    const unclosedEntry = entries[unclosedCodeIndex];
    if (mediaEnabled && unclosedEntry?.token.type === 'code' && unclosedEntry.token.lang?.trim().toLowerCase() === 'html preview') {
      return {
        sourceLength: source.length,
        committedSourceLength: unclosedEntry.start,
        committedSegments: renderCommittedSegments(markdown, entries, links, true, streaming),
        tail: emptyTail(),
      };
    }
    const rawText = source.slice(unclosedEntry?.start ?? 0);
    return {
      sourceLength: source.length,
      committedSourceLength: unclosedEntry?.start ?? 0,
      committedSegments: unclosedCodeIndex > 0
        ? renderCommittedSegments(markdown, entries.slice(0, unclosedCodeIndex), links, mediaEnabled, streaming)
        : [],
      tail: rawText
        ? {
          kind: 'raw',
          key: `${unclosedEntry?.start ?? 0}:${source.length}:raw-code`,
          text: rawText,
        }
        : emptyTail(),
    };
  }

  const hasTrailingSpace = lastMeaningfulIndex < entries.length - 1;
  if (hasTrailingSpace) {
    return {
      sourceLength: source.length,
      committedSourceLength: source.length,
      committedSegments: renderCommittedSegments(
        markdown,
        entries.slice(0, lastMeaningfulIndex + 1),
        links, mediaEnabled, streaming,
      ),
      tail: emptyTail(),
    };
  }

  const tailEntry = entries[lastMeaningfulIndex];
  if (!tailEntry) {
    return {
      sourceLength: source.length,
      committedSourceLength: source.length,
      committedSegments: renderCommittedSegments(markdown, entries.slice(0, lastMeaningfulIndex), links, mediaEnabled, streaming),
      tail: emptyTail(),
    };
  }

  if (mediaEnabled && tailEntry.token.type === 'code' && tailEntry.token.lang?.trim().toLowerCase() === 'html preview') {
    return { sourceLength: source.length, committedSourceLength: source.length,
      committedSegments: renderCommittedSegments(markdown, entries, links, true, streaming), tail: emptyTail() };
  }
  const tailHtml = renderTokenHtml(markdown, tailEntry.token, links);
  return {
    sourceLength: source.length,
    committedSourceLength: tailEntry.start,
    committedSegments: renderCommittedSegments(
      markdown,
      entries.slice(0, lastMeaningfulIndex),
      links, mediaEnabled, streaming,
    ),
    tail: tailHtml.trim()
      ? {
        kind: 'html',
        key: `${tailEntry.start}:${tailEntry.end}:${tailEntry.token.type}`,
        html: tailHtml,
      }
      : emptyTail(),
  };
}
