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

function normalizePathSegments(path: string): string[] {
  return String(path ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
}

function collectMarkdownFileReferences(value: unknown, output: MarkdownFileReference[], seen: Set<object>): void {
  if (!value) return;

  if (Array.isArray(value)) {
    for (const entry of value) collectMarkdownFileReferences(entry, output, seen);
    return;
  }

  if (typeof value !== 'object') return;

  const candidate = value as Record<string, unknown>;
  if (seen.has(candidate)) return;
  seen.add(candidate);

  const href = typeof candidate.href === 'string' ? candidate.href : null;
  const text = typeof candidate.text === 'string' ? candidate.text : null;
  if (href && text) {
    const reference = parseMarkdownFileReference(href, text);
    if (reference) output.push(reference);
  }

  for (const nested of Object.values(candidate)) {
    if (nested && typeof nested === 'object') {
      collectMarkdownFileReferences(nested, output, seen);
    }
  }
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

export function collectMarkdownFileReferencesFromTokens(tokens: unknown): MarkdownFileReference[] {
  const output: MarkdownFileReference[] = [];
  collectMarkdownFileReferences(tokens, output, new Set<object>());
  return output;
}

export function buildMarkdownFileReferencePrefixMap(
  references: readonly MarkdownFileReference[],
): ReadonlyMap<string, string> {
  const referencesByName = new Map<string, MarkdownFileReference[]>();

  for (const reference of references) {
    const key = String(reference.displayName ?? '').trim();
    if (!key) continue;
    const items = referencesByName.get(key);
    if (items) {
      items.push(reference);
    } else {
      referencesByName.set(key, [reference]);
    }
  }

  const prefixByPath = new Map<string, string>();

  for (const [, group] of referencesByName) {
    const uniquePaths = Array.from(new Set(group.map((reference) => reference.path)));
    if (uniquePaths.length < 2) continue;

    const segmentsByPath = new Map(uniquePaths.map((path) => [path, normalizePathSegments(path)]));
    const maxDepth = Math.max(...uniquePaths.map((path) => segmentsByPath.get(path)?.length ?? 0));

    for (let depth = 2; depth <= maxDepth; depth += 1) {
      const suffixByPath = new Map<string, string>();
      const seenSuffixes = new Set<string>();
      let hasCollision = false;

      for (const path of uniquePaths) {
        const segments = segmentsByPath.get(path) ?? [];
        const suffix = segments.slice(-depth).join('/');
        if (!suffix || seenSuffixes.has(suffix)) {
          hasCollision = true;
          break;
        }
        seenSuffixes.add(suffix);
        suffixByPath.set(path, suffix);
      }

      if (hasCollision) continue;

      for (const path of uniquePaths) {
        const segments = suffixByPath.get(path)?.split('/') ?? [];
        const prefixSegments = segments.slice(0, -1);
        if (prefixSegments.length > 0) {
          prefixByPath.set(path, `…/${prefixSegments.join('/')}/`);
        }
      }
      break;
    }
  }

  return prefixByPath;
}
