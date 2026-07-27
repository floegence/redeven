export type FlowerComposerReferenceTextRange = Readonly<{
  start: number;
  end: number;
}>;

export type FlowerComposerReferenceToken = Readonly<{
  range: FlowerComposerReferenceTextRange;
  queryRange: FlowerComposerReferenceTextRange;
  query: string;
}>;

export type FlowerComposerReferenceTokenInput = Readonly<{
  text: string;
  selectionStart: number;
  selectionEnd: number;
  isComposing?: boolean;
}>;

export type FlowerComposerReferenceReplacement = Readonly<{
  text: string;
  cursor: number;
}>;

const UNICODE_WHITESPACE = /\p{White_Space}/u;

function clampToCodePointBoundary(text: string, offset: number): number {
  let clamped = Math.max(0, Math.min(text.length, Math.trunc(offset)));
  if (
    clamped > 0
    && clamped < text.length
    && /[\uDC00-\uDFFF]/u.test(text[clamped] ?? '')
    && /[\uD800-\uDBFF]/u.test(text[clamped - 1] ?? '')
  ) {
    clamped -= 1;
  }
  return clamped;
}

function codePointBefore(text: string, offset: number): string | undefined {
  if (offset <= 0) return undefined;
  const last = text.charCodeAt(offset - 1);
  if (last >= 0xDC00 && last <= 0xDFFF && offset > 1) {
    const first = text.charCodeAt(offset - 2);
    if (first >= 0xD800 && first <= 0xDBFF) return text.slice(offset - 2, offset);
  }
  return text.slice(offset - 1, offset);
}

function codePointAt(text: string, offset: number): string | undefined {
  const codePoint = text.codePointAt(offset);
  return codePoint === undefined ? undefined : String.fromCodePoint(codePoint);
}

function isWhitespace(value: string | undefined): boolean {
  return value !== undefined && UNICODE_WHITESPACE.test(value);
}

function isHorizontalWhitespace(value: string | undefined): boolean {
  return isWhitespace(value) && value !== '\n' && value !== '\r';
}

/**
 * Returns the editable `@` token containing the collapsed selection.
 *
 * Offsets use JavaScript string indices so they can be applied directly to a
 * textarea selection. The query ends at the caret while the replacement range
 * covers the complete token, including any suffix after the caret.
 */
export function findFlowerComposerReferenceToken(
  input: FlowerComposerReferenceTokenInput,
): FlowerComposerReferenceToken | undefined {
  if (input.isComposing || input.selectionStart !== input.selectionEnd) return undefined;

  const cursor = clampToCodePointBoundary(input.text, input.selectionStart);
  if (
    cursor > 0
    && isWhitespace(codePointBefore(input.text, cursor))
    && input.text[cursor] !== '@'
  ) return undefined;

  let start = cursor;
  while (start > 0 && !isWhitespace(codePointBefore(input.text, start))) {
    const previous = codePointBefore(input.text, start);
    if (!previous) break;
    start -= previous.length;
  }

  if (input.text[start] !== '@') return undefined;
  if (start > 0 && !isWhitespace(codePointBefore(input.text, start))) return undefined;

  let end = start + 1;
  while (end < input.text.length && !isWhitespace(codePointAt(input.text, end))) {
    const current = codePointAt(input.text, end);
    if (!current) break;
    end += current.length;
  }
  if (cursor < start || cursor > end) return undefined;

  const queryEnd = Math.max(start + 1, cursor);
  return {
    range: { start, end },
    queryRange: { start: start + 1, end: queryEnd },
    query: input.text.slice(start + 1, queryEnd),
  };
}

/** Removes a resolved token while preserving newlines and normalizing one horizontal gap. */
export function replaceFlowerComposerReferenceToken(
  text: string,
  range: FlowerComposerReferenceTextRange,
): FlowerComposerReferenceReplacement {
  const start = clampToCodePointBoundary(text, Math.min(range.start, range.end));
  const end = clampToCodePointBoundary(text, Math.max(range.start, range.end));
  let before = text.slice(0, start);
  let after = text.slice(end);

  const beforeWhitespace = codePointBefore(before, before.length);
  const afterWhitespace = codePointAt(after, 0);

  if (!before) {
    if (isHorizontalWhitespace(afterWhitespace)) after = after.slice(afterWhitespace?.length ?? 0);
  } else if (!after) {
    if (isHorizontalWhitespace(beforeWhitespace)) before = before.slice(0, -beforeWhitespace!.length);
  } else if (isHorizontalWhitespace(beforeWhitespace) && isHorizontalWhitespace(afterWhitespace)) {
    after = after.slice(afterWhitespace?.length ?? 0);
  } else if (!isWhitespace(beforeWhitespace) && !isWhitespace(afterWhitespace)) {
    before += ' ';
  }

  return {
    text: before + after,
    cursor: before.length,
  };
}
