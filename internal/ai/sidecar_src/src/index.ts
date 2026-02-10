import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

import { streamText, tool } from 'ai';
import { z } from 'zod';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

type JSONRPCEnvelope = {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: { code: number; message: string };
};

type ProviderConfig = {
  id: string;
  type: 'openai' | 'anthropic' | 'openai_compatible';
  base_url?: string;
  api_key_env: string;
};

type RunStartParams = {
  run_id: string;
  model: string;
  mode?: 'build' | 'plan';
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  workspace_root_abs?: string;
  input: {
    text: string;
    attachments?: Array<{
      id?: string;
      name?: string;
      mime_type?: string;
      size?: number;
      content_utf8?: string;
      content_base64?: string;
      truncated?: boolean;
    }>;
  };
  options: { max_steps: number };
  guard?: {
    enabled?: boolean;
    auto_continue_max?: number;
    requires_tools?: boolean;
    attempt_index?: number;
  };
};

type ToolErrorPayload = {
  code: string;
  message: string;
  retryable?: boolean;
  suggested_fixes?: string[];
  normalized_args?: Record<string, any>;
  meta?: Record<string, any>;
};

type ToolCallResult =
  | { status: 'success'; result: any }
  | { status: 'error' | 'recovering'; error: ToolErrorPayload };

const providers: ProviderConfig[] = [];
const toolWaiters = new Map<string, { resolve: (v: ToolCallResult) => void }>();
const runToolCallCount = new Map<string, number>();

let currentRun: {
  runId: string;
  abort?: AbortController;
} | null = null;

const commitmentPhrases = [
  'let me',
  'i will',
  "i'll",
  'i am going to',
  "i'm going to",
  'first i',
  '我先',
  '我会',
  '我将',
  '先',
  '开始',
];

const actionPhrases = [
  'scan',
  'inspect',
  'read',
  'list',
  'check',
  'execute',
  'run',
  'explore',
  '分析',
  '扫描',
  '查看',
  '读取',
  '执行',
  '检查',
  '排查',
  '命令',
  '目录',
  '文件',
];

function writeLogLine(parts: string[]) {
  process.stderr.write(`[ai-sidecar] ${parts.join(' ')}\n`);
}

function sanitizeLogText(input: unknown, maxChars = 240): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (maxChars > 0 && cleaned.length > maxChars) {
    return `${cleaned.slice(0, maxChars)}... (truncated)`;
  }
  return cleaned;
}

function isSensitiveLogKey(key: string): boolean {
  const k = String(key ?? '').trim().toLowerCase();
  if (!k) return false;
  const direct = new Set([
    'content_utf8',
    'content_base64',
    'api_key',
    'apikey',
    'authorization',
    'cookie',
    'set_cookie',
    'token',
    'password',
    'secret',
  ]);
  if (direct.has(k)) return true;
  return k.includes('token') || k.includes('secret') || k.includes('password') || k.includes('api_key');
}

function redactForLog(key: string, value: any, depth = 0): any {
  if (depth > 4) return '[omitted]';
  if (isSensitiveLogKey(key)) {
    if (typeof value === 'string') return `[redacted:${value.length} chars]`;
    if (value instanceof Uint8Array) return `[redacted:${value.byteLength} bytes]`;
    return '[redacted]';
  }
  if (typeof value === 'string') return sanitizeLogText(value, 200);
  if (value instanceof Uint8Array) return `[bytes:${value.byteLength}]`;
  if (Array.isArray(value)) {
    const limit = Math.min(value.length, 8);
    const out = [] as any[];
    for (let i = 0; i < limit; i++) {
      out.push(redactForLog('', value[i], depth + 1));
    }
    if (value.length > limit) {
      out.push(`[... ${value.length - limit} more items]`);
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactForLog(k, v, depth + 1);
    }
    return out;
  }
  return value;
}

function previewForLog(value: unknown, maxChars = 280): string {
  try {
    if (typeof value === 'string') {
      return sanitizeLogText(value, maxChars);
    }
    return sanitizeLogText(JSON.stringify(value), maxChars);
  } catch (e) {
    return sanitizeLogText(String(e), maxChars);
  }
}

function logEvent(event: string, fields: Record<string, unknown> = {}) {
  const parts = [`event=${sanitizeLogText(event, 80)}`];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    const key = sanitizeLogText(k, 40);
    if (!key) continue;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const value = sanitizeLogText(v, 240);
      if (!value && typeof v === 'string') continue;
      parts.push(`${key}=${value}`);
      continue;
    }
    parts.push(`${key}=${previewForLog(redactForLog(key, v), 280)}`);
  }
  writeLogLine(parts);
}

function send(msg: JSONRPCEnvelope) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function notify(method: string, params: any) {
  send({ jsonrpc: '2.0', method, params });
}

function emitTextDelta(runId: string, delta: string) {
  const d = String(delta ?? '');
  if (!d) return;

  // Keep frames well below the agent-side scanner limit (2MB) to avoid disconnects when
  // a provider returns a large non-streaming completion.
  const maxChunkChars = 4096;
  if (d.length <= maxChunkChars) {
    notify('run.delta', { run_id: runId, delta: d });
    return;
  }

  let buf = '';
  let n = 0;
  for (const ch of d) {
    buf += ch;
    n++;
    if (n >= maxChunkChars) {
      notify('run.delta', { run_id: runId, delta: buf });
      buf = '';
      n = 0;
    }
  }
  if (buf) {
    notify('run.delta', { run_id: runId, delta: buf });
  }
}

function parseModel(modelId: string): { providerId: string; modelName: string } {
  const raw = String(modelId ?? '').trim();
  const idx = raw.indexOf('/');
  if (idx <= 0 || idx === raw.length - 1) {
    throw new Error(`Invalid model id: ${raw}`);
  }
  return {
    providerId: raw.slice(0, idx),
    modelName: raw.slice(idx + 1),
  };
}

function getProvider(providerId: string): ProviderConfig {
  const id = providerId.trim();
  const p = providers.find((x) => String(x?.id ?? '').trim() === id);
  if (!p) throw new Error(`Unknown provider: ${id}`);
  return p;
}

function createModel(modelId: string, runId = "") {
  const { providerId, modelName } = parseModel(modelId);
  const p = getProvider(providerId);
  logEvent('ai.sidecar.model.selected', {
    run_id: runId,
    provider_id: providerId,
    provider_type: p.type,
    model_name: modelName,
    has_base_url: Boolean(String(p.base_url ?? '').trim()),
  });
  const apiKey = String(process.env[String(p.api_key_env ?? '').trim()] ?? '').trim();
  if (!apiKey) throw new Error(`Missing API key env: ${p.api_key_env}`);

  const baseURL = String(p.base_url ?? '').trim() || undefined;

  switch (p.type) {
    case 'openai': {
      const openai = createOpenAI({ apiKey, baseURL });
      return openai(modelName);
    }
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey, baseURL });
      return anthropic(modelName);
    }
    case 'openai_compatible': {
      const compat = createOpenAICompatible({
        name: p.id,
        apiKey,
        baseURL: String(p.base_url ?? '').trim(),
      });
      return compat(modelName);
    }
    default:
      throw new Error(`Unsupported provider type: ${(p as any)?.type}`);
  }
}

function normalizeToolErrorPayload(raw: any): ToolErrorPayload {
  const code = String(raw?.code ?? 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
  const message = String(raw?.message ?? 'Tool failed').trim() || 'Tool failed';
  const retryable = Boolean(raw?.retryable);
  const suggestedFixes = Array.isArray(raw?.suggested_fixes)
    ? raw.suggested_fixes.map((it: any) => String(it ?? '').trim()).filter(Boolean)
    : undefined;
  const normalizedArgs = raw?.normalized_args && typeof raw.normalized_args === 'object'
    ? (raw.normalized_args as Record<string, any>)
    : undefined;
  const meta = raw?.meta && typeof raw.meta === 'object' ? (raw.meta as Record<string, any>) : undefined;
  return {
    code,
    message,
    retryable,
    suggested_fixes: suggestedFixes,
    normalized_args: normalizedArgs,
    meta,
  };
}

function shouldRetryWithNormalizedArgs(toolName: string, err: ToolErrorPayload): boolean {
  if (!err?.retryable) return false;
  if (!err?.normalized_args || typeof err.normalized_args !== 'object') return false;
  const code = String(err.code ?? '').toUpperCase();
  if (code !== 'INVALID_PATH' && code !== 'OUTSIDE_WORKSPACE') return false;
  if (toolName === 'terminal.exec') {
    return typeof err.normalized_args.cwd === 'string' && String(err.normalized_args.cwd).trim() !== '';
  }
  return typeof err.normalized_args.path === 'string' && String(err.normalized_args.path).trim() !== '';
}

function mergeToolArgs(args: any, normalizedArgs: Record<string, any> | undefined): any {
  if (!normalizedArgs || typeof normalizedArgs !== 'object') {
    return args;
  }
  const base = args && typeof args === 'object' ? { ...args } : {};
  for (const [k, v] of Object.entries(normalizedArgs)) {
    base[k] = v;
  }
  return base;
}

async function callTool(runId: string, toolName: string, args: any): Promise<ToolCallResult> {
  const toolId = `tc_${randomUUID()}`;
  runToolCallCount.set(runId, (runToolCallCount.get(runId) ?? 0) + 1);
  notify('run.phase', { run_id: runId, phase: 'tool_call', diag: { tool_name: toolName } });
  logEvent('ai.sidecar.tool.call.emit', {
    run_id: runId,
    tool_id: toolId,
    tool_name: toolName,
    args_preview: previewForLog(redactForLog('args', args), 320),
  });
  notify('tool.call', { run_id: runId, tool_id: toolId, tool_name: toolName, args });

  return await new Promise<ToolCallResult>((resolve) => {
    toolWaiters.set(toolId, { resolve });
    // Safety: avoid leaking waiters forever if something goes wrong.
    setTimeout(() => {
      const w = toolWaiters.get(toolId);
      if (!w) return;
      toolWaiters.delete(toolId);
      logEvent('ai.sidecar.tool.call.timeout', { run_id: runId, tool_id: toolId, tool_name: toolName });
      resolve({
        status: 'error',
        error: {
          code: 'TIMEOUT',
          message: 'Tool call timed out',
          retryable: true,
        },
      });
    }, 10 * 60 * 1000);
  });
}

async function executeTool(runId: string, toolName: string, args: any): Promise<any> {
  const first = await callTool(runId, toolName, args);
  if (first.status === 'success') {
    return first.result;
  }

  const firstError = normalizeToolErrorPayload(first.error);
  if (shouldRetryWithNormalizedArgs(toolName, firstError)) {
    const recoveryArgs = mergeToolArgs(args, firstError.normalized_args);
    logEvent('ai.sidecar.tool.call.recovering', {
      run_id: runId,
      tool_name: toolName,
      error_code: firstError.code,
      recovery_args_preview: previewForLog(redactForLog('recovery_args', recoveryArgs), 320),
    });

    const retry = await callTool(runId, toolName, recoveryArgs);
    if (retry.status === 'success') {
      return retry.result;
    }

    const retryError = normalizeToolErrorPayload(retry.error);
    return {
      status: 'error',
      error: retryError,
      recovery_attempted: true,
      first_error: firstError,
      recovery_args: recoveryArgs,
    };
  }

  return {
    status: 'error',
    error: firstError,
  };
}

function containsAny(text: string, hints: string[]): boolean {
  if (!text || !Array.isArray(hints) || hints.length === 0) return false;
  for (const raw of hints) {
    const hint = String(raw ?? '').trim().toLowerCase();
    if (!hint) continue;
    if (text.includes(hint)) return true;
  }
  return false;
}

function hasPathHint(text: string): boolean {
  if (!text) return false;
  if (text.includes('~/') || text.includes('../') || text.includes('./')) return true;
  if (text.includes('/') || text.includes('\\')) return true;
  return containsAny(text, ['.go', '.ts', '.md', '.json', '.yaml', '.yml', 'package.json', 'go.mod', 'readme']);
}

function hasUnfulfilledActionCommitment(text: string): boolean {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!normalized) return false;
  if (!containsAny(normalized, commitmentPhrases)) return false;
  if (containsAny(normalized, actionPhrases)) return true;
  if (hasPathHint(normalized)) return true;
  return false;
}

function buildUserContent(text: string, atts: RunStartParams['input']['attachments']): string {
  const t = String(text ?? '').trim();
  const parts: string[] = [];
  if (t) parts.push(t);

  const attachments = Array.isArray(atts) ? atts : [];
  for (const a of attachments) {
    const name = String(a?.name ?? 'attachment');
    const mime = String(a?.mime_type ?? '').trim();
    if (typeof a?.content_utf8 === 'string' && a.content_utf8.trim()) {
      parts.push(`\n\nAttachment (${name}, ${mime || 'text'}):\n\n${a.content_utf8}`);
      continue;
    }
    // Keep binary/image attachments discoverable, even if the model cannot consume them directly.
    parts.push(`\n\nAttachment (${name}${mime ? `, ${mime}` : ''}) is available.`);
  }

  return parts.join('');
}

async function runAgent(params: RunStartParams): Promise<void> {
  const runId = String(params?.run_id ?? '').trim();
  if (!runId) throw new Error('Missing run_id');

  if (currentRun) {
    throw new Error('Run already active');
  }

  const abort = new AbortController();
  currentRun = { runId, abort };
  const workspaceRootAbs = String(params?.workspace_root_abs ?? '').trim();
  const guardEnabled = Boolean(params?.guard?.enabled);
  const guardRequiresTools = Boolean(params?.guard?.requires_tools);
  const guardAttemptIndex = Number.isFinite(Number(params?.guard?.attempt_index))
    ? Number(params?.guard?.attempt_index)
    : 0;
  const guardAutoContinueMax = Number.isFinite(Number(params?.guard?.auto_continue_max))
    ? Number(params?.guard?.auto_continue_max)
    : 0;

  runToolCallCount.set(runId, 0);
  notify('run.phase', { run_id: runId, phase: 'start', diag: { attempt_index: guardAttemptIndex } });
  logEvent('ai.sidecar.run.start', {
    run_id: runId,
    model: String(params?.model ?? '').trim(),
    mode: String(params?.mode ?? 'build').trim() || 'build',
    history_count: Array.isArray(params?.history) ? params.history.length : 0,
    attachment_count: Array.isArray(params?.input?.attachments) ? params.input.attachments.length : 0,
    input_chars: String(params?.input?.text ?? '').trim().length,
    workspace_root_abs: workspaceRootAbs,
    guard_enabled: guardEnabled,
    guard_requires_tools: guardRequiresTools,
    guard_attempt_index: guardAttemptIndex,
    guard_auto_continue_max: guardAutoContinueMax,
  });

  try {
    const model = createModel(String(params.model ?? '').trim(), runId);
    const maxSteps = Math.max(1, Math.min(50, Number(params?.options?.max_steps ?? 10)));

    const mode = String(params?.mode ?? 'build').trim().toLowerCase() === 'plan' ? 'plan' : 'build';
    const workspaceScopeInstruction = workspaceRootAbs
      ? `Workspace root is ${workspaceRootAbs}. Only use absolute paths inside this root for fs.* and terminal_exec.cwd.`
      : 'Workspace root is not provided. Use absolute paths for fs.* and terminal_exec.cwd, and avoid paths outside workspace.';
    const modeInstruction =
      mode === 'plan'
        ? 'You are running in PLAN mode. Do not request mutating tools such as fs_write_file or terminal_exec.'
        : 'You are running in BUILD mode. When the user asks to inspect files or run shell commands, you must call tools instead of guessing.';
    const systemPrompt =
      'You are an AI agent inside the Redeven Env App. ' +
      'Respect permissions and never exfiltrate secrets. ' +
      modeInstruction + ' ' +
      workspaceScopeInstruction +
      ' If a tool fails and the payload includes suggested_fixes or normalized_args, you must follow them and retry once when safe before giving up.';

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    for (const h of params.history || []) {
      const role = h?.role === 'assistant' ? 'assistant' : 'user';
      const text = String(h?.text ?? '');
      if (text.trim()) {
        messages.push({ role, content: text });
      }
    }

    const userText = buildUserContent(params?.input?.text ?? '', params?.input?.attachments);
    messages.push({ role: 'user', content: userText });

    const tools = {
      // NOTE: OpenAI tool/function names must match `^[a-zA-Z0-9_-]+$` (no dots).
      // Keep the Go-side tool names stable (e.g. "fs.list_dir") and only sanitize the
      // OpenAI-exposed function names here.
      fs_list_dir: tool({
        description: 'List directory entries for an absolute path inside workspace root.',
        inputSchema: z.object({ path: z.string() }),
        execute: async (a: any) => executeTool(runId, 'fs.list_dir', a),
      }),
      fs_stat: tool({
        description: 'Get file/directory metadata for an absolute path inside workspace root.',
        inputSchema: z.object({ path: z.string() }),
        execute: async (a: any) => executeTool(runId, 'fs.stat', a),
      }),
      fs_read_file: tool({
        description: 'Read a UTF-8 text file using an absolute path inside workspace root.',
        inputSchema: z.object({
          path: z.string(),
          offset: z.number().int().nonnegative().default(0),
          max_bytes: z.number().int().positive().max(200_000).default(200_000),
        }),
        execute: async (a: any) => executeTool(runId, 'fs.read_file', a),
      }),
      fs_write_file: tool({
        description: 'Write a UTF-8 text file to an absolute path inside workspace root (requires explicit user approval).',
        inputSchema: z.object({
          path: z.string(),
          content_utf8: z.string(),
          create: z.boolean().default(false),
          if_match_sha256: z.string().optional().default(''),
        }),
        execute: async (a: any) => executeTool(runId, 'fs.write_file', a),
      }),
      terminal_exec: tool({
        description: 'Execute a shell command (requires explicit user approval) with cwd as an absolute path inside workspace root.',
        inputSchema: z.object({
          command: z.string(),
          cwd: z.string().default(workspaceRootAbs || '/'),
          timeout_ms: z.number().int().positive().max(60_000).default(60_000),
        }),
        execute: async (a: any) => executeTool(runId, 'terminal.exec', a),
      }),
    };

    notify('run.phase', { run_id: runId, phase: 'planning' });

    const result = await streamText({
      model,
      messages,
      tools,
      maxSteps,
      abortSignal: abort.signal,
    } as any);

    let emitted = '';
    let deltaCount = 0;
    for await (const delta of result.textStream) {
      if (typeof delta !== 'string') {
        logEvent('ai.sidecar.stream.delta.unexpected_type', { run_id: runId, delta_type: typeof delta });
        continue;
      }
      if (!delta) continue;
      emitted += delta;
      deltaCount += 1;
      logEvent('ai.sidecar.stream.delta', { run_id: runId, delta_len: delta.length, delta_count: deltaCount });
      emitTextDelta(runId, delta);
    }

    notify('run.phase', { run_id: runId, phase: 'synthesis' });

    // Some providers/models may not produce any streaming chunks but still return a final text.
    const finalText = await result.text;
    if (typeof finalText === 'string' && finalText) {
      if (!emitted) {
        emitTextDelta(runId, finalText);
      } else if (finalText.length > emitted.length && finalText.startsWith(emitted)) {
        emitTextDelta(runId, finalText.slice(emitted.length));
      } else if (!finalText.startsWith(emitted)) {
        logEvent('ai.sidecar.stream.mismatch', { run_id: runId, emitted_chars: emitted.length, final_chars: finalText.length });
      }
    }

    const toolCalls = runToolCallCount.get(runId) ?? 0;
    const synthesizedText = (typeof finalText === 'string' && finalText.trim()) ? finalText : emitted;
    if (guardEnabled) {
      let guardStatus = 'pass';
      let guardReason = '';
      if (toolCalls === 0) {
        if (guardRequiresTools) {
          guardStatus = 'triggered';
          guardReason = 'tool_required_intent_without_tool_call';
        } else if (hasUnfulfilledActionCommitment(synthesizedText)) {
          guardStatus = 'triggered';
          guardReason = 'assistant_promised_action_without_tool_call';
        }
      }
      notify('turn.guard', {
        run_id: runId,
        status: guardStatus,
        reason: guardReason,
        attempt: guardAttemptIndex,
        diag: {
          tool_calls: toolCalls,
          requires_tools: guardRequiresTools,
        },
      });
      logEvent('ai.sidecar.guard', {
        run_id: runId,
        status: guardStatus,
        reason: guardReason,
        tool_calls: toolCalls,
        attempt_index: guardAttemptIndex,
      });
    }

    notify('run.phase', { run_id: runId, phase: 'end', diag: { tool_calls: toolCalls } });
    logEvent('ai.sidecar.run.end', {
      run_id: runId,
      emitted_chars: emitted.length,
      delta_count: deltaCount,
      tool_calls: toolCalls,
    });
    notify('run.end', { run_id: runId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notify('run.phase', { run_id: runId, phase: 'error', diag: { error: msg } });
    logEvent('ai.sidecar.run.error', { run_id: runId, error: msg });
    notify('run.error', { run_id: runId, error: msg });
  } finally {
    currentRun = null;
    runToolCallCount.delete(runId);
  }
}

function handleToolResult(params: any) {
  const toolId = String(params?.tool_id ?? '').trim();
  if (!toolId) return;

  const waiter = toolWaiters.get(toolId);
  if (!waiter) {
    logEvent('ai.sidecar.tool.result.orphan', { run_id: String(params?.run_id ?? currentRun?.runId ?? '').trim(), tool_id: toolId });
    return;
  }
  toolWaiters.delete(toolId);

  const status = String(params?.status ?? '').trim().toLowerCase();
  if (status === 'success') {
    logEvent('ai.sidecar.tool.result.recv', {
      run_id: String(params?.run_id ?? currentRun?.runId ?? '').trim(),
      tool_id: toolId,
      status,
      result_preview: previewForLog(redactForLog('result', params?.result), 280),
    });
    waiter.resolve({ status: 'success', result: params?.result });
    return;
  }

  if (status === 'error' || status === 'recovering') {
    const err = normalizeToolErrorPayload(params?.error ?? {});
    logEvent('ai.sidecar.tool.result.recv', {
      run_id: String(params?.run_id ?? currentRun?.runId ?? '').trim(),
      tool_id: toolId,
      status,
      error_code: err.code,
      error: err.message,
      normalized_args_preview: previewForLog(redactForLog('normalized_args', err.normalized_args), 200),
    });
    waiter.resolve({ status: status as 'error' | 'recovering', error: err });
    return;
  }

  // Backward compatibility for older Go-side payloads during rolling rebuild.
  const ok = Boolean(params?.ok);
  if (ok) {
    waiter.resolve({ status: 'success', result: params?.result });
    return;
  }
  const errMsg = String(params?.error ?? 'Tool failed').trim() || 'Tool failed';
  waiter.resolve({
    status: 'error',
    error: {
      code: 'UNKNOWN',
      message: errMsg,
      retryable: false,
    },
  });
}

function handleCancel(params: any) {
  const runId = String(params?.run_id ?? '').trim();
  if (!currentRun || currentRun.runId !== runId) return;
  logEvent('ai.sidecar.run.cancel', { run_id: runId });
  currentRun.abort?.abort();
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const raw = String(line ?? '').trim();
  if (!raw) return;

  let msg: JSONRPCEnvelope | null = null;
  try {
    msg = JSON.parse(raw);
  } catch (e) {
    logEvent('ai.sidecar.rpc.invalid_json', { error: String(e) });
    return;
  }
  const method = String(msg?.method ?? '').trim();
  const params = msg?.params ?? null;

  if (!method) return;

  if (method === 'initialize') {
    const list = Array.isArray(params?.providers) ? params.providers : [];
    providers.splice(0, providers.length, ...list);
    logEvent('ai.sidecar.initialize', { provider_count: list.length });
    return;
  }
  if (method === 'run.start') {
    logEvent('ai.sidecar.run.start.received', {
      run_id: String((params as any)?.run_id ?? '').trim(),
    });
    void runAgent(params as RunStartParams);
    return;
  }
  if (method === 'tool.result') {
    handleToolResult(params);
    return;
  }
  if (method === 'run.cancel') {
    handleCancel(params);
    return;
  }
});

process.on('uncaughtException', (e) => {
  const msg = e instanceof Error ? e.stack || e.message : String(e);
  logEvent('ai.sidecar.uncaught_exception', { run_id: String(currentRun?.runId ?? '').trim(), error: msg });

  // Best-effort: report a terminal error to the Go agent so the UI does not hang on EOF.
  const runId = String(currentRun?.runId ?? '').trim();
  if (runId) {
    try {
      notify('run.error', { run_id: runId, error: 'AI sidecar crashed (uncaughtException).' });
    } catch {
      // ignore
    }
  }

  process.exit(1);
});

process.on('unhandledRejection', (e) => {
  const msg = e instanceof Error ? e.stack || e.message : String(e);
  logEvent('ai.sidecar.unhandled_rejection', { run_id: String(currentRun?.runId ?? '').trim(), error: msg });

  // Best-effort: report a terminal error to the Go agent so the UI does not hang on EOF.
  const runId = String(currentRun?.runId ?? '').trim();
  if (runId) {
    try {
      notify('run.error', { run_id: runId, error: 'AI sidecar crashed (unhandledRejection).' });
    } catch {
      // ignore
    }
  }

  process.exit(1);
});
