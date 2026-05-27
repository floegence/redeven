import type { Links, Marked, Token, TokensList } from 'marked';

import { buildMarkdownFileReferencePrefixMap, collectMarkdownFileReferencesFromTokens } from './markdownFileReference';
import { withMarkdownRenderContext } from './markedConfig';
import type { MarkdownCommittedSegment, MarkdownRenderSnapshot } from '../types';

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

function findUnclosedBlockBacktrack(
  entries: TokenEntry[],
  fromIndex: number,
): number {
  for (let i = fromIndex; i >= 0; i -= 1) {
    const t = entries[i]?.token;
    if (t?.type === 'code') {
      const raw = String((t as { raw?: string }).raw ?? '');
      const fences = raw.match(/^```/gm);
      if (fences && fences.length % 2 !== 0) {
        return i;
      }
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
      tail: {
        kind: 'empty',
        key: 'empty',
      },
    };
  }

  const tokens = markdown.lexer(source);
  const { entries, links } = toTokenEntries(tokens);
  const renderContext = {
    fileReferencePrefixByPath: buildMarkdownFileReferencePrefixMap(
      collectMarkdownFileReferencesFromTokens(tokens),
    ),
  };

  return withMarkdownRenderContext(renderContext, () => {
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
        tail: {
          kind: 'empty',
          key: 'empty',
        },
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
        tail: {
          kind: 'empty',
          key: 'empty',
        },
      };
    }

    const unclosedBlockIdx = findUnclosedBlockBacktrack(entries, lastMeaningfulIndex);
    if (unclosedBlockIdx >= 0) {
      const committedEnd = unclosedBlockIdx;
      return {
        sourceLength: source.length,
        committedSourceLength: entries[unclosedBlockIdx]?.start ?? 0,
        committedSegments: committedEnd > 0
          ? renderCommittedSegments(markdown, entries.slice(0, committedEnd), links)
          : [],
        tail: {
          kind: 'raw',
          key: `${entries[unclosedBlockIdx]?.start ?? 0}:${source.length}:code-unclosed`,
        },
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
        tail: {
          kind: 'empty',
          key: 'empty',
        },
      };
    }

    const tailEntry = entries[lastMeaningfulIndex];
    if (tailEntry?.token.type === 'code') {
      return {
        sourceLength: source.length,
        committedSourceLength: tailEntry.start,
        committedSegments: lastMeaningfulIndex > 0
          ? renderCommittedSegments(markdown, entries.slice(0, lastMeaningfulIndex), links)
          : [],
        tail: {
          kind: 'raw',
          key: `${tailEntry.start}:${tailEntry.end}:code-tail`,
        },
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
        : {
          kind: 'empty',
          key: `${tailEntry.start}:${tailEntry.end}:${tailEntry.token.type}`,
        },
    };
  });
}
