import type { TerminalCore, TerminalLinkProvider } from '@floegence/floeterm-terminal-web';
import { expandHomeDisplayPath, normalizeAbsolutePath as normalizeAskFlowerAbsolutePath } from '../utils/askFlowerPath';

export type TerminalResolvedLinkTarget = {
  rawText: string;
  resolvedPath: string;
  line?: number;
  column?: number;
};

export type TerminalLinkContext = {
  workingDirAbs: string;
  agentHomePathAbs?: string;
};

type terminal_link_match = {
  text: string;
  startIndex: number;
  endIndexExclusive: number;
  target: TerminalResolvedLinkTarget;
};

type terminal_link_provider_args = {
  core: TerminalCore;
  getContext: () => TerminalLinkContext;
  onActivate: (target: TerminalResolvedLinkTarget, event: MouseEvent) => void | Promise<void>;
  isEnabled?: () => boolean;
};

const TOKEN_RE = /[^\s]+/g;
const OUTER_WRAPPER_PAIRS = new Map([
  ['"', '"'],
  ["'", "'"],
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
]);
const FORBIDDEN_PATH_CHARACTERS = new Set([
  '<', '>', "'", '"', '`', '|', ';', ',',
  '(', ')', '{', '}', '[', ']', '*', '?', '!', '=',
]);
const NO_EXTENSION_FILENAMES = new Set([
  '.env',
  '.gitignore',
  '.npmrc',
  '.prettierrc',
  'Dockerfile',
  'Gemfile',
  'Jenkinsfile',
  'Makefile',
  'Procfile',
  'Rakefile',
  'Vagrantfile',
]);
const SEMVER_RE = /^v?\d+(?:\.\d+)+$/i;

function unwrapTerminalToken(token: string, startIndex: number): { text: string; startIndex: number; endIndexExclusive: number } | null {
  let nextText = String(token ?? '');
  let nextStart = startIndex;

  while (nextText.length >= 2) {
    const closing = OUTER_WRAPPER_PAIRS.get(nextText[0] ?? '');
    if (!closing || nextText[nextText.length - 1] !== closing) {
      break;
    }
    nextText = nextText.slice(1, -1);
    nextStart += 1;
  }

  if (!nextText) {
    return null;
  }

  return {
    text: nextText,
    startIndex: nextStart,
    endIndexExclusive: nextStart + nextText.length,
  };
}

function parseLineAndColumn(token: string): { pathText: string; line?: number; column?: number } | null {
  const raw = String(token ?? '').trim();
  if (!raw) {
    return null;
  }

  const fullMatch = raw.match(/^(.*?):(\d+):(\d+)$/);
  if (fullMatch) {
    const line = Number(fullMatch[2] ?? 0);
    const column = Number(fullMatch[3] ?? 0);
    if (line <= 0 || column <= 0) {
      return null;
    }
    return {
      pathText: fullMatch[1] ?? '',
      line,
      column,
    };
  }

  const lineMatch = raw.match(/^(.*?):(\d+)$/);
  if (lineMatch) {
    const line = Number(lineMatch[2] ?? 0);
    if (line <= 0) {
      return null;
    }
    return {
      pathText: lineMatch[1] ?? '',
      line,
    };
  }

  return {
    pathText: raw,
  };
}

function basenameFromPath(path: string): string {
  const normalized = String(path ?? '').replace(/\\+/g, '/').replace(/\/+$/, '');
  const slashIndex = normalized.lastIndexOf('/');
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) : normalized;
}

function classifyFilePathCandidate(pathText: string): 'explicit' | 'relative' | null {
  const normalized = String(pathText ?? '').trim().replace(/\\+/g, '/');
  if (!normalized) {
    return null;
  }
  if (
    normalized.startsWith('-')
    || normalized.includes('://')
    || SEMVER_RE.test(normalized)
    || [...normalized].some((character) => FORBIDDEN_PATH_CHARACTERS.has(character))
    || normalized.includes(':')
  ) {
    return null;
  }
  if (normalized === '/' || normalized.endsWith('/')) {
    return null;
  }

  const hasExplicitPrefix = normalized.startsWith('/')
    || normalized.startsWith('./')
    || normalized.startsWith('../')
    || normalized.startsWith('~/');
  if (hasExplicitPrefix) {
    return basenameFromPath(normalized) ? 'explicit' : null;
  }

  if (!normalized.includes('/')) {
    return null;
  }

  const basename = basenameFromPath(normalized);
  const hasExtension = /\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(basename);
  const isKnownNoExtensionFile = NO_EXTENSION_FILENAMES.has(basename);
  const isHiddenDotfile = basename.startsWith('.') && basename.length > 1;

  return hasExtension || isKnownNoExtensionFile || isHiddenDotfile ? 'relative' : null;
}

function joinAbsolutePath(basePath: string, relativePath: string): string {
  const base = normalizeAskFlowerAbsolutePath(basePath) || '/';
  const rawRelative = String(relativePath ?? '').trim().replace(/\\+/g, '/');
  if (!rawRelative) {
    return '';
  }

  const parts = `${base}/${rawRelative}`.split('/');
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      if (resolved.length > 0) {
        resolved.pop();
      }
      continue;
    }
    resolved.push(part);
  }

  return normalizeAskFlowerAbsolutePath(`/${resolved.join('/')}`);
}

function resolveTerminalLinkPath(pathText: string, context: TerminalLinkContext): string {
  const normalizedPath = String(pathText ?? '').trim().replace(/\\+/g, '/');
  if (!normalizedPath) {
    return '';
  }

  if (normalizedPath.startsWith('~/')) {
    return expandHomeDisplayPath(normalizedPath, context.agentHomePathAbs ?? '');
  }

  if (normalizedPath.startsWith('/')) {
    return normalizeAskFlowerAbsolutePath(normalizedPath);
  }

  const workingDir = normalizeAskFlowerAbsolutePath(context.workingDirAbs)
    || normalizeAskFlowerAbsolutePath(context.agentHomePathAbs ?? '')
    || '/';
  return joinAbsolutePath(workingDir, normalizedPath);
}

function toLinkMatch(candidateText: string, startIndex: number, context: TerminalLinkContext): terminal_link_match | null {
  const parsed = parseLineAndColumn(candidateText);
  if (!parsed) {
    return null;
  }

  const line = Number.isFinite(parsed.line) && (parsed.line ?? 0) > 0 ? parsed.line : undefined;
  const column = Number.isFinite(parsed.column) && (parsed.column ?? 0) > 0 ? parsed.column : undefined;
  const pathText = String(parsed.pathText ?? '').trim();
  if (!classifyFilePathCandidate(pathText)) {
    return null;
  }

  const resolvedPath = resolveTerminalLinkPath(pathText, context);
  if (!resolvedPath || resolvedPath === '/') {
    return null;
  }

  return {
    text: candidateText,
    startIndex,
    endIndexExclusive: startIndex + candidateText.length,
    target: {
      rawText: candidateText,
      resolvedPath,
      line,
      column,
    },
  };
}

function collectTerminalLinkMatches(lineText: string, context: TerminalLinkContext): terminal_link_match[] {
  const text = String(lineText ?? '');
  if (!text) {
    return [];
  }

  const matches: terminal_link_match[] = [];
  for (const tokenMatch of text.matchAll(TOKEN_RE)) {
    const rawToken = tokenMatch[0] ?? '';
    const rawIndex = tokenMatch.index ?? -1;
    if (!rawToken || rawIndex < 0) {
      continue;
    }

    const stripped = unwrapTerminalToken(rawToken, rawIndex);
    if (!stripped) {
      continue;
    }

    const match = toLinkMatch(stripped.text, stripped.startIndex, context);
    if (!match) {
      continue;
    }

    matches.push(match);
  }

  return matches;
}

function readTerminalBufferLine(core: TerminalCore, y: number): string {
  const row = Math.floor(Number(y));
  if (!Number.isFinite(row) || row < 0) {
    return '';
  }

  try {
    return core.readBufferLine(row);
  } catch {
    return '';
  }
}

function isModifierClick(event: MouseEvent): boolean {
  return Boolean(event.metaKey || event.ctrlKey);
}

export function collectTerminalLinkTargets(lineText: string, context: TerminalLinkContext): TerminalResolvedLinkTarget[] {
  return collectTerminalLinkMatches(lineText, context).map((match) => match.target);
}

export function createTerminalFileLinkProvider(args: terminal_link_provider_args): TerminalLinkProvider {
  return {
    provideLinks(y, callback) {
      if (args.isEnabled && !args.isEnabled()) {
        callback(undefined);
        return;
      }

      const lineText = readTerminalBufferLine(args.core, y);
      if (!lineText) {
        callback(undefined);
        return;
      }

      const matches = collectTerminalLinkMatches(lineText, args.getContext());
      if (matches.length <= 0) {
        callback(undefined);
        return;
      }

      callback(matches.map((match) => ({
        text: match.text,
        range: {
          start: { x: match.startIndex + 1, y },
          end: { x: match.endIndexExclusive, y },
        },
        activate: (event: MouseEvent) => {
          if (!isModifierClick(event)) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          void Promise.resolve(args.onActivate(match.target, event)).catch(() => undefined);
        },
      })));
    },
  };
}
