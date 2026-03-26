const FENCED_CODE_BLOCK_RE = /```[\s\S]*?```/g;
const THEMATIC_BREAK_BEFORE_RE = /([^\n])(?=---(?:\n|$))/g;
const THEMATIC_BREAK_AFTER_RE = /(^|\n)(---)([^\n])/g;
const CHINESE_SECTION_HEADING_RE =
  /^(第(?:[0-9]+|[零一二三四五六七八九十百千万两]+)(?:章|节|回|幕|篇|部分|卷|集))([：:])(.+)$/u;
const ENGLISH_SECTION_HEADING_RE =
  /^((?:Chapter|Section|Part|Episode|Act|Scene|Appendix)\s+[A-Za-z0-9IVXLC]+)([:.-])\s+(.+)$/;
const INLINE_EMPHASIS_BLOCK_RE =
  /^(\*\*[^*\n]{1,40}\*\*|\*[^*\n]{1,40}\*)(?=\S)/;
const WEAK_TITLE_END_RE = /[的了着在是和与及把将向对从于而并或给让被跟呢吗吧啊呀嘛]$/u;
const LIKELY_SENTENCE_START_RE =
  /^(在|当|按|从|向|沿|随着|为了|通过|这时|这天|此时|后来|随后|突然|多年后|很久以前|一天|今夜|今天|夜幕|清晨|黄昏|前方|眼前|这里|那里|她|他|它|他们|她们|我|我们|你|你们|一个|一位|一只|一道|一阵|整片|整个|远处|门外|天空|大地|森林|城堡|宫殿|洞穴|花园|湖边|水晶|光芒|终于|最终|于是|Meanwhile|Later|Suddenly|When|After|Before|In|The |A |An )/u;
const LIKELY_BODY_PUNCTUATION_RE = /[，。！？,.!?]/u;
const HORIZONTAL_WHITESPACE_RE = /[ \t]/;

function countRepeatedCharacter(input: string, start: number, character: string): number {
  let index = start;
  while (input[index] === character) index += 1;
  return index - start;
}

function shouldInsertInlineHeadingBoundary(segment: string, index: number): boolean {
  const previous = segment[index - 1];
  if (!previous || previous === '\n' || previous === '#') return false;

  const markerLength = countRepeatedCharacter(segment, index, '#');
  if (markerLength < 1 || markerLength > 6) return false;

  const next = segment[index + markerLength];
  if (!next || next === '#' || /\s/.test(next)) return false;

  return true;
}

function repairInlineHeadingBoundaries(segment: string): string {
  let output = '';
  let index = 0;
  let inlineCodeFenceLength = 0;
  let pendingLinkDestination = false;
  let linkDestinationDepth = 0;

  while (index < segment.length) {
    const character = segment[index];
    const escapedCharacter = segment[index + 1];
    const backtickRunLength = countRepeatedCharacter(segment, index, '`');

    if (character === '\\') {
      output += escapedCharacter ? `${character}${escapedCharacter}` : character;
      index += escapedCharacter ? 2 : 1;
      continue;
    }

    if (backtickRunLength > 0) {
      output += segment.slice(index, index + backtickRunLength);
      if (inlineCodeFenceLength === 0) {
        inlineCodeFenceLength = backtickRunLength;
      } else if (inlineCodeFenceLength === backtickRunLength) {
        inlineCodeFenceLength = 0;
      }
      index += backtickRunLength;
      continue;
    }

    if (inlineCodeFenceLength > 0) {
      output += character;
      index += 1;
      continue;
    }

    if (linkDestinationDepth > 0) {
      output += character;
      if (character === '(') {
        linkDestinationDepth += 1;
      } else if (character === ')') {
        linkDestinationDepth -= 1;
      }
      index += 1;
      continue;
    }

    if (pendingLinkDestination) {
      if (HORIZONTAL_WHITESPACE_RE.test(character)) {
        output += character;
        index += 1;
        continue;
      }
      pendingLinkDestination = false;
      if (character === '(') {
        linkDestinationDepth = 1;
        output += character;
        index += 1;
        continue;
      }
    }

    if (character === ']') {
      pendingLinkDestination = true;
      output += character;
      index += 1;
      continue;
    }

    if (character === '#' && shouldInsertInlineHeadingBoundary(segment, index)) {
      const markerLength = countRepeatedCharacter(segment, index, '#');
      output += `\n\n${segment.slice(index, index + markerLength)}`;
      index += markerLength;
      continue;
    }

    output += character;
    index += 1;
  }

  return output;
}

function repairInlineBlockBoundaries(segment: string): string {
  let output = repairInlineHeadingBoundaries(segment);
  output = output.replace(THEMATIC_BREAK_BEFORE_RE, '$1\n\n');
  output = output.replace(THEMATIC_BREAK_AFTER_RE, '$1$2\n\n$3');
  return output;
}

function findLikelyTitleBoundary(remainder: string): number | null {
  const maxIndex = Math.min(20, remainder.length - 6);
  let bestIndex: number | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 2; index <= maxIndex; index += 1) {
    const title = remainder.slice(0, index).trim();
    const body = remainder.slice(index).trimStart();
    if (!title || body.length < 8) continue;
    if (!LIKELY_BODY_PUNCTUATION_RE.test(body.slice(0, 24))) continue;

    const titleLength = Array.from(title).length;
    let score = 0;

    score -= Math.abs(titleLength - 7);
    if (titleLength >= 4 && titleLength <= 12) score += 6;
    if (WEAK_TITLE_END_RE.test(title)) score -= 6;
    if (title.at(-1) === body[0]) score -= 8;
    if (/^[的了着和与及、，。：:]/u.test(body)) score -= 8;
    if (LIKELY_SENTENCE_START_RE.test(body)) score += 8;
    if (/^\p{Script=Han}{2,}/u.test(body)) score += 2;
    if (/^[A-Z]/.test(body)) score += 4;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestScore >= 4 ? bestIndex : null;
}

function repairSectionHeadingContent(content: string): { heading: string; body: string } | null {
  const chineseMatch = content.match(CHINESE_SECTION_HEADING_RE);
  if (chineseMatch) {
    const [, label, separator, remainder] = chineseMatch;
    const boundary = findLikelyTitleBoundary(remainder);
    if (boundary === null) return null;
    return {
      heading: `${label}${separator}${remainder.slice(0, boundary).trim()}`,
      body: remainder.slice(boundary).trimStart(),
    };
  }

  const englishMatch = content.match(ENGLISH_SECTION_HEADING_RE);
  if (englishMatch) {
    const [, label, separator, remainder] = englishMatch;
    const boundary = findLikelyTitleBoundary(remainder);
    if (boundary === null) return null;
    return {
      heading: `${label}${separator} ${remainder.slice(0, boundary).trim()}`,
      body: remainder.slice(boundary).trimStart(),
    };
  }

  return null;
}

function normalizeHeadingLine(line: string): string {
  const match = line.match(/^(#{1,6})(?:\s+)?(.*)$/);
  if (!match) return line;

  const [, markers, rawContent] = match;
  const content = rawContent.trim();
  if (!content) return markers;

  const repairedSection = repairSectionHeadingContent(content);
  if (!repairedSection) {
    return `${markers} ${content}`;
  }

  return `${markers} ${repairedSection.heading}\n\n${repairedSection.body}`;
}

function normalizeStandaloneEmphasisLine(line: string): string {
  const match = line.match(INLINE_EMPHASIS_BLOCK_RE);
  if (!match) return line;

  const block = match[1];
  const remainder = line.slice(block.length).trimStart();
  if (!remainder) return line;
  if (/[：:]$/.test(block)) return line;

  return `${block}\n\n${remainder}`;
}

function normalizeProseLine(line: string): string {
  if (/^#{1,6}(?:\s|$|\S)/.test(line)) {
    return normalizeHeadingLine(line);
  }
  if (line === '---') return line;
  return normalizeStandaloneEmphasisLine(line);
}

function normalizeProseSegment(segment: string): string {
  return repairInlineBlockBoundaries(segment)
    .split('\n')
    .map((line) => normalizeProseLine(line))
    .join('\n');
}

function normalizeMarkdownLineEndings(input: string): string {
  return String(input ?? '').replace(/\r\n?/g, '\n');
}

export function normalizeMarkdownForStreamingDisplay(input: string): string {
  return normalizeMarkdownLineEndings(input);
}

export function normalizeMarkdownForDisplay(input: string): string {
  const source = normalizeMarkdownLineEndings(input);
  if (!source) return '';

  let out = '';
  let lastIndex = 0;

  for (const match of source.matchAll(FENCED_CODE_BLOCK_RE)) {
    const index = match.index ?? 0;
    out += normalizeProseSegment(source.slice(lastIndex, index));
    out += match[0];
    lastIndex = index + match[0].length;
  }

  out += normalizeProseSegment(source.slice(lastIndex));
  return out;
}
