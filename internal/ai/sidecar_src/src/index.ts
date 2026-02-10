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
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
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
};

const providers: ProviderConfig[] = [];
const toolWaiters = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();

let currentRun: {
  runId: string;
  abort?: AbortController;
} | null = null;

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

async function callTool(runId: string, toolName: string, args: any): Promise<any> {
  const toolId = `tc_${randomUUID()}`;
  logEvent('ai.sidecar.tool.call.emit', {
    run_id: runId,
    tool_id: toolId,
    tool_name: toolName,
    args_preview: previewForLog(redactForLog('args', args), 320),
  });
  notify('tool.call', { run_id: runId, tool_id: toolId, tool_name: toolName, args });

  return await new Promise<any>((resolve, reject) => {
    toolWaiters.set(toolId, { resolve, reject });
    // Safety: avoid leaking waiters forever if something goes wrong.
    setTimeout(() => {
      const w = toolWaiters.get(toolId);
      if (!w) return;
      toolWaiters.delete(toolId);
      logEvent('ai.sidecar.tool.call.timeout', { run_id: runId, tool_id: toolId, tool_name: toolName });
      reject(new Error('Tool call timed out'));
    }, 10 * 60 * 1000);
  });
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
  logEvent('ai.sidecar.run.start', {
    run_id: runId,
    model: String(params?.model ?? '').trim(),
    history_count: Array.isArray(params?.history) ? params.history.length : 0,
    attachment_count: Array.isArray(params?.input?.attachments) ? params.input.attachments.length : 0,
    input_chars: String(params?.input?.text ?? '').trim().length,
  });

  try {
    const model = createModel(String(params.model ?? '').trim(), runId);
    const maxSteps = Math.max(1, Math.min(50, Number(params?.options?.max_steps ?? 10)));

    const systemPrompt =
      'You are an AI agent inside the Redeven Env App. ' +
      'Use tools only when necessary, respect permissions, and never exfiltrate secrets.';

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
        description: 'List directory entries.',
        inputSchema: z.object({ path: z.string() }),
        execute: async (a: any) => callTool(runId, 'fs.list_dir', a),
      }),
      fs_stat: tool({
        description: 'Get file/directory metadata (size, mtime, sha256).',
        inputSchema: z.object({ path: z.string() }),
        execute: async (a: any) => callTool(runId, 'fs.stat', a),
      }),
      fs_read_file: tool({
        description: 'Read a UTF-8 text file (with offset and size cap).',
        inputSchema: z.object({
          path: z.string(),
          offset: z.number().int().nonnegative().default(0),
          max_bytes: z.number().int().positive().max(200_000).default(200_000),
        }),
        execute: async (a: any) => callTool(runId, 'fs.read_file', a),
      }),
      fs_write_file: tool({
        description: 'Write a UTF-8 text file (requires explicit user approval).',
        inputSchema: z.object({
          path: z.string(),
          content_utf8: z.string(),
          create: z.boolean().default(false),
          if_match_sha256: z.string().optional().default(''),
        }),
        execute: async (a: any) => callTool(runId, 'fs.write_file', a),
      }),
      terminal_exec: tool({
        description: 'Execute a shell command (requires explicit user approval).',
        inputSchema: z.object({
          command: z.string(),
          cwd: z.string().default('/'),
          timeout_ms: z.number().int().positive().max(60_000).default(60_000),
        }),
        execute: async (a: any) => callTool(runId, 'terminal.exec', a),
      }),
    };

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

    logEvent('ai.sidecar.run.end', { run_id: runId, emitted_chars: emitted.length, delta_count: deltaCount });
    notify('run.end', { run_id: runId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logEvent('ai.sidecar.run.error', { run_id: runId, error: msg });
    notify('run.error', { run_id: runId, error: msg });
  } finally {
    currentRun = null;
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

  const ok = Boolean(params?.ok);
  logEvent('ai.sidecar.tool.result.recv', {
    run_id: String(params?.run_id ?? currentRun?.runId ?? '').trim(),
    tool_id: toolId,
    ok,
    error: ok ? '' : String(params?.error ?? 'Tool failed'),
    result_preview: ok ? previewForLog(redactForLog('result', params?.result), 280) : '',
  });
  if (ok) {
    waiter.resolve(params?.result);
    return;
  }
  const errMsg = String(params?.error ?? 'Tool failed');
  waiter.reject(new Error(errMsg));
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
