export interface MarkdownFileReference {
  href: string;
  path: string;
  displayName: string;
  lineLabel: string | null;
  title: string;
}

const LOCAL_FILE_PATH_RE = /^(?:\/|\.{1,2}\/|[A-Za-z]:[\\/])/;
const FRAGMENT_LINE_RE = /^L(\d+)(?:C(\d+))?$/i;
const TEXT_LINE_RE = /\bL(\d+)(?:C(\d+))?\b/i;
const TEXT_COLON_LINE_RE = /:(\d+)(?::(\d+))?$/;

function collapseWhitespace(value: string): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function splitHref(href: string): { path: string; fragment: string } {
  const raw = String(href ?? '').trim();
  const hashIndex = raw.indexOf('#');
  const withoutFragment = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutFragment.indexOf('?');
  return {
    path: queryIndex >= 0 ? withoutFragment.slice(0, queryIndex) : withoutFragment,
    fragment: hashIndex >= 0 ? raw.slice(hashIndex + 1) : '',
  };
}

function basenameFromPath(path: string): string {
  const normalized = String(path ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function formatLineLabel(line: string, column?: string | null): string {
  return column ? `L${line}C${column}` : `L${line}`;
}

function extractLineLabelFromFragment(fragment: string): string | null {
  const match = String(fragment ?? '').trim().match(FRAGMENT_LINE_RE);
  if (!match) return null;
  return formatLineLabel(match[1] ?? '', match[2] ?? null);
}

function extractLineLabelFromText(text: string): string | null {
  const normalized = collapseWhitespace(text);
  const lineMatch = normalized.match(TEXT_LINE_RE);
  if (lineMatch) return formatLineLabel(lineMatch[1] ?? '', lineMatch[2] ?? null);

  const colonMatch = normalized.match(TEXT_COLON_LINE_RE);
  if (!colonMatch) return null;
  return formatLineLabel(colonMatch[1] ?? '', colonMatch[2] ?? null);
}

export function parseMarkdownFileReference(href: string, text: string): MarkdownFileReference | null {
  const rawHref = String(href ?? '').trim();
  if (!rawHref) return null;

  const { path, fragment } = splitHref(rawHref);
  if (!LOCAL_FILE_PATH_RE.test(path)) return null;

  const displayName = basenameFromPath(path);
  if (!displayName) return null;

  const lineLabel = extractLineLabelFromFragment(fragment) ?? extractLineLabelFromText(text);
  if (!lineLabel && !displayName.includes('.')) return null;

  return {
    href: rawHref,
    path,
    displayName,
    lineLabel,
    title: rawHref,
  };
}
