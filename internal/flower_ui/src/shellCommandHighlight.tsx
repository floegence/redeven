import { For } from 'solid-js';
import type { JSX } from 'solid-js';

export type FlowerShellCommandTokenKind =
  | 'text'
  | 'command'
  | 'flag'
  | 'string'
  | 'url'
  | 'operator'
  | 'variable';

export type FlowerShellCommandToken = Readonly<{
  kind: FlowerShellCommandTokenKind;
  text: string;
}>;

const shellOperators = ['&&', '||', '2>&1', '1>&2', '>>', '<<', '>|', '|', ';', '&', '>', '<'];

function startsWithOperator(command: string, index: number): string {
  for (const op of shellOperators) {
    if (command.startsWith(op, index)) return op;
  }
  return '';
}

function readQuoted(command: string, index: number): number {
  const quote = command[index];
  let cursor = index + 1;
  while (cursor < command.length) {
    const char = command[cursor];
    if (char === '\\' && quote !== "'") {
      cursor += 2;
      continue;
    }
    cursor += 1;
    if (char === quote) break;
  }
  return cursor;
}

function readVariable(command: string, index: number): number {
  if (command[index + 1] === '{') {
    const end = command.indexOf('}', index + 2);
    return end >= 0 ? end + 1 : command.length;
  }
  if (command[index + 1] === '(') {
    let depth = 1;
    let cursor = index + 2;
    while (cursor < command.length && depth > 0) {
      const char = command[cursor];
      if (char === '\\') {
        cursor += 2;
        continue;
      }
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      cursor += 1;
    }
    return cursor;
  }
  let cursor = index + 1;
  while (cursor < command.length && /[A-Za-z0-9_?@$!#-]/.test(command[cursor] ?? '')) {
    cursor += 1;
  }
  return cursor > index + 1 ? cursor : index + 1;
}

function readWord(command: string, index: number): number {
  let cursor = index;
  while (cursor < command.length) {
    const char = command[cursor] ?? '';
    if (/\s/.test(char) || startsWithOperator(command, cursor)) break;
    if (char === '"' || char === "'" || char === '`' || char === '$') break;
    cursor += 1;
  }
  return cursor > index ? cursor : index + 1;
}

function isAssignmentWord(word: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

function wordKind(word: string, expectingCommand: boolean, readingAssignmentValue: boolean): FlowerShellCommandTokenKind {
  if (readingAssignmentValue) return 'text';
  if (/^https?:\/\/\S+/i.test(word)) return 'url';
  if (/^-{1,2}[\w-]/.test(word)) return 'flag';
  if (expectingCommand && !isAssignmentWord(word)) return 'command';
  return 'text';
}

export function tokenizeFlowerShellCommand(command: string): readonly FlowerShellCommandToken[] {
  const tokens: FlowerShellCommandToken[] = [];
  let cursor = 0;
  let expectingCommand = true;
  let readingAssignmentValue = false;
  while (cursor < command.length) {
    const char = command[cursor] ?? '';
    if (/\s/.test(char)) {
      const start = cursor;
      while (cursor < command.length && /\s/.test(command[cursor] ?? '')) cursor += 1;
      tokens.push({ kind: 'text', text: command.slice(start, cursor) });
      if (expectingCommand) readingAssignmentValue = false;
      continue;
    }
    const op = startsWithOperator(command, cursor);
    if (op) {
      tokens.push({ kind: 'operator', text: op });
      cursor += op.length;
      expectingCommand = op === '|' || op === '&&' || op === '||' || op === ';' || op === '&';
      readingAssignmentValue = false;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      const next = readQuoted(command, cursor);
      tokens.push({ kind: 'string', text: command.slice(cursor, next) });
      cursor = next;
      if (!readingAssignmentValue) expectingCommand = false;
      continue;
    }
    if (char === '$') {
      const next = readVariable(command, cursor);
      tokens.push({ kind: 'variable', text: command.slice(cursor, next) });
      cursor = next;
      if (!readingAssignmentValue) expectingCommand = false;
      continue;
    }
    const next = readWord(command, cursor);
    const word = command.slice(cursor, next);
    const kind = wordKind(word, expectingCommand, readingAssignmentValue);
    tokens.push({ kind, text: word });
    cursor = next;
    if (readingAssignmentValue) {
      continue;
    }
    if (expectingCommand && isAssignmentWord(word)) {
      readingAssignmentValue = true;
      continue;
    }
    if (kind !== 'text' || word.trim()) expectingCommand = false;
  }
  return tokens;
}

export function FlowerShellCommandHighlight(props: Readonly<{ command: string }>): JSX.Element {
  return (
    <code class="flower-approval-command-code">
      <For each={tokenizeFlowerShellCommand(props.command)}>
        {(token) => token.kind === 'text'
          ? token.text
          : <span class={`flower-approval-command-token flower-approval-command-token-${token.kind}`}>{token.text}</span>}
      </For>
    </code>
  );
}
