export const CHAT_LARGE_CODE_CHAR_THRESHOLD = 16_000;
export const CHAT_LARGE_CODE_LINE_THRESHOLD = 240;

export const CHAT_LARGE_DIFF_CHAR_THRESHOLD = 24_000;
export const CHAT_LARGE_DIFF_LINE_THRESHOLD = 320;
export const CHAT_DIFF_ROW_HEIGHT_PX = 24;
export const CHAT_DIFF_MAX_VIEWPORT_HEIGHT_PX = 480;

export const CHAT_LARGE_MERMAID_CHAR_THRESHOLD = 2_400;
export const CHAT_LARGE_MERMAID_LINE_THRESHOLD = 80;

export function countTextLines(content: string): number {
  if (!content) return 0;
  return content.split('\n').length;
}

export function isLargeCodeBlock(content: string): boolean {
  return (
    content.length >= CHAT_LARGE_CODE_CHAR_THRESHOLD
    || countTextLines(content) >= CHAT_LARGE_CODE_LINE_THRESHOLD
  );
}

export function isLargeCodeDiff(oldCode: string, newCode: string): boolean {
  return (
    oldCode.length + newCode.length >= CHAT_LARGE_DIFF_CHAR_THRESHOLD
    || Math.max(countTextLines(oldCode), countTextLines(newCode)) >= CHAT_LARGE_DIFF_LINE_THRESHOLD
  );
}

export function isLargeMermaidDiagram(content: string): boolean {
  return (
    content.length >= CHAT_LARGE_MERMAID_CHAR_THRESHOLD
    || countTextLines(content) >= CHAT_LARGE_MERMAID_LINE_THRESHOLD
  );
}

export function resolveDiffViewportHeight(lineCount: number): number {
  return Math.min(
    Math.max(lineCount * CHAT_DIFF_ROW_HEIGHT_PX, CHAT_DIFF_ROW_HEIGHT_PX * 8),
    CHAT_DIFF_MAX_VIEWPORT_HEIGHT_PX,
  );
}
