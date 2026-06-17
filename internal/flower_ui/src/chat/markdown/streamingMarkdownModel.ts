import type { Links, Marked, Token, TokensList } from 'marked';

export type MarkdownCommittedSegment = Readonly<{
  key: string;
  html: string;
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
): MarkdownCommittedSegment[] {
  const segments: MarkdownCommittedSegment[] = [];

  for (const entry of entries) {
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

function findUnclosedCodeBlock(entries: TokenEntry[], fromIndex: number): number {
  for (let index = fromIndex; index >= 0; index -= 1) {
    const token = entries[index]?.token;
    if (token?.type !== 'code') continue;
    const raw = String((token as { raw?: string }).raw ?? '');
    const fence = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/);
    if (!fence) continue;
    const mark = fence[1];
    if (!mark) continue;
    const char = mark[0];
    const size = mark.length;
    const last = raw.trimEnd().split('\n').at(-1)?.trim() ?? '';
    if (!new RegExp(`^[\\t ]{0,3}${char}{${size},}[\\t ]*$`).test(last)) {
      return index;
    }
  }
  return -1;
}

export function buildMarkdownRenderSnapshot(
  markdown: MarkdownParser,
  content: string,
  streaming: boolean,
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
        links,
      ),
      tail: emptyTail(),
    };
  }

  const unclosedCodeIndex = findUnclosedCodeBlock(entries, lastMeaningfulIndex);
  if (unclosedCodeIndex >= 0) {
    const unclosedEntry = entries[unclosedCodeIndex];
    const rawText = source.slice(unclosedEntry?.start ?? 0);
    return {
      sourceLength: source.length,
      committedSourceLength: unclosedEntry?.start ?? 0,
      committedSegments: unclosedCodeIndex > 0
        ? renderCommittedSegments(markdown, entries.slice(0, unclosedCodeIndex), links)
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
        links,
      ),
      tail: emptyTail(),
    };
  }

  const tailEntry = entries[lastMeaningfulIndex];
  if (!tailEntry) {
    return {
      sourceLength: source.length,
      committedSourceLength: source.length,
      committedSegments: renderCommittedSegments(markdown, entries.slice(0, lastMeaningfulIndex), links),
      tail: emptyTail(),
    };
  }

  const tailHtml = renderTokenHtml(markdown, tailEntry.token, links);
  return {
    sourceLength: source.length,
    committedSourceLength: tailEntry.start,
    committedSegments: renderCommittedSegments(
      markdown,
      entries.slice(0, lastMeaningfulIndex),
      links,
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
