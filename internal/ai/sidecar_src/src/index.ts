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

function log(...args: any[]) {
  process.stderr.write(`[ai-sidecar] ${args.map(String).join(' ')}\n`);
}

function send(msg: JSONRPCEnvelope) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function notify(method: string, params: any) {
  send({ jsonrpc: '2.0', method, params });
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

function createModel(modelId: string) {
  const { providerId, modelName } = parseModel(modelId);
  const p = getProvider(providerId);
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
  notify('tool.call', { run_id: runId, tool_id: toolId, tool_name: toolName, args });

  return await new Promise<any>((resolve, reject) => {
    toolWaiters.set(toolId, { resolve, reject });
    // Safety: avoid leaking waiters forever if something goes wrong.
    setTimeout(() => {
      const w = toolWaiters.get(toolId);
      if (!w) return;
      toolWaiters.delete(toolId);
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

  try {
    const model = createModel(String(params.model ?? '').trim());
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
      'fs.list_dir': tool({
        description: 'List directory entries.',
        parameters: z.object({ path: z.string() }),
        execute: async (a: any) => callTool(runId, 'fs.list_dir', a),
      }),
      'fs.stat': tool({
        description: 'Get file/directory metadata (size, mtime, sha256).',
        parameters: z.object({ path: z.string() }),
        execute: async (a: any) => callTool(runId, 'fs.stat', a),
      }),
      'fs.read_file': tool({
        description: 'Read a UTF-8 text file (with offset and size cap).',
        parameters: z.object({
          path: z.string(),
          offset: z.number().int().nonnegative().default(0),
          max_bytes: z.number().int().positive().max(200_000).default(200_000),
        }),
        execute: async (a: any) => callTool(runId, 'fs.read_file', a),
      }),
      'fs.write_file': tool({
        description: 'Write a UTF-8 text file (requires explicit user approval).',
        parameters: z.object({
          path: z.string(),
          content_utf8: z.string(),
          create: z.boolean().default(false),
          if_match_sha256: z.string().optional().default(''),
        }),
        execute: async (a: any) => callTool(runId, 'fs.write_file', a),
      }),
      'terminal.exec': tool({
        description: 'Execute a shell command (requires explicit user approval).',
        parameters: z.object({
          command: z.string(),
          cwd: z.string(),
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

    for await (const delta of result.textStream) {
      if (!delta) continue;
      notify('run.delta', { run_id: runId, delta });
    }

    notify('run.end', { run_id: runId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    notify('run.error', { run_id: runId, error: msg });
  } finally {
    currentRun = null;
  }
}

function handleToolResult(params: any) {
  const toolId = String(params?.tool_id ?? '').trim();
  if (!toolId) return;

  const waiter = toolWaiters.get(toolId);
  if (!waiter) return;
  toolWaiters.delete(toolId);

  const ok = Boolean(params?.ok);
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
    log('invalid json frame', String(e));
    return;
  }
  const method = String(msg?.method ?? '').trim();
  const params = msg?.params ?? null;

  if (!method) return;

  if (method === 'initialize') {
    const list = Array.isArray(params?.providers) ? params.providers : [];
    providers.splice(0, providers.length, ...list);
    return;
  }
  if (method === 'run.start') {
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
  log('uncaughtException', e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});

process.on('unhandledRejection', (e) => {
  log('unhandledRejection', e instanceof Error ? e.stack || e.message : String(e));
  process.exit(1);
});

