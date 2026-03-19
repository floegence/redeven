import { describe, expect, it } from 'vitest';
import {
  applyTerminalMobileKeyboardPayload,
  buildTerminalMobileKeyboardSuggestions,
  createEmptyTerminalMobileKeyboardDraftState,
  deriveTerminalMobileKeyboardContext,
  parseTerminalMobileKeyboardScripts,
  rememberTerminalMobileKeyboardHistory,
} from './terminalMobileKeyboard';

describe('terminalMobileKeyboard', () => {
  it('records unique recent command history', () => {
    const history = rememberTerminalMobileKeyboardHistory(
      ['git status', 'pnpm test'],
      'git status',
    );

    expect(history).toEqual(['git status', 'pnpm test']);
  });

  it('updates the local draft for printable input, backspace, and enter', () => {
    const baseState = createEmptyTerminalMobileKeyboardDraftState();
    const typed = applyTerminalMobileKeyboardPayload({
      state: baseState,
      payload: 'git ',
      history: [],
    });

    expect(typed.nextState.line).toBe('git ');

    const afterBackspace = applyTerminalMobileKeyboardPayload({
      state: typed.nextState,
      payload: '\x7f',
      history: [],
    });
    expect(afterBackspace.nextState.line).toBe('git');

    const afterEnter = applyTerminalMobileKeyboardPayload({
      state: afterBackspace.nextState,
      payload: '\r',
      history: [],
    });
    expect(afterEnter.committedCommand).toBe('git');
    expect(afterEnter.nextState).toEqual(createEmptyTerminalMobileKeyboardDraftState());
  });

  it('navigates local draft history with arrow keys', () => {
    const state = createEmptyTerminalMobileKeyboardDraftState();
    const history = ['pnpm test', 'git status'];

    const up = applyTerminalMobileKeyboardPayload({
      state,
      payload: '\x1B[A',
      history,
    });
    expect(up.nextState.line).toBe('pnpm test');

    const down = applyTerminalMobileKeyboardPayload({
      state: up.nextState,
      payload: '\x1B[B',
      history,
    });
    expect(down.nextState.line).toBe('');
  });

  it('suggests richer command completions for the first token without leaking path suggestions', () => {
    const gitContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'gi', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });

    const gitSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: gitContext,
      history: [],
      pathEntries: [],
      packageScripts: [],
    });

    expect(gitSuggestions.some((item) => item.kind === 'command' && item.label === 'git' && item.insertText === 't ')).toBe(true);

    const unameContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'una', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });
    const unameSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: unameContext,
      history: [],
      pathEntries: [],
      packageScripts: [],
    });
    expect(unameSuggestions.some((item) => item.kind === 'command' && item.label === 'uname' && item.insertText === 'me ')).toBe(true);

    const vimContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'vi', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });
    const vimSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: vimContext,
      history: [],
      pathEntries: [
        { name: 'src', path: '/workspace/src', isDirectory: true },
      ],
      packageScripts: [],
    });
    expect(vimSuggestions.some((item) => item.kind === 'command' && item.label === 'vim' && item.insertText === 'm ')).toBe(true);
    expect(vimSuggestions.some((item) => item.kind === 'path')).toBe(false);
  });

  it('suggests subcommands, options, nested command contexts, and path completions in context', () => {
    const gitContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'git ch', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });

    const gitSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: gitContext,
      history: [],
      pathEntries: [],
      packageScripts: [],
    });

    expect(gitSuggestions.some((item) => item.kind === 'subcommand' && item.label === 'checkout')).toBe(true);

    const gitCommitOptionContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'git commit -', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });
    const gitCommitOptionSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: gitCommitOptionContext,
      history: [],
      pathEntries: [],
      packageScripts: [],
    });
    expect(gitCommitOptionSuggestions.some((item) => (
      item.kind === 'option'
      && item.label === '-m'
      && item.detail === 'Use the given commit message (<message>)'
    ))).toBe(true);

    const dockerComposeContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'docker compose -f docker-compose.yml d', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });
    const dockerComposeSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: dockerComposeContext,
      history: [],
      pathEntries: [],
      packageScripts: [],
    });
    expect(dockerComposeSuggestions.some((item) => item.kind === 'subcommand' && item.label === 'down' && item.insertText === 'own ')).toBe(true);

    const dockerComposePathContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'docker compose -f do', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });
    const dockerComposePathSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: dockerComposePathContext,
      history: [],
      pathEntries: [
        { name: 'docker-compose.yml', path: '/workspace/docker-compose.yml', isDirectory: false },
        { name: 'docs', path: '/workspace/docs', isDirectory: true },
      ],
      packageScripts: [],
    });
    expect(dockerComposePathSuggestions.some((item) => (
      item.kind === 'path'
      && item.label === 'docker-compose.yml'
      && item.insertText === 'cker-compose.yml '
    ))).toBe(true);

    const kubectlNamespaceContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'kubectl -n kube-system g', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });
    const kubectlNamespaceSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: kubectlNamespaceContext,
      history: [],
      pathEntries: [],
      packageScripts: [],
    });
    expect(kubectlNamespaceSuggestions.some((item) => item.kind === 'subcommand' && item.label === 'get')).toBe(true);

    const unameOptionContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'uname -', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });
    const unameOptionSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: unameOptionContext,
      history: [],
      pathEntries: [],
      packageScripts: [],
    });
    expect(unameOptionSuggestions.some((item) => item.kind === 'option' && item.label === '-a' && item.insertText === 'a ')).toBe(true);

    const cdContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'cd sr', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });

    const pathSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: cdContext,
      history: [],
      pathEntries: [
        { name: 'src', path: '/workspace/src', isDirectory: true },
        { name: 'README.md', path: '/workspace/README.md', isDirectory: false },
      ],
      packageScripts: [],
    });

    expect(pathSuggestions.some((item) => item.kind === 'path' && item.label === 'src/' && item.insertText === 'c/')).toBe(true);

    const gitAddPathContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'git add -p RE', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });
    const gitAddPathSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: gitAddPathContext,
      history: [],
      pathEntries: [
        { name: 'README.md', path: '/workspace/README.md', isDirectory: false },
        { name: 'src', path: '/workspace/src', isDirectory: true },
      ],
      packageScripts: [],
    });
    expect(gitAddPathSuggestions.some((item) => item.kind === 'path' && item.label === 'README.md')).toBe(true);

    const vimPathContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'vim RE', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });
    const vimPathSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: vimPathContext,
      history: [],
      pathEntries: [
        { name: 'README.md', path: '/workspace/README.md', isDirectory: false },
        { name: 'src', path: '/workspace/src', isDirectory: true },
      ],
      packageScripts: [],
    });

    expect(vimPathSuggestions.some((item) => item.kind === 'path' && item.label === 'README.md' && item.insertText === 'ADME.md ')).toBe(true);

    const vimEmptyPathContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'vim ', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });
    const vimEmptyPathSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: vimEmptyPathContext,
      history: [],
      pathEntries: [
        { name: 'src', path: '/workspace/src', isDirectory: true },
        { name: 'README.md', path: '/workspace/README.md', isDirectory: false },
      ],
      packageScripts: [],
    });
    expect(vimEmptyPathSuggestions[0]?.label).toBe('README.md');

    const cdEmptyPathContext = deriveTerminalMobileKeyboardContext({
      state: { line: 'cd ', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });
    const cdEmptyPathSuggestions = buildTerminalMobileKeyboardSuggestions({
      context: cdEmptyPathContext,
      history: [],
      pathEntries: [
        { name: 'README.md', path: '/workspace/README.md', isDirectory: false },
        { name: 'src', path: '/workspace/src', isDirectory: true },
      ],
      packageScripts: [],
    });
    expect(cdEmptyPathSuggestions[0]?.label).toBe('src/');
  });

  it('suggests package scripts for common script runners', () => {
    const context = deriveTerminalMobileKeyboardContext({
      state: { line: 'pnpm d', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });

    const suggestions = buildTerminalMobileKeyboardSuggestions({
      context,
      history: [],
      pathEntries: [],
      packageScripts: [
        { name: 'dev', command: 'vite' },
        { name: 'test', command: 'vitest run' },
      ],
    });

    expect(suggestions.some((item) => item.kind === 'script' && item.label === 'dev' && item.insertText === 'ev ')).toBe(true);
  });

  it('parses package.json scripts safely', () => {
    expect(parseTerminalMobileKeyboardScripts(JSON.stringify({
      scripts: {
        dev: 'vite',
        test: 'vitest run',
      },
    }))).toEqual([
      { name: 'dev', command: 'vite' },
      { name: 'test', command: 'vitest run' },
    ]);

    expect(parseTerminalMobileKeyboardScripts('{')).toEqual([]);
  });
});
