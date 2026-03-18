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

  it('suggests command completions for the first token', () => {
    const context = deriveTerminalMobileKeyboardContext({
      state: { line: 'gi', desynced: false, historyIndex: null },
      workingDirAbs: '/workspace',
    });

    const suggestions = buildTerminalMobileKeyboardSuggestions({
      context,
      history: [],
      pathEntries: [],
      packageScripts: [],
    });

    expect(suggestions.some((item) => item.kind === 'command' && item.label === 'git' && item.insertText === 't ')).toBe(true);
  });

  it('suggests subcommands and path completions in context', () => {
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
