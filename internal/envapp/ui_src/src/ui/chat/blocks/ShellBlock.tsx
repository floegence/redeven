import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup } from 'solid-js';
import type { Component } from 'solid-js';
import { cn } from '@floegence/floe-webapp-core';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { prepareGatewayRequestInit } from '../../services/gatewayApi';
import { writeTextToClipboard } from '../../utils/clipboard';

export interface ShellBlockProps {
  command: string;
  output?: string;
  outputRef?: {
    runId: string;
    toolId: string;
  };
  cwd?: string;
  timeoutMs?: number;
  requestedTimeoutMs?: number;
  timeoutSource?: string;
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
  requested_timeout_ms?: number;
  timeout_source?: string;
  raw_result?: string;
}

const MULTI_CHAR_OPERATORS = ['&&', '||', '>>', '<<', '>|', '|&', '2>', '1>', '&>'] as const;
const SINGLE_CHAR_OPERATORS = new Set(['|', ';', '>', '<', '(', ')']);
const TERMINAL_STATUS_POLL_INTERVAL_MS = 1200;
const COMMAND_PREVIEW_MAX_LENGTH = 180;
const COMMAND_COPY_RESET_MS = 1800;

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

function normalizeCommandText(command: string): string {
  return String(command ?? '').replace(/\r\n?/g, '\n').trim();
}

function meaningfulCommandLines(command: string): string[] {
  const normalized = normalizeCommandText(command);
  if (!normalized) return [];
  return normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function normalizeCommandPreviewSource(command: string): string {
  const normalized = meaningfulCommandLines(command)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || '(empty command)';
}

function summarizeCommandPreview(command: string, maxLength = COMMAND_PREVIEW_MAX_LENGTH): string {
  const normalized = normalizeCommandPreviewSource(command);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatCommandLineCount(count: number): string {
  return `${count} ${count === 1 ? 'line' : 'lines'}`;
}

function formatShellStatus(status: ShellBlockProps['status']): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'error':
      return 'Error';
    default:
      return 'Success';
  }
}

function formatDuration(durationMs: number | undefined): string | null {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) return null;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  const totalSeconds = Math.round(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatTimeoutLabel(timeoutMs: number | undefined, timeoutSource: string): string | null {
  if (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return null;
  const seconds = Math.max(1, Math.floor(timeoutMs / 1000));
  if (timeoutSource === 'default') return `auto ${seconds}s`;
  if (timeoutSource === 'capped') return `${seconds}s cap`;
  return `${seconds}s timeout`;
}

function composeDeferredOutput(parts: {
  stdout: string;
  stderr: string;
  rawResult: string;
  cwd: string;
  timeoutMs?: number;
  requestedTimeoutMs?: number;
  timeoutSource?: string;
  durationMs?: number;
  timedOut: boolean;
  truncated: boolean;
}): string {
  const info: string[] = [];
  if (parts.cwd) info.push(`[cwd] ${parts.cwd}`);
  if (typeof parts.timeoutMs === 'number' && Number.isFinite(parts.timeoutMs) && parts.timeoutMs > 0) {
    const roundedTimeout = Math.round(parts.timeoutMs);
    const roundedRequested =
      typeof parts.requestedTimeoutMs === 'number' && Number.isFinite(parts.requestedTimeoutMs)
        ? Math.round(parts.requestedTimeoutMs)
        : undefined;
    if (parts.timeoutSource === 'default') {
      info.push(`[timeout] auto ${roundedTimeout}ms`);
    } else if (parts.timeoutSource === 'capped' && typeof roundedRequested === 'number' && roundedRequested > roundedTimeout) {
      info.push(`[timeout] capped ${roundedTimeout}ms (requested ${roundedRequested}ms)`);
    } else {
      info.push(`[timeout] ${roundedTimeout}ms`);
    }
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

export const ShellBlock: Component<ShellBlockProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const [loadingOutput, setLoadingOutput] = createSignal(false);
  const [loadedOutput, setLoadedOutput] = createSignal<string | undefined>(undefined);
  const [loadError, setLoadError] = createSignal('');
  const [loadAttempted, setLoadAttempted] = createSignal(false);
  const [runtimeStatus, setRuntimeStatus] = createSignal<'success' | 'error' | undefined>(undefined);
  const [runtimeExitCode, setRuntimeExitCode] = createSignal<number | undefined>(undefined);
  const [runtimeDurationMs, setRuntimeDurationMs] = createSignal<number | undefined>(undefined);
  const [runtimeTimedOut, setRuntimeTimedOut] = createSignal<boolean | undefined>(undefined);
  const [runtimeTruncated, setRuntimeTruncated] = createSignal<boolean | undefined>(undefined);
  const [runtimeCwd, setRuntimeCwd] = createSignal<string | undefined>(undefined);
  const [runtimeTimeoutMs, setRuntimeTimeoutMs] = createSignal<number | undefined>(undefined);
  const [runtimeRequestedTimeoutMs, setRuntimeRequestedTimeoutMs] = createSignal<number | undefined>(undefined);
  const [runtimeTimeoutSource, setRuntimeTimeoutSource] = createSignal<string | undefined>(undefined);
  const [commandDialogOpen, setCommandDialogOpen] = createSignal(false);
  const [commandCopied, setCommandCopied] = createSignal(false);
  let commandCopiedResetTimer: number | null = null;

  const outputPanelId = `chat-shell-output-${createUniqueId()}`;
  const normalizedCommand = createMemo(() => normalizeCommandText(props.command));
  const commandPreviewSource = createMemo(() => normalizeCommandPreviewSource(props.command));
  const commandPreview = createMemo(() => summarizeCommandPreview(props.command));
  const commandPreviewTokens = createMemo(() => tokenizeShellCommand(commandPreview()));
  const commandLineCount = createMemo(() => Math.max(1, meaningfulCommandLines(props.command).length || 1));

  const hasOutputRef = () =>
    String(props.outputRef?.runId ?? '').trim().length > 0 &&
    String(props.outputRef?.toolId ?? '').trim().length > 0;
  const displayStatus = () => (props.status === 'running' ? runtimeStatus() ?? 'running' : props.status);
  const displayExitCode = () => props.exitCode ?? runtimeExitCode();
  const displayDurationMs = () => props.durationMs ?? runtimeDurationMs();
  const displayTimedOut = () => (typeof props.timedOut === 'boolean' ? props.timedOut : runtimeTimedOut() ?? false);
  const displayTruncated = () => (typeof props.truncated === 'boolean' ? props.truncated : runtimeTruncated() ?? false);
  const displayCwd = () => props.cwd ?? runtimeCwd() ?? '';
  const displayTimeoutMs = () => props.timeoutMs ?? runtimeTimeoutMs();
  const displayRequestedTimeoutMs = () => props.requestedTimeoutMs ?? runtimeRequestedTimeoutMs();
  const displayTimeoutSource = () => props.timeoutSource ?? runtimeTimeoutSource() ?? '';
  const resolvedOutput = () => props.output ?? loadedOutput();
  const hasOutput = () => String(resolvedOutput() ?? '').trim().length > 0;
  const canToggle = () => hasOutput() || hasOutputRef() || displayStatus() === 'running';
  const showCommandDetails = createMemo(
    () => normalizedCommand().length > 0 && (commandLineCount() > 1 || commandPreview() !== commandPreviewSource()),
  );
  const timeoutInlineLabel = createMemo(() => formatTimeoutLabel(displayTimeoutMs(), displayTimeoutSource()));

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
    setRuntimeRequestedTimeoutMs(undefined);
    setRuntimeTimeoutSource(undefined);
    setLoadedOutput(undefined);
    setLoadError('');
    setLoadAttempted(false);
    setLoadingOutput(false);
    setExpanded(false);
    setCommandDialogOpen(false);
    setCommandCopied(false);
    if (commandCopiedResetTimer != null) {
      window.clearTimeout(commandCopiedResetTimer);
      commandCopiedResetTimer = null;
    }
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

    const resp = await fetch(
      terminalOutputURL(runID, toolID, metaOnly),
      await prepareGatewayRequestInit({ method: 'GET' }),
    );
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
    if (typeof data.requested_timeout_ms === 'number' && Number.isFinite(data.requested_timeout_ms) && data.requested_timeout_ms > 0) {
      setRuntimeRequestedTimeoutMs(Math.round(data.requested_timeout_ms));
    }
    if (typeof data.timeout_source === 'string' && data.timeout_source.trim()) {
      setRuntimeTimeoutSource(data.timeout_source.trim());
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
        requestedTimeoutMs:
          typeof data.requested_timeout_ms === 'number' ? data.requested_timeout_ms : displayRequestedTimeoutMs(),
        timeoutSource:
          typeof data.timeout_source === 'string' ? data.timeout_source : displayTimeoutSource(),
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

  const handleToggleOutput = () => {
    if (!canToggle()) return;
    setExpanded((value) => {
      const next = !value;
      if (next) {
        void ensureOutputLoaded();
      }
      return next;
    });
  };

  const handleCopyCommand = async (): Promise<void> => {
    if (!normalizedCommand()) return;
    try {
      await writeTextToClipboard(normalizedCommand());
      setCommandCopied(true);
      if (commandCopiedResetTimer != null) {
        window.clearTimeout(commandCopiedResetTimer);
      }
      commandCopiedResetTimer = window.setTimeout(() => {
        setCommandCopied(false);
        commandCopiedResetTimer = null;
      }, COMMAND_COPY_RESET_MS);
    } catch {
      setCommandCopied(false);
    }
  };

  onCleanup(() => {
    if (commandCopiedResetTimer != null) {
      window.clearTimeout(commandCopiedResetTimer);
    }
  });

  return (
    <div class={cn('chat-shell-block', statusClass(), props.class)}>
      <div class="chat-shell-header">
        <div class="chat-shell-command" title={normalizedCommand() || commandPreviewSource()}>
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
          <span class="chat-shell-command-text">
            <span class="chat-shell-command-highlight">
              <For each={commandPreviewTokens()}>
                {(token) => <span class={tokenClass(token.kind)}>{token.text}</span>}
              </For>
            </span>
          </span>
        </div>

        <div class="chat-shell-header-meta">
          <Show when={commandLineCount() > 1}>
            <span class="chat-shell-inline-chip chat-shell-inline-chip-muted">
              {formatCommandLineCount(commandLineCount())}
            </span>
          </Show>

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

          <Show when={timeoutInlineLabel()}>
            <span
              class={cn(
                'chat-shell-timeout-inline',
                displayTimeoutSource() === 'default' && 'chat-shell-timeout-inline-auto',
                displayTimeoutSource() === 'capped' && 'chat-shell-timeout-inline-capped',
              )}
            >
              {timeoutInlineLabel()}
            </span>
          </Show>

          <Show when={showCommandDetails()}>
            <button
              type="button"
              class="chat-shell-detail-link"
              onClick={() => setCommandDialogOpen(true)}
            >
              Command
            </button>
          </Show>

          <Show when={canToggle()}>
            <button
              type="button"
              class={cn('chat-shell-output-toggle', expanded() && 'chat-shell-output-toggle-open')}
              onClick={handleToggleOutput}
              aria-expanded={expanded()}
              aria-controls={outputPanelId}
              aria-label={`${toggleLabel()} for command output`}
            >
              <span class="chat-shell-toggle-label">Output</span>
              <span class={cn('chat-shell-toggle', expanded() && 'chat-shell-toggle-open')}>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </span>
            </button>
          </Show>
        </div>
      </div>

      <Show when={canToggle() && expanded()}>
        <div id={outputPanelId} class="chat-shell-output-panel">
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
      </Show>

      <Show when={showCommandDetails()}>
        <Dialog
          open={commandDialogOpen()}
          onOpenChange={(open) => setCommandDialogOpen(open)}
          title="Command details"
        >
          <div class="chat-shell-detail-dialog">
            <div class="chat-shell-detail-meta-grid">
              <div class="chat-shell-detail-meta-card">
                <div class="chat-shell-detail-meta-label">Status</div>
                <div class="chat-shell-detail-meta-value">{formatShellStatus(displayStatus())}</div>
              </div>
              <Show when={displayExitCode() !== undefined}>
                <div class="chat-shell-detail-meta-card">
                  <div class="chat-shell-detail-meta-label">Exit code</div>
                  <div class="chat-shell-detail-meta-value chat-shell-detail-meta-value-mono">{displayExitCode()}</div>
                </div>
              </Show>
              <div class="chat-shell-detail-meta-card">
                <div class="chat-shell-detail-meta-label">Lines</div>
                <div class="chat-shell-detail-meta-value">{formatCommandLineCount(commandLineCount())}</div>
              </div>
              <Show when={displayCwd()}>
                <div class="chat-shell-detail-meta-card">
                  <div class="chat-shell-detail-meta-label">Working directory</div>
                  <div class="chat-shell-detail-meta-value chat-shell-detail-meta-value-mono">{displayCwd()}</div>
                </div>
              </Show>
              <Show when={formatDuration(displayDurationMs())}>
                {(value) => (
                  <div class="chat-shell-detail-meta-card">
                    <div class="chat-shell-detail-meta-label">Duration</div>
                    <div class="chat-shell-detail-meta-value">{value()}</div>
                  </div>
                )}
              </Show>
              <Show when={timeoutInlineLabel()}>
                {(value) => (
                  <div class="chat-shell-detail-meta-card">
                    <div class="chat-shell-detail-meta-label">Timeout</div>
                    <div class="chat-shell-detail-meta-value">{value()}</div>
                  </div>
                )}
              </Show>
            </div>

            <div class="chat-shell-detail-toolbar">
              <button
                type="button"
                class="chat-shell-detail-copy"
                onClick={() => void handleCopyCommand()}
              >
                {commandCopied() ? 'Copied' : 'Copy command'}
              </button>
            </div>

            <div class="chat-shell-detail-section">
              <div class="chat-shell-detail-label">Full command</div>
              <pre class="chat-shell-detail-command">
                {normalizedCommand() || '(empty command)'}
              </pre>
            </div>
          </div>
        </Dialog>
      </Show>
    </div>
  );
};
