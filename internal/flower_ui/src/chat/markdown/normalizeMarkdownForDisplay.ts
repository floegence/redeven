export function normalizeMarkdownForDisplay(input: string): string {
  return String(input ?? '').replace(/\r\n?/g, '\n');
}
