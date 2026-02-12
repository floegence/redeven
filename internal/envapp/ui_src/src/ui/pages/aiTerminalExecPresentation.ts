import type { Message, MessageBlock, StreamEvent } from '@floegence/floe-webapp-core/chat';

const TERMINAL_EXEC_TOOL_NAME = 'terminal.exec';
const PREVIEW_LINE_LIMIT = 5;

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

  const decoratedTerminalBlock = buildTerminalExecMarkdownBlock(block);
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

function buildTerminalExecMarkdownBlock(block: ChatToolCallBlock): MessageBlock | null {
  if (String(block.toolName ?? '').trim() !== TERMINAL_EXEC_TOOL_NAME) {
    return null;
  }
  if (block.status !== 'success' && block.status !== 'error') {
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

  const previewSource = block.status === 'success' ? stdout : stderr || stdout;
  const preview = previewFirstLines(previewSource, PREVIEW_LINE_LIMIT);

  const executionFacts: string[] = [];
  executionFacts.push(`status ${formatStatus(block.status, timedOut)}`);
  if (typeof exitCode === 'number' && Number.isFinite(exitCode)) {
    executionFacts.push(`exit ${exitCode}`);
  }
  if (typeof durationMs === 'number' && Number.isFinite(durationMs)) {
    executionFacts.push(`${Math.max(0, Math.round(durationMs))}ms`);
  }

  const markdown: string[] = [];
  markdown.push('**Terminal command**');
  markdown.push('');
  markdown.push(toCodeFence(command, 'bash'));
  markdown.push('');
  if (executionFacts.length > 0) {
    markdown.push(`**Execution**: ${executionFacts.join(' · ')}`);
    markdown.push('');
  }
  if (cwd) {
    markdown.push(`**Working directory**: \`${escapeInlineCode(cwd)}\``);
    markdown.push('');
  }
  if (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0) {
    markdown.push(`**Timeout**: ${Math.round(timeoutMs)}ms`);
    markdown.push('');
  }

  markdown.push(`**Output preview (first ${PREVIEW_LINE_LIMIT} lines)**`);
  markdown.push('');
  markdown.push(toCodeFence(preview.text, 'text'));
  markdown.push('');

  if (preview.truncated || truncated) {
    markdown.push('_Preview is truncated. Expand details for the full captured output._');
    markdown.push('');
  }

  markdown.push('<details class="chat-terminal-exec-details">');
  markdown.push('<summary class="chat-terminal-exec-summary">View full execution details</summary>');
  markdown.push('');
  markdown.push('**stdout**');
  markdown.push('');
  markdown.push(toCodeFence(stdout || '(empty)', 'text'));
  markdown.push('');
  markdown.push('**stderr**');
  markdown.push('');
  markdown.push(toCodeFence(stderr || '(empty)', 'text'));
  markdown.push('');
  markdown.push('**Metadata**');
  markdown.push('');
  markdown.push(
    toCodeFence(
      safeJson(
        {
          status: block.status,
          tool_id: String(block.toolId ?? '').trim() || undefined,
          exit_code: exitCode,
          duration_ms: durationMs,
          timed_out: timedOut,
          truncated,
        },
        2,
      ),
      'json',
    ),
  );
  markdown.push('</details>');

  return {
    type: 'markdown',
    content: markdown.join('\n'),
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

function previewFirstLines(raw: string, maxLines: number): { text: string; truncated: boolean } {
  const normalized = String(raw ?? '').replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  if (lines.length === 0) {
    return { text: '(no output)', truncated: false };
  }

  const previewLines = lines.slice(0, Math.max(1, maxLines));
  return {
    text: previewLines.join('\n'),
    truncated: lines.length > Math.max(1, maxLines),
  };
}

function escapeInlineCode(value: string): string {
  return String(value ?? '').replace(/`/g, '\\`');
}

function toCodeFence(content: string, language = 'text'): string {
  const source = String(content ?? '');
  const runs = source.match(/`+/g);
  const longest = runs ? runs.reduce((max, item) => Math.max(max, item.length), 0) : 0;
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${source}\n${fence}`;
}

function safeJson(value: unknown, indent = 2): string {
  try {
    return JSON.stringify(value, null, indent);
  } catch {
    return '{}';
  }
}

function formatStatus(status: ChatToolCallBlock['status'], timedOut: boolean): string {
  if (timedOut) {
    return 'timed out';
  }
  if (status === 'success') {
    return 'success';
  }
  if (status === 'error') {
    return 'failed';
  }
  return status;
}
