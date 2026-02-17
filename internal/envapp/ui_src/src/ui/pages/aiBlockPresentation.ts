// Block presentation decorators — transforms raw tool-call blocks into rich typed blocks
// before they are rendered by the chat UI.
//
// Extends the original terminal.exec → ShellBlock decorator with:
//   - write_todos → TodosBlock
//   - sources → SourcesBlock

import type { Message, MessageBlock, StreamEvent } from '../chat/types';
import type {
  TodosBlock as TodosBlockType,
  SourcesBlock as SourcesBlockType,
  SubagentBlock as SubagentBlockType,
} from '../chat/types';
import {
  extractSubagentViewsFromWaitResult,
  mapSubagentPayloadSnakeToCamel,
  normalizeWriteTodosToolView,
} from './aiDataNormalizers';

const TERMINAL_EXEC_TOOL_NAME = 'terminal.exec';
const WRITE_TODOS_TOOL_NAME = 'write_todos';
const SOURCES_TOOL_NAME = 'sources';
const DELEGATE_TASK_TOOL_NAME = 'delegate_task';
const WAIT_SUBAGENTS_TOOL_NAME = 'wait_subagents';
const SUBAGENTS_TOOL_NAME = 'subagents';

type AnyRecord = Record<string, unknown>;
type ChatToolCallBlock = Extract<MessageBlock, { type: 'tool-call' }>;

function isWebURL(raw: string): boolean {
  const input = String(raw ?? '').trim();
  if (!input) return false;
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---- Public API ----

export function decorateMessageBlocks(message: Message): Message {
  if (!message || !Array.isArray(message.blocks) || message.blocks.length === 0) {
    return message;
  }

  let changed = false;
  const nextBlocks = message.blocks.map((block) => {
    const next = decorateBlock(block);
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

export function decorateStreamEvent(event: StreamEvent): StreamEvent {
  if (event.type !== 'block-set') {
    return event;
  }
  const nextBlock = decorateBlock(event.block);
  if (nextBlock === event.block) {
    return event;
  }
  return {
    ...event,
    block: nextBlock,
  };
}

// Backward-compatible aliases
export const decorateMessageForTerminalExec = decorateMessageBlocks;
export const decorateStreamEventForTerminalExec = decorateStreamEvent;

// ---- Internal decorator dispatch ----

function decorateBlock(block: MessageBlock): MessageBlock {
  if (block.type !== 'tool-call') {
    return block;
  }

  // Try each decorator in order
  const decorated =
    buildTerminalExecShellBlock(block) ??
    buildSubagentBlock(block) ??
    buildTodosBlock(block) ??
    buildSourcesBlock(block);
  if (decorated) {
    return decorated;
  }

  // Recurse into children
  const childBlocks = Array.isArray(block.children) ? block.children : [];
  if (childBlocks.length === 0) {
    return block;
  }

  let changed = false;
  const nextChildren = childBlocks.map((child) => {
    const next = decorateBlock(child);
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

function buildSubagentBlock(block: ChatToolCallBlock): SubagentBlockType | null {
  const toolName = String(block.toolName ?? '').trim();
  if (
    toolName !== DELEGATE_TASK_TOOL_NAME &&
    toolName !== WAIT_SUBAGENTS_TOOL_NAME &&
    toolName !== SUBAGENTS_TOOL_NAME
  ) {
    return null;
  }

  const args = asRecord(block.args);
  const result = asRecord(block.result);

  if (toolName === DELEGATE_TASK_TOOL_NAME) {
    const merged = {
      ...result,
      agent_type: result.agent_type ?? args.agent_type,
      trigger_reason: result.trigger_reason ?? args.trigger_reason,
    };
    const view = mapSubagentPayloadSnakeToCamel(merged);
    if (!view) return null;
    return toSubagentBlock(view);
  }

  if (toolName === WAIT_SUBAGENTS_TOOL_NAME) {
    const views = extractSubagentViewsFromWaitResult(result);
    if (views.length !== 1) return null;
    return toSubagentBlock(views[0]);
  }

  const action = String(args.action ?? result.action ?? '').trim().toLowerCase();
  if (!action) return null;
  if (action === 'inspect') {
    const view = mapSubagentPayloadSnakeToCamel(result.item);
    return view ? toSubagentBlock(view) : null;
  }
  if (action === 'steer' || action === 'terminate') {
    const view = mapSubagentPayloadSnakeToCamel(result.snapshot);
    return view ? toSubagentBlock(view) : null;
  }
  return null;
}

// ---- terminal.exec → ShellBlock ----

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
  const outputRef = readOutputRef(result);
  const hasInlineOutput = stdout !== '' || stderr !== '' || String(block.error ?? '').trim() !== '';
  const shouldInlineOutput = hasInlineOutput || !outputRef;
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
    output: shouldInlineOutput ? output || undefined : undefined,
    outputRef: outputRef || undefined,
    cwd: cwd || undefined,
    timeoutMs: typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.round(timeoutMs) : undefined,
    durationMs: typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0 ? Math.round(durationMs) : undefined,
    timedOut,
    truncated,
    exitCode: typeof exitCode === 'number' && Number.isFinite(exitCode) ? Math.round(exitCode) : undefined,
    status: toShellStatus(block.status),
  };
}

// ---- write_todos → TodosBlock ----

function buildTodosBlock(block: ChatToolCallBlock): TodosBlockType | null {
  if (String(block.toolName ?? '').trim() !== WRITE_TODOS_TOOL_NAME) {
    return null;
  }
  // Only convert when the tool has finished successfully; while running, keep the ToolCallBlock
  // so the spinner is shown.
  if (block.status !== 'success') {
    return null;
  }

  const normalized = normalizeWriteTodosToolView(block.result, block.args);
  return {
    type: 'todos',
    version: normalized.version,
    updatedAtUnixMs: normalized.updated_at_unix_ms,
    todos: normalized.todos.map((t) => ({
      id: t.id,
      content: t.content,
      status: t.status,
      note: t.note,
    })),
  };
}

// ---- sources → SourcesBlock ----

function buildSourcesBlock(block: ChatToolCallBlock): SourcesBlockType | null {
  if (String(block.toolName ?? '').trim() !== SOURCES_TOOL_NAME) {
    return null;
  }

  const result = asRecord(block.result);
  const rawSources = Array.isArray(result.sources) ? result.sources : [];
  const sources: SourcesBlockType['sources'] = [];
  const seen = new Set<string>();

  for (const entry of rawSources) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const url = String(rec.url ?? '').trim();
    if (!isWebURL(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const title = String(rec.title ?? '').replace(/\s+/g, ' ').trim();
    sources.push({ title: title || url, url });
  }

  if (sources.length === 0) {
    return null;
  }

  return {
    type: 'sources',
    sources,
  };
}

function toSubagentBlock(view: {
  subagentId: string;
  taskId: string;
  agentType: string;
  triggerReason: string;
  status: string;
  summary: string;
  evidenceRefs: string[];
  keyFiles: Array<{ path: string; line?: number; purpose?: string }>;
  openRisks: string[];
  nextActions: string[];
  stats: {
    steps: number;
    toolCalls: number;
    tokens: number;
    cost: number;
    elapsedMs: number;
    outcome: string;
  };
  updatedAtUnixMs: number;
  error?: string;
}): SubagentBlockType {
  return {
    type: 'subagent',
    subagentId: view.subagentId,
    taskId: view.taskId,
    agentType: view.agentType,
    triggerReason: view.triggerReason,
    status: view.status as SubagentBlockType['status'],
    summary: view.summary,
    evidenceRefs: view.evidenceRefs,
    keyFiles: view.keyFiles,
    openRisks: view.openRisks,
    nextActions: view.nextActions,
    stats: {
      steps: view.stats.steps,
      toolCalls: view.stats.toolCalls,
      tokens: view.stats.tokens,
      cost: view.stats.cost,
      elapsedMs: view.stats.elapsedMs,
      outcome: view.stats.outcome,
    },
    updatedAtUnixMs: view.updatedAtUnixMs,
    error: view.error,
  };
}

// ---- Shared helpers ----

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

function readOutputRef(from: AnyRecord): { runId: string; toolId: string } | null {
  const raw = from.output_ref;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const rec = raw as Record<string, unknown>;
  const runId = String(rec.run_id ?? rec.runId ?? '').trim();
  const toolId = String(rec.tool_id ?? rec.toolId ?? '').trim();
  if (!runId || !toolId) {
    return null;
  }
  return { runId, toolId };
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
