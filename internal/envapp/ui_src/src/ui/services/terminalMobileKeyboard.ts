import type { MobileKeyboardSuggestionItem } from '@floegence/floe-webapp-core/ui';
import { expandHomeDisplayPath, normalizeAbsolutePath } from '../utils/askFlowerPath';

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
};

type TerminalCommandCatalogEntry = {
  command: string;
  detail: string;
  subcommands?: Array<{ name: string; detail: string }>;
};

type TerminalSnippetEntry = {
  id: string;
  label: string;
  detail: string;
};

const MAX_HISTORY_ITEMS = 24;
const MAX_SUGGESTIONS = 12;

const PATH_COMMAND_CONTEXTS = new Set([
  'cat',
  'cd',
  'cp',
  'git add',
  'git checkout',
  'git diff',
  'git restore',
  'less',
  'ls',
  'mkdir',
  'more',
  'mv',
  'nano',
  'open',
  'pwd',
  'rm',
  'rmdir',
  'tail',
  'touch',
  'tree',
  'vi',
  'vim',
]);

const COMMAND_CATALOG: TerminalCommandCatalogEntry[] = [
  { command: 'cd', detail: 'Change directory' },
  { command: 'ls', detail: 'List directory contents' },
  { command: 'pwd', detail: 'Print working directory' },
  { command: 'cat', detail: 'Print file contents' },
  { command: 'mkdir', detail: 'Create directories' },
  { command: 'touch', detail: 'Create files or update timestamps' },
  { command: 'cp', detail: 'Copy files or directories' },
  { command: 'mv', detail: 'Move or rename files or directories' },
  { command: 'rm', detail: 'Remove files or directories' },
  { command: 'grep', detail: 'Search text by pattern' },
  { command: 'find', detail: 'Find files and directories' },
  { command: 'rg', detail: 'Search recursively with ripgrep' },
  {
    command: 'git',
    detail: 'Distributed version control',
    subcommands: [
      { name: 'status', detail: 'Show tracked changes' },
      { name: 'diff', detail: 'Inspect current diff' },
      { name: 'add', detail: 'Stage file changes' },
      { name: 'restore', detail: 'Restore file contents' },
      { name: 'checkout', detail: 'Switch branches or paths' },
      { name: 'switch', detail: 'Switch branches' },
      { name: 'pull', detail: 'Fetch and merge remote changes' },
      { name: 'push', detail: 'Push local commits' },
      { name: 'commit', detail: 'Create a commit' },
      { name: 'branch', detail: 'Manage branches' },
      { name: 'log', detail: 'Show commit history' },
    ],
  },
  {
    command: 'pnpm',
    detail: 'Run project packages and scripts',
    subcommands: [
      { name: 'install', detail: 'Install dependencies' },
      { name: 'dev', detail: 'Run the default dev script' },
      { name: 'build', detail: 'Run the default build script' },
      { name: 'test', detail: 'Run the default test script' },
      { name: 'lint', detail: 'Run the default lint script' },
    ],
  },
  {
    command: 'npm',
    detail: 'Run project packages and scripts',
    subcommands: [
      { name: 'install', detail: 'Install dependencies' },
      { name: 'run', detail: 'Run a package script' },
      { name: 'test', detail: 'Run the test script' },
      { name: 'build', detail: 'Run the build script' },
    ],
  },
  {
    command: 'yarn',
    detail: 'Run project packages and scripts',
    subcommands: [
      { name: 'install', detail: 'Install dependencies' },
      { name: 'dev', detail: 'Run the default dev script' },
      { name: 'build', detail: 'Run the default build script' },
      { name: 'test', detail: 'Run the default test script' },
    ],
  },
  {
    command: 'bun',
    detail: 'Run packages and scripts with Bun',
    subcommands: [
      { name: 'install', detail: 'Install dependencies' },
      { name: 'run', detail: 'Run a script' },
      { name: 'test', detail: 'Run tests' },
    ],
  },
  {
    command: 'python3',
    detail: 'Run Python programs',
    subcommands: [
      { name: '-m', detail: 'Run a library module as a script' },
      { name: '-V', detail: 'Show Python version' },
    ],
  },
  {
    command: 'go',
    detail: 'Go toolchain',
    subcommands: [
      { name: 'test', detail: 'Run Go tests' },
      { name: 'build', detail: 'Build packages and binaries' },
      { name: 'run', detail: 'Run a main package' },
      { name: 'fmt', detail: 'Format packages' },
    ],
  },
  {
    command: 'docker',
    detail: 'Manage containers and images',
    subcommands: [
      { name: 'ps', detail: 'List containers' },
      { name: 'images', detail: 'List images' },
      { name: 'logs', detail: 'Show container logs' },
      { name: 'exec', detail: 'Run a command in a container' },
      { name: 'compose', detail: 'Use Docker Compose' },
    ],
  },
];

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
      firstArgument,
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

  if (params.context.tokens.length <= 1 && !params.context.trailingSpace) {
    for (const entry of COMMAND_CATALOG) {
      if (commandPrefix && !entry.command.startsWith(commandPrefix)) continue;
      push({
        id: `command:${entry.command}`,
        label: entry.command,
        detail: entry.detail,
        kind: 'command',
        insertText: entry.command.slice(params.context.currentToken.length) + ' ',
      });
      if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
    }
  } else {
    const matchedCommand = COMMAND_CATALOG.find((entry) => entry.command === params.context.command);
    const argumentPrefix = params.context.currentToken.toLowerCase();
    if (matchedCommand?.subcommands) {
      for (const subcommand of matchedCommand.subcommands) {
        if (argumentPrefix && !subcommand.name.startsWith(argumentPrefix)) continue;
        push({
          id: `subcommand:${matchedCommand.command}:${subcommand.name}`,
          label: subcommand.name,
          detail: subcommand.detail,
          kind: 'subcommand',
          insertText: subcommand.name.slice(params.context.currentToken.length) + ' ',
        });
        if (suggestions.length >= MAX_SUGGESTIONS) return suggestions;
      }
    }
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
  firstArgument: string;
  currentToken: string;
  trailingSpace: boolean;
}): TerminalMobileKeyboardPathQuery | null {
  const workingDirAbs = normalizeAbsolutePath(params.workingDirAbs);
  if (!workingDirAbs) return null;

  let rawToken = params.currentToken;
  const commandContext = params.command === 'git' && params.firstArgument
    ? `git ${params.firstArgument}`
    : params.command;

  const expectsPath = PATH_COMMAND_CONTEXTS.has(commandContext)
    || looksLikePathToken(rawToken)
    || (params.trailingSpace && PATH_COMMAND_CONTEXTS.has(commandContext));

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
    };
  }

  return {
    baseDirAbs: workingDirAbs,
    rawToken,
    displayDirPrefix: '',
    prefix: rawToken,
    showHidden,
  };
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
