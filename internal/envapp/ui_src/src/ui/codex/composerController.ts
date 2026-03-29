export type CodexComposerTextRange = Readonly<{
  start: number;
  end: number;
}>;

export type CodexComposerTriggerToken = Readonly<{
  trigger: '@' | '/';
  query: string;
  range: CodexComposerTextRange;
}>;

function clampSelectionIndex(text: string, index: number | null | undefined): number {
  const normalized = Number(index ?? 0);
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.min(text.length, Math.floor(normalized)));
}

function isWhitespaceBoundary(value: string | undefined): boolean {
  return value === undefined || /\s/.test(value);
}

function tokenEnd(text: string, start: number): number {
  let index = Math.max(0, start);
  while (index < text.length && !isWhitespaceBoundary(text[index])) {
    index += 1;
  }
  return index;
}

export function replaceComposerTextRange(
  text: string,
  range: CodexComposerTextRange,
  replacement: string,
): Readonly<{
  text: string;
  selection: number;
}> {
  const start = clampSelectionIndex(text, range.start);
  const end = clampSelectionIndex(text, range.end);
  const orderedStart = Math.min(start, end);
  const orderedEnd = Math.max(start, end);
  const nextText = `${text.slice(0, orderedStart)}${replacement}${text.slice(orderedEnd)}`;
  return {
    text: nextText,
    selection: orderedStart + replacement.length,
  };
}

export function findComposerMentionToken(args: {
  text: string;
  selectionStart: number | null | undefined;
  selectionEnd: number | null | undefined;
}): CodexComposerTriggerToken | null {
  const text = String(args.text ?? '');
  const selectionStart = clampSelectionIndex(text, args.selectionStart);
  const selectionEnd = clampSelectionIndex(text, args.selectionEnd);
  if (selectionStart !== selectionEnd) return null;

  let tokenStart = selectionStart;
  while (tokenStart > 0 && !isWhitespaceBoundary(text[tokenStart - 1])) {
    tokenStart -= 1;
  }
  if (text[tokenStart] !== '@') return null;
  if (!isWhitespaceBoundary(text[tokenStart - 1])) return null;

  const end = tokenEnd(text, tokenStart);
  if (selectionStart <= tokenStart || selectionStart > end) return null;

  return {
    trigger: '@',
    query: text.slice(tokenStart + 1, end),
    range: {
      start: tokenStart,
      end,
    },
  };
}

export function findComposerSlashCommandToken(args: {
  text: string;
  selectionStart: number | null | undefined;
  selectionEnd: number | null | undefined;
}): CodexComposerTriggerToken | null {
  const text = String(args.text ?? '');
  const selectionStart = clampSelectionIndex(text, args.selectionStart);
  const selectionEnd = clampSelectionIndex(text, args.selectionEnd);
  if (selectionStart !== selectionEnd) return null;

  const newlineIndex = text.indexOf('\n');
  const firstLineEnd = newlineIndex >= 0 ? newlineIndex : text.length;
  if (selectionStart > firstLineEnd) return null;
  if (!text.startsWith('/')) return null;

  const end = tokenEnd(text, 0);
  if (selectionStart === 0 || selectionStart > end) return null;

  return {
    trigger: '/',
    query: text.slice(1, end),
    range: {
      start: 0,
      end,
    },
  };
}
