// ShellBlock — terminal-style command display with collapsible output and status indicators.

import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';

export interface ShellBlockProps {
  command: string;
  output?: string;
  outputRef?: {
    runId: string;
    toolId: string;
  };
  cwd?: string;
  timeoutMs?: number;
  durationMs?: number;
  timedOut?: boolean;
  truncated?: boolean;
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

interface TerminalToolOutputPayload {
  run_id?: string;
  tool_id?: string;
  status?: string;
  stdout?: string;
  stderr?: string;
  exit_code?: number;
  duration_ms?: number;
  timed_out?: boolean;
  truncated?: boolean;
  cwd?: string;
  timeout_ms?: number;
  raw_result?: string;
}

const MULTI_CHAR_OPERATORS = ['&&', '||', '>>', '<<', '>|', '|&', '2>', '1>', '&>'] as const;
const SINGLE_CHAR_OPERATORS = new Set(['|', ';', '>', '<', '(', ')']);
const TERMINAL_STATUS_POLL_INTERVAL_MS = 1200;

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

function composeDeferredOutput(parts: {
  stdout: string;
  stderr: string;
  rawResult: string;
  cwd: string;
  timeoutMs?: number;
  durationMs?: number;
  timedOut: boolean;
  truncated: boolean;
}): string {
  const info: string[] = [];
  if (parts.cwd) info.push(`[cwd] ${parts.cwd}`);
  if (typeof parts.timeoutMs === 'number' && Number.isFinite(parts.timeoutMs) && parts.timeoutMs > 0) {
    info.push(`[timeout] ${Math.round(parts.timeoutMs)}ms`);
  }
  if (typeof parts.durationMs === 'number' && Number.isFinite(parts.durationMs) && parts.durationMs >= 0) {
    info.push(`[duration] ${Math.round(parts.durationMs)}ms`);
  }
  if (parts.timedOut) info.push('[status] timed out');
  if (parts.truncated) info.push('[notice] output truncated');

  const sections: string[] = [];
  if (info.length > 0) sections.push(info.join('\n'));

  const stdout = String(parts.stdout ?? '').trimEnd();
  const stderr = String(parts.stderr ?? '').trimEnd();
  const rawResult = String(parts.rawResult ?? '').trim();
  if (stdout) sections.push(stdout);
  if (stderr) sections.push(stdout ? `[stderr]\n${stderr}` : stderr);
  if (rawResult && !stdout && !stderr) sections.push(rawResult);

  return sections.join('\n\n').trim();
}

function normalizeShellStatus(raw: unknown): ShellBlockProps['status'] | undefined {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'success') return 'success';
  if (value === 'error' || value === 'failed' || value === 'timeout' || value === 'timed_out') return 'error';
  if (value === 'running' || value === 'pending') return 'running';
  return undefined;
}

function terminalOutputURL(runID: string, toolID: string, metaOnly: boolean): string {
  const base = `/_redeven_proxy/api/ai/runs/${encodeURIComponent(runID)}/tools/${encodeURIComponent(toolID)}/output`;
  if (!metaOnly) return base;
  return `${base}?meta_only=1`;
}

/**
 * Renders a terminal-style block showing a shell command, its output,
 * and exit code. Output is collapsed by default and can be toggled
 * by clicking the header.
 */
export const ShellBlock: Component<ShellBlockProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [loadingOutput, setLoadingOutput] = createSignal(false);
  const [loadedOutput, setLoadedOutput] = createSignal<string | undefined>(undefined);
  const [loadError, setLoadError] = createSignal<string>('');
  const [loadAttempted, setLoadAttempted] = createSignal(false);
  const [runtimeStatus, setRuntimeStatus] = createSignal<'success' | 'error' | undefined>(undefined);
  const [runtimeExitCode, setRuntimeExitCode] = createSignal<number | undefined>(undefined);
  const [runtimeDurationMs, setRuntimeDurationMs] = createSignal<number | undefined>(undefined);
  const [runtimeTimedOut, setRuntimeTimedOut] = createSignal<boolean | undefined>(undefined);
  const [runtimeTruncated, setRuntimeTruncated] = createSignal<boolean | undefined>(undefined);
  const [runtimeCwd, setRuntimeCwd] = createSignal<string | undefined>(undefined);
  const [runtimeTimeoutMs, setRuntimeTimeoutMs] = createSignal<number | undefined>(undefined);
  const commandTokens = createMemo(() => tokenizeShellCommand(props.command));

  const hasOutputRef = () =>
    String(props.outputRef?.runId ?? '').trim().length > 0 &&
    String(props.outputRef?.toolId ?? '').trim().length > 0;
  const displayStatus = () => props.status === 'running' ? runtimeStatus() ?? 'running' : props.status;
  const displayExitCode = () => props.exitCode ?? runtimeExitCode();
  const displayDurationMs = () => props.durationMs ?? runtimeDurationMs();
  const displayTimedOut = () => (typeof props.timedOut === 'boolean' ? props.timedOut : runtimeTimedOut() ?? false);
  const displayTruncated = () => (typeof props.truncated === 'boolean' ? props.truncated : runtimeTruncated() ?? false);
  const displayCwd = () => props.cwd ?? runtimeCwd() ?? '';
  const displayTimeoutMs = () => props.timeoutMs ?? runtimeTimeoutMs();
  const resolvedOutput = () => props.output ?? loadedOutput();
  const hasOutput = () => String(resolvedOutput() ?? '').trim().length > 0;
  const canToggle = () => hasOutput() || hasOutputRef() || displayStatus() === 'running';

  createEffect(() => {
    const runID = String(props.outputRef?.runId ?? '').trim();
    const toolID = String(props.outputRef?.toolId ?? '').trim();
    const command = props.command;
    void runID;
    void toolID;
    void command;
    setRuntimeStatus(undefined);
    setRuntimeExitCode(undefined);
    setRuntimeDurationMs(undefined);
    setRuntimeTimedOut(undefined);
    setRuntimeTruncated(undefined);
    setRuntimeCwd(undefined);
    setRuntimeTimeoutMs(undefined);
    setLoadedOutput(undefined);
    setLoadError('');
    setLoadAttempted(false);
    setLoadingOutput(false);
  });

  const statusClass = () => {
    switch (displayStatus()) {
      case 'running':
        return 'chat-shell-block-running';
      case 'error':
        return 'chat-shell-block-error';
      default:
        return 'chat-shell-block-success';
    }
  };

  const toggleLabel = () => (expanded() ? 'Hide output' : 'Show output');

  const fetchToolOutput = async (metaOnly: boolean): Promise<TerminalToolOutputPayload> => {
    const runID = String(props.outputRef?.runId ?? '').trim();
    const toolID = String(props.outputRef?.toolId ?? '').trim();
    if (!runID || !toolID) return {};

    const resp = await fetch(terminalOutputURL(runID, toolID, metaOnly), {
      method: 'GET',
      credentials: 'omit',
      cache: 'no-store',
    });
    const raw = await resp.text();
    let payload: any = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    if (!resp.ok || payload?.ok === false) {
      throw new Error(String(payload?.error ?? `HTTP ${resp.status}`));
    }
    return (payload?.data ?? {}) as TerminalToolOutputPayload;
  };

  const applyRuntimeMetadata = (data: TerminalToolOutputPayload) => {
    const normalizedStatus = normalizeShellStatus(data.status);
    if (normalizedStatus === 'success' || normalizedStatus === 'error') {
      setRuntimeStatus(normalizedStatus);
    }
    if (typeof data.exit_code === 'number' && Number.isFinite(data.exit_code)) {
      setRuntimeExitCode(Math.round(data.exit_code));
    }
    if (typeof data.duration_ms === 'number' && Number.isFinite(data.duration_ms) && data.duration_ms >= 0) {
      setRuntimeDurationMs(Math.round(data.duration_ms));
    }
    if (typeof data.timed_out === 'boolean') {
      setRuntimeTimedOut(data.timed_out);
    }
    if (typeof data.truncated === 'boolean') {
      setRuntimeTruncated(data.truncated);
    }
    if (typeof data.cwd === 'string' && data.cwd.trim()) {
      setRuntimeCwd(data.cwd.trim());
    }
    if (typeof data.timeout_ms === 'number' && Number.isFinite(data.timeout_ms) && data.timeout_ms > 0) {
      setRuntimeTimeoutMs(Math.round(data.timeout_ms));
    }
  };

  const ensureOutputLoaded = async () => {
    if (props.output || loadedOutput() || loadingOutput()) return;
    if (!hasOutputRef()) return;
    if (displayStatus() === 'running') return;

    setLoadingOutput(true);
    setLoadError('');
    setLoadAttempted(true);
    try {
      const data = await fetchToolOutput(false);
      applyRuntimeMetadata(data);
      const output = composeDeferredOutput({
        stdout: String(data.stdout ?? ''),
        stderr: String(data.stderr ?? ''),
        rawResult: String(data.raw_result ?? ''),
        cwd: String(data.cwd ?? displayCwd()),
        timeoutMs:
          typeof data.timeout_ms === 'number' ? data.timeout_ms : displayTimeoutMs(),
        durationMs:
          typeof data.duration_ms === 'number' ? data.duration_ms : displayDurationMs(),
        timedOut:
          typeof data.timed_out === 'boolean' ? data.timed_out : displayTimedOut(),
        truncated:
          typeof data.truncated === 'boolean' ? data.truncated : displayTruncated(),
      });
      setLoadedOutput(output || 'No output captured.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLoadError(message || 'Failed to load output.');
    } finally {
      setLoadingOutput(false);
    }
  };

  createEffect(() => {
    if (!expanded()) return;
    if (displayStatus() === 'running') return;
    void ensureOutputLoaded();
  });

  createEffect(() => {
    if (!hasOutputRef()) return;
    if (displayStatus() !== 'running') return;
    let disposed = false;
    let timer: number | null = null;

    const pollStatus = async () => {
      if (disposed) return;
      try {
        const data = await fetchToolOutput(true);
        if (disposed) return;
        applyRuntimeMetadata(data);
        const status = normalizeShellStatus(data.status);
        if (status && status !== 'running') {
          if (expanded()) {
            void ensureOutputLoaded();
          }
          return;
        }
      } catch {
        // Best effort: keep current status from stream and retry.
      }
      if (!disposed && displayStatus() === 'running') {
        timer = window.setTimeout(() => {
          void pollStatus();
        }, TERMINAL_STATUS_POLL_INTERVAL_MS);
      }
    };

    void pollStatus();
    onCleanup(() => {
      disposed = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    });
  });

  const handleHeaderClick = () => {
    if (!canToggle()) return;
    setExpanded((value) => {
      const next = !value;
      if (next) {
        void ensureOutputLoaded();
      }
      return next;
    });
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
        <Show when={displayStatus() === 'running'}>
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
        <Show when={displayStatus() === 'success'}>
          <span class="chat-shell-status-icon chat-shell-status-success" aria-label="Success">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
        </Show>
        <Show when={displayStatus() === 'error'}>
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
        <Show when={displayStatus() !== 'running' && displayExitCode() !== undefined}>
          <span
            class={cn(
              'chat-shell-exit-inline',
              displayExitCode() === 0 ? 'chat-shell-exit-inline-success' : 'chat-shell-exit-inline-error',
            )}
          >
            exit {displayExitCode()}
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
              when={resolvedOutput()}
              fallback={
                <Show
                  when={displayStatus() === 'running' || loadingOutput() || loadAttempted() || loadError()}
                >
                  <div class={cn('chat-shell-output', loadError() ? 'chat-shell-output-error' : 'chat-shell-output-muted')}>
                    <pre>
                      {displayStatus() === 'running'
                        ? 'Waiting for output...'
                        : loadingOutput()
                          ? 'Loading output...'
                          : loadError()
                            ? `[error] ${loadError()}`
                            : 'No output captured.'}
                    </pre>
                  </div>
                </Show>
              }
            >
              <div
                class={cn(
                  'chat-shell-output',
                  displayStatus() === 'error' && 'chat-shell-output-error',
                )}
              >
                <pre>{resolvedOutput()}</pre>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
};
