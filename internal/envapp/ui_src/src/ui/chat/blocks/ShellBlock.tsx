// ShellBlock — terminal-style command display with collapsible output and status indicators.

import { For, Show, createMemo, createSignal } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface ShellBlockProps {
  command: string;
  output?: string;
  exitCode?: number;
  status: 'running' | 'success' | 'error';
  class?: string;
}

type ShellTokenKind =
  | 'space'
  | 'text'
  | 'command'
  | 'flag'
  | 'string'
  | 'variable'
  | 'operator'
  | 'path'
  | 'number'
  | 'env'
  | 'substitution';

interface ShellToken {
  readonly kind: ShellTokenKind;
  readonly text: string;
}

interface RawToken {
  readonly kind: 'space' | 'word' | 'string' | 'substitution' | 'operator';
  readonly text: string;
}

const MULTI_CHAR_OPERATORS = ['&&', '||', '>>', '<<', '>|', '|&', '2>', '1>', '&>'] as const;
const SINGLE_CHAR_OPERATORS = new Set(['|', ';', '>', '<', '(', ')']);

function isShellWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function isOperatorStart(input: string, index: number): boolean {
  for (const op of MULTI_CHAR_OPERATORS) {
    if (input.startsWith(op, index)) {
      return true;
    }
  }
  return SINGLE_CHAR_OPERATORS.has(input[index] ?? '');
}

function readOperator(input: string, index: number): string | null {
  for (const op of MULTI_CHAR_OPERATORS) {
    if (input.startsWith(op, index)) {
      return op;
    }
  }
  const char = input[index] ?? '';
  if (SINGLE_CHAR_OPERATORS.has(char)) {
    return char;
  }
  return null;
}

function readQuoted(input: string, start: number, quote: '"' | "'"): string {
  let cursor = start + 1;
  while (cursor < input.length) {
    const char = input[cursor];
    if (char === '\\' && quote === '"' && cursor + 1 < input.length) {
      cursor += 2;
      continue;
    }
    if (char === quote) {
      return input.slice(start, cursor + 1);
    }
    cursor += 1;
  }
  return input.slice(start);
}

function readSubstitution(input: string, start: number): string {
  let cursor = start + 2;
  let depth = 1;
  while (cursor < input.length && depth > 0) {
    const char = input[cursor];
    const next = input[cursor + 1];
    if (char === '$' && next === '(') {
      depth += 1;
      cursor += 2;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      cursor += 1;
      continue;
    }
    cursor += 1;
  }
  return input.slice(start, cursor);
}

function tokenizeRaw(command: string): RawToken[] {
  const tokens: RawToken[] = [];
  let cursor = 0;

  while (cursor < command.length) {
    const char = command[cursor] ?? '';

    if (isShellWhitespace(char)) {
      let end = cursor + 1;
      while (end < command.length && isShellWhitespace(command[end] ?? '')) {
        end += 1;
      }
      tokens.push({ kind: 'space', text: command.slice(cursor, end) });
      cursor = end;
      continue;
    }

    if (char === '"' || char === "'") {
      const quoted = readQuoted(command, cursor, char);
      tokens.push({ kind: 'string', text: quoted });
      cursor += quoted.length;
      continue;
    }

    if (char === '$' && command[cursor + 1] === '(') {
      const substitution = readSubstitution(command, cursor);
      tokens.push({ kind: 'substitution', text: substitution });
      cursor += substitution.length;
      continue;
    }

    const operator = readOperator(command, cursor);
    if (operator) {
      tokens.push({ kind: 'operator', text: operator });
      cursor += operator.length;
      continue;
    }

    let end = cursor + 1;
    while (end < command.length) {
      const next = command[end] ?? '';
      if (isShellWhitespace(next) || next === '"' || next === "'" || isOperatorStart(command, end)) {
        break;
      }
      if (next === '$' && command[end + 1] === '(') {
        break;
      }
      end += 1;
    }

    tokens.push({ kind: 'word', text: command.slice(cursor, end) });
    cursor = end;
  }

  return tokens;
}

function classifyWord(word: string, expectingCommand: boolean): ShellTokenKind {
  const isVariable = word.startsWith('$') || word.includes('${');
  const isFlag = /^-{1,2}[A-Za-z0-9]/.test(word);
  const isEnvAssignment = /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
  const isPathLike =
    word.includes('/') ||
    word.startsWith('./') ||
    word.startsWith('../') ||
    word.startsWith('~/');
  const isNumber = /^-?\d+(\.\d+)?$/.test(word);

  if (expectingCommand) {
    if (isEnvAssignment) return 'env';
    if (isVariable) return 'variable';
    return 'command';
  }

  if (isFlag) return 'flag';
  if (isVariable) return 'variable';
  if (isEnvAssignment) return 'env';
  if (isPathLike) return 'path';
  if (isNumber) return 'number';
  return 'text';
}

function tokenizeShellCommand(command: string): ShellToken[] {
  const rawTokens = tokenizeRaw(command);
  const tokens: ShellToken[] = [];
  let expectingCommand = true;

  rawTokens.forEach((token) => {
    if (token.kind === 'space') {
      tokens.push({ kind: 'space', text: token.text });
      return;
    }
    if (token.kind === 'operator') {
      tokens.push({ kind: 'operator', text: token.text });
      expectingCommand = true;
      return;
    }
    if (token.kind === 'string') {
      tokens.push({ kind: 'string', text: token.text });
      expectingCommand = false;
      return;
    }
    if (token.kind === 'substitution') {
      tokens.push({ kind: 'substitution', text: token.text });
      expectingCommand = false;
      return;
    }

    const wordKind = classifyWord(token.text, expectingCommand);
    tokens.push({ kind: wordKind, text: token.text });
    expectingCommand = wordKind === 'env';
  });

  return tokens;
}

function tokenClass(kind: ShellTokenKind): string {
  switch (kind) {
    case 'command':
      return 'chat-shell-token-command';
    case 'flag':
      return 'chat-shell-token-flag';
    case 'string':
      return 'chat-shell-token-string';
    case 'variable':
      return 'chat-shell-token-variable';
    case 'operator':
      return 'chat-shell-token-operator';
    case 'path':
      return 'chat-shell-token-path';
    case 'number':
      return 'chat-shell-token-number';
    case 'env':
      return 'chat-shell-token-env';
    case 'substitution':
      return 'chat-shell-token-substitution';
    default:
      return '';
  }
}

/**
 * Renders a terminal-style block showing a shell command, its output,
 * and exit code. Output is collapsed by default and can be toggled
 * by clicking the header.
 */
export const ShellBlock: Component<ShellBlockProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const commandTokens = createMemo(() => tokenizeShellCommand(props.command));

  const hasOutput = () => !!props.output;
  const canToggle = () => hasOutput() || props.status === 'running';

  const statusClass = () => {
    switch (props.status) {
      case 'running':
        return 'chat-shell-block-running';
      case 'error':
        return 'chat-shell-block-error';
      default:
        return 'chat-shell-block-success';
    }
  };

  const toggleLabel = () => (expanded() ? 'Hide output' : 'Show output');

  const handleHeaderClick = () => {
    if (!canToggle()) return;
    setExpanded((value) => !value);
  };

  return (
    <div class={cn('chat-shell-block', statusClass(), props.class)}>
      {/* Command header — clickable to toggle */}
      <button
        type="button"
        class={cn('chat-shell-command', canToggle() && 'chat-shell-command-toggle')}
        onClick={handleHeaderClick}
        aria-expanded={canToggle() ? expanded() : undefined}
        aria-label={canToggle() ? `${toggleLabel()} for command output` : undefined}
      >
        {/* Status icon */}
        <Show when={props.status === 'running'}>
          <span class="chat-shell-status-icon chat-shell-status-running" aria-label="Running">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              class="chat-shell-spinner"
            >
              <circle class="chat-shell-spinner-track" cx="12" cy="12" r="9" />
              <path class="chat-shell-spinner-head" d="M21 12a9 9 0 0 0-9-9" />
            </svg>
          </span>
        </Show>
        <Show when={props.status === 'success'}>
          <span class="chat-shell-status-icon chat-shell-status-success" aria-label="Success">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        </Show>
        <Show when={props.status === 'error'}>
          <span class="chat-shell-status-icon chat-shell-status-error" aria-label="Error">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </span>
        </Show>

        <span class="chat-shell-prompt">$</span>
        <span class="chat-shell-command-text" title={props.command}>
          <span class="chat-shell-command-highlight">
            <For each={commandTokens()}>
              {(token) => <span class={tokenClass(token.kind)}>{token.text}</span>}
            </For>
          </span>
        </span>

        {/* Exit code / duration inline */}
        <Show when={props.status !== 'running' && props.exitCode !== undefined}>
          <span
            class={cn(
              'chat-shell-exit-inline',
              props.exitCode === 0 ? 'chat-shell-exit-inline-success' : 'chat-shell-exit-inline-error',
            )}
          >
            exit {props.exitCode}
          </span>
        </Show>

        {/* Toggle */}
        <Show when={canToggle()}>
          <span class="chat-shell-toggle-label">{toggleLabel()}</span>
          <span class={cn('chat-shell-toggle', expanded() && 'chat-shell-toggle-open')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </Show>
      </button>

      {/* Collapsible output area */}
      <Show when={canToggle()}>
        <div
          class={cn(
            'chat-shell-output-wrapper',
            expanded() ? 'chat-shell-output-wrapper-open' : 'chat-shell-output-wrapper-closed',
          )}
        >
          <div class="chat-shell-output-inner">
            <Show
              when={props.output}
              fallback={
                <Show when={props.status === 'running'}>
                  <div class="chat-shell-output chat-shell-output-muted">
                    <pre>Waiting for output...</pre>
                  </div>
                </Show>
              }
            >
              <div
                class={cn(
                  'chat-shell-output',
                  props.status === 'error' && 'chat-shell-output-error',
                )}
              >
                <pre>{props.output}</pre>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};
