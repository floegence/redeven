import type { MobileKeyboardSuggestionItem } from '@floegence/floe-webapp-core/ui';
import { expandHomeDisplayPath, normalizeAbsolutePath } from '../utils/askFlowerPath';
import {
  TERMINAL_COMMAND_CATALOG,
  type TerminalCommandCatalogArgumentEntry,
  type TerminalCommandCatalogEntry,
  type TerminalCommandCatalogPathPreference,
} from './terminalMobileKeyboardCatalog';

export type TerminalMobileKeyboardDraftState = {
  line: string;
  desynced: boolean;
  historyIndex: number | null;
};

export type TerminalMobileKeyboardPathEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export type TerminalMobileKeyboardScript = {
  name: string;
  command: string;
};

export type TerminalMobileKeyboardSuggestionKind =
  | 'history'
  | 'command'
  | 'subcommand'
  | 'option'
  | 'script'
  | 'path'
  | 'snippet';

export type TerminalMobileKeyboardSuggestion = MobileKeyboardSuggestionItem & {
  insertText: string;
  kind: TerminalMobileKeyboardSuggestionKind;
};

export type TerminalMobileKeyboardContext = {
  line: string;
  command: string;
  firstArgument: string;
  tokens: string[];
  currentToken: string;
  trailingSpace: boolean;
  pathQuery: TerminalMobileKeyboardPathQuery | null;
};

export type TerminalMobileKeyboardPathQuery = {
  baseDirAbs: string;
  rawToken: string;
  displayDirPrefix: string;
  prefix: string;
  showHidden: boolean;
  preference: TerminalCommandCatalogPathPreference | null;
};

type TerminalSnippetEntry = {
  id: string;
  label: string;
  detail: string;
};

type TerminalCatalogTraversalState = {
  scope: string[];
  entries: readonly TerminalCommandCatalogArgumentEntry[];
  activeEntry: TerminalCommandCatalogEntry | TerminalCommandCatalogArgumentEntry;
  pendingValueOption: TerminalCommandCatalogArgumentEntry | null;
};

const MAX_HISTORY_ITEMS = 24;
const MAX_SUGGESTIONS = 12;
const FEATURED_COMMAND_SUGGESTION_LIMIT = 8;

const SNIPPETS: TerminalSnippetEntry[] = [
  { id: 'snippet-git-status', label: 'git status', detail: 'Inspect current workspace changes' },
  { id: 'snippet-git-diff', label: 'git diff --stat', detail: 'Summarize the current diff' },
  { id: 'snippet-ls', label: 'ls -la', detail: 'List all files with details' },
  { id: 'snippet-cd-up', label: 'cd ..', detail: 'Move to the parent directory' },
  { id: 'snippet-pnpm-test', label: 'pnpm test', detail: 'Run project tests' },
  { id: 'snippet-go-test', label: 'go test ./...', detail: 'Run all Go tests' },
];

export const TERMINAL_MOBILE_KEYBOARD_QUICK_INSERTS = ['./', '../', '~/', '/', '&&', '||', '*'] as const;

export function createEmptyTerminalMobileKeyboardDraftState(): TerminalMobileKeyboardDraftState {
  return {
    line: '',
    desynced: false,
    historyIndex: null,
  };
}

export function rememberTerminalMobileKeyboardHistory(history: string[], command: string): string[] {
  const normalized = normalizeHistoryValue(command);
  if (!normalized) return history;

  const next = [normalized, ...history.filter((item) => normalizeHistoryValue(item) !== normalized)];
  return next.slice(0, MAX_HISTORY_ITEMS);
}

export function applyTerminalMobileKeyboardPayload(params: {
  state: TerminalMobileKeyboardDraftState;
  payload: string;
  history: string[];
}): {
  nextState: TerminalMobileKeyboardDraftState;
  committedCommand: string | null;
} {
  const payload = String(params.payload ?? '');
  const state = params.state;
  const history = params.history;

  if (!payload) {
    return { nextState: state, committedCommand: null };
  }

  if (payload === '\r') {
    const committedCommand = normalizeHistoryValue(state.line);
    return {
      nextState: createEmptyTerminalMobileKeyboardDraftState(),
      committedCommand,
    };
  }

  if (payload === '\x7f') {
    if (!state.line && !state.desynced) {
      return { nextState: state, committedCommand: null };
    }

    return {
      nextState: {
        line: state.desynced ? '' : state.line.slice(0, -1),
        desynced: false,
        historyIndex: null,
      },
      committedCommand: null,
    };
  }

  if (payload === '\x1B') {
    return {
      nextState: createEmptyTerminalMobileKeyboardDraftState(),
      committedCommand: null,
    };
  }

  if (payload === '\x1B[A') {
    if (history.length <= 0) {
      return { nextState: state, committedCommand: null };
    }

    const nextIndex = state.historyIndex === null
      ? 0
      : Math.min(state.historyIndex + 1, history.length - 1);

    return {
      nextState: {
        line: history[nextIndex] ?? '',
        desynced: false,
        historyIndex: nextIndex,
      },
      committedCommand: null,
    };
  }

  if (payload === '\x1B[B') {
    if (state.historyIndex === null) {
      return { nextState: state, committedCommand: null };
    }

    if (state.historyIndex <= 0) {
      return {
        nextState: createEmptyTerminalMobileKeyboardDraftState(),
        committedCommand: null,
      };
    }

    const nextIndex = state.historyIndex - 1;
    return {
      nextState: {
        line: history[nextIndex] ?? '',
        desynced: false,
        historyIndex: nextIndex,
      },
      committedCommand: null,
    };
  }

  if (payload === '\t') {
    return {
      nextState: {
        line: state.line,
        desynced: state.desynced,
        historyIndex: null,
      },
      committedCommand: null,
    };
  }

  if (isPrintablePayload(payload)) {
    return {
      nextState: {
        line: state.desynced ? payload : `${state.line}${payload}`,
        desynced: false,
        historyIndex: null,
      },
      committedCommand: null,
    };
  }

  return {
    nextState: {
      line: '',
      desynced: true,
      historyIndex: null,
    },
    committedCommand: null,
  };
}

export function deriveTerminalMobileKeyboardContext(params: {
  state: TerminalMobileKeyboardDraftState;
  workingDirAbs: string;
  agentHomePathAbs?: string | null;
}): TerminalMobileKeyboardContext {
  const line = params.state.desynced ? '' : params.state.line;
  const trimmed = line.trimStart();
  const trailingSpace = /\s$/.test(line);
  const tokens = trimmed ? trimmed.split(/\s+/).filter(Boolean) : [];
  const command = tokens[0] ?? '';
  const firstArgument = tokens[1] ?? '';
  const currentToken = trailingSpace ? '' : (tokens[tokens.length - 1] ?? '');

  return {
    line,
    command,
    firstArgument,
    tokens,
    currentToken,
    trailingSpace,
    pathQuery: resolveTerminalMobileKeyboardPathQuery({
      workingDirAbs: params.workingDirAbs,
      agentHomePathAbs: params.agentHomePathAbs,
      command,
      tokens,
      currentToken,
      trailingSpace,
    }),
  };
}

export function buildTerminalMobileKeyboardSuggestions(params: {
  context: TerminalMobileKeyboardContext;
  history: string[];
  pathEntries: TerminalMobileKeyboardPathEntry[];
  packageScripts: TerminalMobileKeyboardScript[];
}): TerminalMobileKeyboardSuggestion[] {
  const suggestions: TerminalMobileKeyboardSuggestion[] = [];
  const seen = new Set<string>();
  const linePrefix = params.context.line.toLowerCase();
  const commandPrefix = params.context.currentToken.toLowerCase();

  const push = (suggestion: TerminalMobileKeyboardSuggestion | null) => {
    if (!suggestion) return;
    const key = `${suggestion.kind}:${suggestion.label}`;
    if (seen.has(key)) return;
    seen.add(key);
    suggestions.push(suggestion);
  };

  if (params.context.pathQuery) {
    for (const entry of buildPathSuggestions(params.context.pathQuery, params.pathEntries)) {
      push(entry);
      if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
    }
  }

  for (const entry of buildScriptSuggestions(params.context, params.packageScripts)) {
    push(entry);
    if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
  }

  for (const entry of buildCatalogSuggestions(params.context, commandPrefix)) {
    push(entry);
    if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
  }

  for (const item of params.history) {
    const normalized = normalizeHistoryValue(item);
    if (!normalized) continue;
    if (linePrefix && !normalized.toLowerCase().startsWith(linePrefix)) continue;
    push({
      id: `history:${normalized}`,
      label: normalized,
      detail: 'Recent terminal command',
      kind: 'history',
      insertText: params.context.line ? normalized.slice(params.context.line.length) : normalized,
    });
    if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
  }

  for (const snippet of SNIPPETS) {
    if (linePrefix && !snippet.label.toLowerCase().startsWith(linePrefix)) continue;
    push({
      id: snippet.id,
      label: snippet.label,
      detail: snippet.detail,
      kind: 'snippet',
      insertText: params.context.line ? snippet.label.slice(params.context.line.length) : `${snippet.label} `,
    });
    if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
  }

  return suggestions;
}

function buildCatalogSuggestions(
  context: TerminalMobileKeyboardContext,
  commandPrefix: string,
): TerminalMobileKeyboardSuggestion[] {
  if (context.tokens.length <= 1 && !context.trailingSpace) {
    const catalog = commandPrefix
      ? TERMINAL_COMMAND_CATALOG
      : TERMINAL_COMMAND_CATALOG.filter((entry) => entry.featured).slice(0, FEATURED_COMMAND_SUGGESTION_LIMIT);

    return catalog
      .filter((entry) => !commandPrefix || entry.command.toLowerCase().startsWith(commandPrefix))
      .map((entry) => ({
        id: `command:${entry.command}`,
        label: entry.command,
        detail: entry.detail,
        kind: 'command' as const,
        insertText: entry.command.slice(context.currentToken.length) + ' ',
      }));
  }

  const matchedCommand = TERMINAL_COMMAND_CATALOG.find((entry) => entry.command === context.command);
  if (!matchedCommand) {
    return [];
  }

  const traversal = resolveCatalogTraversalState(matchedCommand, {
    tokens: context.tokens,
    trailingSpace: context.trailingSpace,
  });
  if (!traversal || traversal.pendingValueOption) {
    return [];
  }

  const prefix = context.currentToken.toLowerCase();
  const scopedCandidates = prefix
    ? traversal.entries
    : traversal.entries.filter((entry) => entry.featured ?? true);

  return sortCatalogArgumentEntries(scopedCandidates, prefix)
    .filter((entry) => !prefix || entry.name.toLowerCase().startsWith(prefix))
    .map((entry) => {
      const kind = entry.kind ?? 'subcommand';
      return {
        id: `${kind}:${matchedCommand.command}:${traversal.scope.join(':')}:${entry.name}`,
        label: entry.name,
        detail: formatCatalogSuggestionDetail(entry),
        kind,
        insertText: entry.name.slice(context.currentToken.length) + ' ',
      };
    });
}

function resolveCatalogTraversalState(
  commandEntry: TerminalCommandCatalogEntry,
  params: {
    tokens: string[];
    trailingSpace: boolean;
  },
): TerminalCatalogTraversalState | null {
  const argumentTokens = params.tokens.slice(1);
  const consumedTokens = params.trailingSpace ? argumentTokens : argumentTokens.slice(0, -1);

  let entries = commandEntry.subcommands ?? [];
  const scope: string[] = [];
  let activeEntry: TerminalCommandCatalogEntry | TerminalCommandCatalogArgumentEntry = commandEntry;
  let pendingValueOption: TerminalCommandCatalogArgumentEntry | null = null;

  for (const token of consumedTokens) {
    if (pendingValueOption) {
      pendingValueOption = null;
      continue;
    }

    const optionMatch = entries.find((entry) => isCatalogOptionEntry(entry) && entry.name === token);
    if (optionMatch) {
      if (optionMatch.takesValue) {
        pendingValueOption = optionMatch;
      }
      continue;
    }

    const subcommandMatch = entries.find((entry) => !isCatalogOptionEntry(entry) && entry.name === token);
    if (!subcommandMatch) {
      return null;
    }

    scope.push(subcommandMatch.name);
    activeEntry = subcommandMatch;
    entries = subcommandMatch.subcommands ?? [];
  }

  return {
    scope,
    entries,
    activeEntry,
    pendingValueOption,
  };
}

function isCatalogOptionEntry(entry: TerminalCommandCatalogArgumentEntry): boolean {
  return entry.kind === 'option';
}

function sortCatalogArgumentEntries(
  entries: readonly TerminalCommandCatalogArgumentEntry[],
  prefix: string,
): TerminalCommandCatalogArgumentEntry[] {
  const optionPrefix = prefix.startsWith('-');
  const hasPrefix = prefix.length > 0;

  return [...entries].sort((left, right) => {
    const leftIsOption = isCatalogOptionEntry(left);
    const rightIsOption = isCatalogOptionEntry(right);

    if (leftIsOption !== rightIsOption) {
      if (optionPrefix) return leftIsOption ? -1 : 1;
      if (hasPrefix) return leftIsOption ? 1 : -1;
      return leftIsOption ? 1 : -1;
    }

    const leftFeatured = left.featured ? 1 : 0;
    const rightFeatured = right.featured ? 1 : 0;
    if (leftFeatured !== rightFeatured) {
      return rightFeatured - leftFeatured;
    }

    if (left.name.length !== right.name.length) {
      return left.name.length - right.name.length;
    }

    return left.name.localeCompare(right.name);
  });
}

function formatCatalogSuggestionDetail(entry: TerminalCommandCatalogArgumentEntry): string {
  if (!entry.valueHint) return entry.detail;
  return `${entry.detail} (${entry.valueHint})`;
}

function buildScriptSuggestions(
  context: TerminalMobileKeyboardContext,
  scripts: TerminalMobileKeyboardScript[],
): TerminalMobileKeyboardSuggestion[] {
  if (scripts.length <= 0) return [];

  const suggestions: TerminalMobileKeyboardSuggestion[] = [];

  const push = (script: TerminalMobileKeyboardScript, label: string, insertText: string) => {
    suggestions.push({
      id: `script:${label}`,
      label,
      detail: script.command,
      kind: 'script',
      insertText,
    });
  };

  const scriptRunner = resolveScriptRunnerContext(context);
  if (scriptRunner) {
    const prefix = scriptRunner.currentScriptToken.toLowerCase();
    for (const script of scripts) {
      if (prefix && !script.name.toLowerCase().startsWith(prefix)) continue;
      push(script, script.name, script.name.slice(scriptRunner.currentScriptToken.length) + ' ');
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }
    return suggestions;
  }

  if (context.line) return suggestions;

  for (const script of scripts) {
    push(script, `pnpm ${script.name}`, `pnpm ${script.name}`);
    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }

  return suggestions;
}

function buildPathSuggestions(
  pathQuery: TerminalMobileKeyboardPathQuery,
  entries: TerminalMobileKeyboardPathEntry[],
): TerminalMobileKeyboardSuggestion[] {
  if (entries.length <= 0) return [];

  const sorted = [...entries]
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) {
        if (pathQuery.preference === 'files') {
          return left.isDirectory ? 1 : -1;
        }
        return left.isDirectory ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  const prefixLower = pathQuery.prefix.toLowerCase();
  const suggestions: TerminalMobileKeyboardSuggestion[] = [];

  for (const entry of sorted) {
    if (prefixLower && !entry.name.toLowerCase().startsWith(prefixLower)) continue;

    const displayValue = `${pathQuery.displayDirPrefix}${entry.name}${entry.isDirectory ? '/' : ''}`;
    const insertText = displayValue.startsWith(pathQuery.rawToken)
      ? displayValue.slice(pathQuery.rawToken.length)
      : `${entry.name}${entry.isDirectory ? '/' : ' '}`;

    suggestions.push({
      id: `path:${entry.path}`,
      label: displayValue,
      detail: entry.path,
      kind: 'path',
      insertText: entry.isDirectory ? insertText : insertText.endsWith(' ') ? insertText : `${insertText} `,
    });

    if (suggestions.length >= MAX_SUGGESTIONS) break;
  }

  return suggestions;
}

function resolveScriptRunnerContext(context: TerminalMobileKeyboardContext): {
  currentScriptToken: string;
} | null {
  const command = context.command;
  if (command === 'pnpm' || command === 'yarn') {
    if (context.tokens.length <= 1) {
      return { currentScriptToken: context.trailingSpace ? '' : context.currentToken };
    }
    if (context.tokens.length === 2) {
      return { currentScriptToken: context.currentToken };
    }
  }

  if (command === 'bun') {
    if (context.tokens[1] === 'run') {
      return { currentScriptToken: context.trailingSpace ? '' : context.currentToken };
    }
    if (context.tokens.length <= 1) {
      return { currentScriptToken: context.trailingSpace ? '' : context.currentToken };
    }
  }

  if (command === 'npm' && context.tokens[1] === 'run') {
    return { currentScriptToken: context.trailingSpace ? '' : context.currentToken };
  }

  return null;
}

function resolveTerminalMobileKeyboardPathQuery(params: {
  workingDirAbs: string;
  agentHomePathAbs?: string | null;
  command: string;
  tokens: string[];
  currentToken: string;
  trailingSpace: boolean;
}): TerminalMobileKeyboardPathQuery | null {
  const workingDirAbs = normalizeAbsolutePath(params.workingDirAbs);
  if (!workingDirAbs) return null;

  let rawToken = params.currentToken;
  const matchedCommand = TERMINAL_COMMAND_CATALOG.find((entry) => entry.command === params.command);
  const traversal = matchedCommand
    ? resolveCatalogTraversalState(matchedCommand, {
      tokens: params.tokens,
      trailingSpace: params.trailingSpace,
    })
    : null;
  const completingCommandToken = !params.trailingSpace
    && params.tokens.length <= 1
    && params.currentToken === params.command;
  const traversalExpectsPath = resolveCatalogPathExpectation(traversal, completingCommandToken);
  const expectsPath = traversalExpectsPath || looksLikePathToken(rawToken);

  if (!expectsPath) return null;

  if (params.trailingSpace) {
    rawToken = '';
  }

  const showHidden = rawToken === '.'
    || rawToken.startsWith('./.')
    || rawToken.startsWith('../.')
    || rawToken.startsWith('~/.')
    || rawToken.startsWith('/.')
    || rawToken.startsWith('.');

  if (!rawToken) {
    return {
      baseDirAbs: workingDirAbs,
      rawToken: '',
      displayDirPrefix: '',
      prefix: '',
      showHidden,
      preference: resolveCatalogPathPreference(traversal),
    };
  }

  if (rawToken.startsWith('/')) {
    const slashIndex = rawToken.lastIndexOf('/');
    const displayDirPrefix = slashIndex >= 0 ? rawToken.slice(0, slashIndex + 1) : '/';
    const prefix = slashIndex >= 0 ? rawToken.slice(slashIndex + 1) : rawToken.slice(1);
    return {
      baseDirAbs: resolveAbsolutePath('/', displayDirPrefix || '/'),
      rawToken,
      displayDirPrefix: displayDirPrefix || '/',
      prefix,
      showHidden,
      preference: resolveCatalogPathPreference(traversal),
    };
  }

  if (rawToken.startsWith('~/')) {
    const agentHomePathAbs = normalizeAbsolutePath(params.agentHomePathAbs ?? '');
    if (!agentHomePathAbs) return null;
    const rawSuffix = rawToken.slice(2);
    const slashIndex = rawSuffix.lastIndexOf('/');
    const displayDirPrefix = slashIndex >= 0 ? `~/${rawSuffix.slice(0, slashIndex + 1)}` : '~/';
    const prefix = slashIndex >= 0 ? rawSuffix.slice(slashIndex + 1) : rawSuffix;
    return {
      baseDirAbs: resolveAbsolutePath(agentHomePathAbs, slashIndex >= 0 ? rawSuffix.slice(0, slashIndex + 1) : ''),
      rawToken,
      displayDirPrefix,
      prefix,
      showHidden,
      preference: resolveCatalogPathPreference(traversal),
    };
  }

  if (rawToken.includes('/')) {
    const slashIndex = rawToken.lastIndexOf('/');
    const displayDirPrefix = rawToken.slice(0, slashIndex + 1);
    const prefix = rawToken.slice(slashIndex + 1);
    return {
      baseDirAbs: resolveAbsolutePath(workingDirAbs, displayDirPrefix),
      rawToken,
      displayDirPrefix,
      prefix,
      showHidden,
      preference: resolveCatalogPathPreference(traversal),
    };
  }

  return {
    baseDirAbs: workingDirAbs,
    rawToken,
    displayDirPrefix: '',
    prefix: rawToken,
    showHidden,
    preference: resolveCatalogPathPreference(traversal),
  };
}

function resolveCatalogPathExpectation(
  traversal: TerminalCatalogTraversalState | null,
  completingCommandToken: boolean,
): boolean {
  if (!traversal) return false;
  if (traversal.pendingValueOption) {
    return Boolean(traversal.pendingValueOption.pathContext);
  }
  if (completingCommandToken) {
    return false;
  }
  return Boolean(traversal.activeEntry.pathContext);
}

function resolveCatalogPathPreference(
  traversal: TerminalCatalogTraversalState | null,
): TerminalCommandCatalogPathPreference | null {
  if (!traversal) return null;
  if (traversal.pendingValueOption?.pathPreference) {
    return traversal.pendingValueOption.pathPreference;
  }
  return traversal.activeEntry.pathPreference ?? null;
}

export function resolveTerminalMobileKeyboardPathBase(params: {
  context: TerminalMobileKeyboardContext;
}): TerminalMobileKeyboardPathQuery | null {
  return params.context.pathQuery;
}

export function parseTerminalMobileKeyboardScripts(content: string): TerminalMobileKeyboardScript[] {
  const raw = String(content ?? '').trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    const scripts = parsed?.scripts;
    if (!scripts || typeof scripts !== 'object') return [];

    return Object.entries(scripts)
      .map(([name, command]) => ({
        name: String(name ?? '').trim(),
        command: String(command ?? '').trim(),
      }))
      .filter((item) => item.name && item.command)
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

export function resolveTerminalMobileKeyboardPackageJsonPath(workingDirAbs: string): string {
  const workingDir = normalizeAbsolutePath(workingDirAbs);
  return workingDir ? resolveAbsolutePath(workingDir, 'package.json') : '';
}

function normalizeHistoryValue(value: string): string {
  return String(value ?? '').trim();
}

function isPrintablePayload(payload: string): boolean {
  for (let i = 0; i < payload.length; i += 1) {
    const code = payload.charCodeAt(i);
    if (code < 32 || code === 127) return false;
  }
  return true;
}

function looksLikePathToken(token: string): boolean {
  return token.startsWith('/')
    || token.startsWith('./')
    || token.startsWith('../')
    || token.startsWith('~/')
    || token.startsWith('.')
    || token.includes('/');
}

function resolveAbsolutePath(baseAbs: string, rawPath: string): string {
  const normalizedBase = normalizeAbsolutePath(baseAbs) || '/';
  const raw = String(rawPath ?? '').trim().replace(/\\+/g, '/');
  if (!raw) return normalizedBase;

  const stack = raw.startsWith('/')
    ? []
    : (normalizedBase === '/' ? [] : normalizedBase.slice(1).split('/').filter(Boolean));

  for (const segment of raw.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }

  const resolved = `/${stack.join('/')}`;
  return normalizeAbsolutePath(resolved) || '/';
}

export function expandTerminalMobileKeyboardPathToken(rawToken: string, workingDirAbs: string, agentHomePathAbs?: string | null): string {
  const token = String(rawToken ?? '').trim();
  if (!token) return normalizeAbsolutePath(workingDirAbs);
  if (token.startsWith('~/')) return expandHomeDisplayPath(token, agentHomePathAbs);
  if (token.startsWith('/')) return normalizeAbsolutePath(token);
  return resolveAbsolutePath(workingDirAbs, token);
}
