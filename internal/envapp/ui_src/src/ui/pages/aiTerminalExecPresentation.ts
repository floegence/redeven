import type { Message, MessageBlock, StreamEvent } from '@floegence/floe-webapp-core/chat';

const TERMINAL_EXEC_TOOL_NAME = 'terminal.exec';

type AnyRecord = Record<string, unknown>;
type ChatToolCallBlock = Extract<MessageBlock, { type: 'tool-call' }>;

export function decorateMessageForTerminalExec(message: Message): Message {
  if (!message || !Array.isArray(message.blocks) || message.blocks.length === 0) {
    return message;
  }

  let changed = false;
  const nextBlocks = message.blocks.map((block) => {
    const next = decorateBlockForTerminalExec(block);
    if (next !== block) {
      changed = true;
    }
    return next;
  });

  if (!changed) {
    return message;
  }
  return { ...message, blocks: nextBlocks };
}

export function decorateStreamEventForTerminalExec(event: StreamEvent): StreamEvent {
  if (event.type !== 'block-set') {
    return event;
  }
  const nextBlock = decorateBlockForTerminalExec(event.block);
  if (nextBlock === event.block) {
    return event;
  }
  return {
    ...event,
    block: nextBlock,
  };
}

function decorateBlockForTerminalExec(block: MessageBlock): MessageBlock {
  if (block.type !== 'tool-call') {
    return block;
  }

  const decoratedTerminalBlock = buildTerminalExecShellBlock(block);
  if (decoratedTerminalBlock) {
    return decoratedTerminalBlock;
  }

  const childBlocks = Array.isArray(block.children) ? block.children : [];
  if (childBlocks.length === 0) {
    return block;
  }

  let changed = false;
  const nextChildren = childBlocks.map((child) => {
    const next = decorateBlockForTerminalExec(child);
    if (next !== child) {
      changed = true;
    }
    return next;
  });

  if (!changed) {
    return block;
  }
  return {
    ...block,
    children: nextChildren,
  };
}

function buildTerminalExecShellBlock(block: ChatToolCallBlock): MessageBlock | null {
  if (String(block.toolName ?? '').trim() !== TERMINAL_EXEC_TOOL_NAME) {
    return null;
  }

  const args = asRecord(block.args);
  const result = asRecord(block.result);

  const command = readString(args, ['command']) || '(empty command)';
  const cwd = readString(args, ['cwd', 'workdir']);
  const timeoutMs = readNumber(args, ['timeout_ms', 'timeoutMs']);

  const stdout = readString(result, ['stdout']);
  const stderr = readString(result, ['stderr']);
  const exitCode = readNumber(result, ['exit_code', 'exitCode']);
  const durationMs = readNumber(result, ['duration_ms', 'durationMs']);
  const timedOut = readBoolean(result, ['timed_out', 'timedOut']);
  const truncated = readBoolean(result, ['truncated']);
  const output = composeTerminalOutput({
    stdout,
    stderr,
    cwd,
    timeoutMs,
    durationMs,
    timedOut,
    truncated,
    toolError: String(block.error ?? '').trim(),
  });

  return {
    type: 'shell',
    command,
    output: output || undefined,
    exitCode: typeof exitCode === 'number' && Number.isFinite(exitCode) ? Math.round(exitCode) : undefined,
    status: toShellStatus(block.status),
  };
}

function asRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as AnyRecord;
}

function readString(from: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = from[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return value;
      }
    }
  }
  return '';
}

function readNumber(from: AnyRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = from[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

function readBoolean(from: AnyRecord, keys: string[]): boolean {
  for (const key of keys) {
    const value = from[key];
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value === 'number') {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1') {
        return true;
      }
      if (normalized === 'false' || normalized === '0') {
        return false;
      }
    }
  }
  return false;
}

function toShellStatus(status: ChatToolCallBlock['status']): 'running' | 'success' | 'error' {
  if (status === 'success') {
    return 'success';
  }
  if (status === 'error') {
    return 'error';
  }
  return 'running';
}

type TerminalOutputParts = Readonly<{
  stdout: string;
  stderr: string;
  cwd: string;
  timeoutMs?: number;
  durationMs?: number;
  timedOut: boolean;
  truncated: boolean;
  toolError: string;
}>;

function composeTerminalOutput(parts: TerminalOutputParts): string {
  const info: string[] = [];
  if (parts.cwd) {
    info.push(`[cwd] ${parts.cwd}`);
  }
  if (typeof parts.timeoutMs === 'number' && Number.isFinite(parts.timeoutMs) && parts.timeoutMs > 0) {
    info.push(`[timeout] ${Math.max(0, Math.round(parts.timeoutMs))}ms`);
  }
  if (typeof parts.durationMs === 'number' && Number.isFinite(parts.durationMs) && parts.durationMs >= 0) {
    info.push(`[duration] ${Math.round(parts.durationMs)}ms`);
  }
  if (parts.timedOut) {
    info.push('[status] timed out');
  }
  if (parts.truncated) {
    info.push('[notice] output truncated');
  }

  const sections: string[] = [];
  if (info.length > 0) {
    sections.push(info.join('\n'));
  }
  const stdout = String(parts.stdout ?? '').trimEnd();
  const stderr = String(parts.stderr ?? '').trimEnd();
  const toolError = String(parts.toolError ?? '').trim();

  if (stdout) {
    sections.push(stdout);
  }
  if (stderr) {
    sections.push(stdout ? `[stderr]\n${stderr}` : stderr);
  }
  if (toolError && !stderr.includes(toolError)) {
    sections.push(`[error] ${toolError}`);
  }

  return sections.join('\n\n').trim();
}
