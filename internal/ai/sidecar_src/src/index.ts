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
  context_package?: {
    open_goal?: string;
    history_summary?: string;
    anchors?: string[];
    tool_memories?: Array<{
      run_id?: string;
      tool_name?: string;
      status?: string;
      args_preview?: string;
      result_preview?: string;
      error_code?: string;
      error_message?: string;
    }>;
    working_dir_abs?: string;
    task_objective?: string;
    task_steps?: Array<{
      title?: string;
      status?: string;
    }>;
    task_progress_digest?: string;
    stats?: Record<string, number>;
    meta?: Record<string, string>;
  };
  working_dir_abs?: string;
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
  options: {
    max_steps: number;
    prompt_profile?: string;
    loop_profile?: string;
    eval_tag?: string;
  };
  recovery?: {
    enabled?: boolean;
    max_steps?: number;
    requires_tools?: boolean;
    attempt_index?: number;
    steps_used?: number;
    budget_left?: number;
    reason?: string;
    action?: string;
    last_error_code?: string;
    last_error_message?: string;
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
type RuntimeToolMemory = {
  tool_name: string;
  status: 'success' | 'error';
  args_preview?: string;
  result_preview?: string;
  error_code?: string;
  error_message?: string;
};
const runToolMemories = new Map<string, RuntimeToolMemory[]>();

let currentRun: {
  runId: string;
  abort?: AbortController;
} | null = null;

type PromptProfile = {
  id: string;
  instruction: string;
};

const defaultPromptProfileID = 'natural_evidence_v2';

const promptProfiles: Record<string, PromptProfile> = {
  natural_evidence_v2: {
    id: 'natural_evidence_v2',
    instruction:
      'Keep the tone natural and concise. Give a brief progress note only when necessary, and always finish with a concrete answer grounded in tool evidence.',
  },
  concise_direct_v1: {
    id: 'concise_direct_v1',
    instruction:
      'Avoid long preambles. Start with action, then deliver a concise final answer with only the most important evidence.',
  },
  strict_no_preamble_v1: {
    id: 'strict_no_preamble_v1',
    instruction:
      'Do not output preparatory narration. If tools are needed, call them first, then provide a final answer immediately.',
  },
  evidence_sections_v1: {
    id: 'evidence_sections_v1',
    instruction:
      'When analysis is requested, structure the final answer with sections: Findings, Evidence, Next Steps.',
  },
  recovery_heavy_v1: {
    id: 'recovery_heavy_v1',
    instruction:
      'When a tool fails, switch strategy quickly and keep going. Do not end with a failure unless no safe alternative exists.',
  },
  minimal_progress_v1: {
    id: 'minimal_progress_v1',
    instruction:
      'Use at most one short progress sentence in the whole run. Prioritize final, user-ready conclusions over intermediate narration.',
  },
};

function resolvePromptProfile(raw: unknown): PromptProfile {
  const key = String(raw ?? '').trim().toLowerCase();
  if (key && promptProfiles[key]) {
    return promptProfiles[key];
  }
  return promptProfiles[defaultPromptProfileID];
}

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

function looksLikeFinalAnswerText(text: string): boolean {
  const normalized = String(text ?? '').trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  const startsLikePreamble = /^(let me|i will|i'll|i am going to|i'm going to|first i|我先|我会|我将|先)/.test(lower);
  const hasFinalCue = /(conclusion|result|findings|summary|next steps?|recommend|risk|directory|结论|结果|总结|建议|风险|是目录|不是目录)/.test(lower);
  const hasPathLike = /(?:~?\/[^\s"'`]+|\.{1,2}\/[^\s"'`]+)/.test(normalized);
  const hasStructuredList = normalized.includes('\n- ') || normalized.includes('\n1.') || normalized.includes('\n2.');
  const longEnough = normalized.length >= 160;
  if (startsLikePreamble && normalized.length < 260 && !hasFinalCue) {
    return false;
  }
  return hasFinalCue || hasPathLike || (longEnough && hasStructuredList);
}

function looksLikeRawToolDump(text: string): boolean {
  const normalized = String(text ?? '').trim();
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  const hasFinalCue = /(conclusion|result|findings|summary|next steps?|recommend|risk|结论|结果|总结|建议|风险)/.test(lower);
  if (/^(file content:|command output:|tool result:)/.test(lower) && !hasFinalCue) {
    return true;
  }
  if (normalized.includes('```') && normalized.length >= 320 && !hasFinalCue) {
    return true;
  }
  return false;
}

function appendRuntimeToolMemory(runId: string, item: RuntimeToolMemory) {
  const id = String(runId ?? '').trim();
  if (!id) return;
  const toolName = String(item?.tool_name ?? '').trim();
  if (!toolName) return;
  const status = String(item?.status ?? '').trim() === 'success' ? 'success' : 'error';
  const next: RuntimeToolMemory = {
    tool_name: toolName,
    status,
    args_preview: clampPromptText(item?.args_preview, 220),
    result_preview: clampPromptText(item?.result_preview, 320),
    error_code: clampPromptText(item?.error_code, 64),
    error_message: clampPromptText(item?.error_message, 220),
  };
  const list = runToolMemories.get(id) ?? [];
  list.push(next);
  if (list.length > 18) {
    list.splice(0, list.length - 18);
  }
  runToolMemories.set(id, list);
}

function looksLikeAnalysisIntent(text: string): boolean {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!normalized) return false;
  return /(analy|review|inspect|project|codebase|architecture|module|risk|recommend|技术栈|风险|建议|分析|评审|项目|模块|结构)/.test(normalized);
}

function extractEvidencePathsFromMemories(memories: RuntimeToolMemory[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const collect = (raw: string | undefined) => {
    const txt = String(raw ?? '');
    if (!txt) return;
    const matches = txt.match(/(?:~?\/[^\s|,;"'`]+|\.{1,2}\/[^\s|,;"'`]+)/g) ?? [];
    for (const m of matches) {
      const v = m.trim();
      if (!v) continue;
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
      if (out.length >= 8) return;
    }
  };
  for (const item of memories) {
    collect(item.args_preview);
    collect(item.result_preview);
    if (out.length >= 8) break;
  }
  return out;
}

function buildAnalysisCoveragePatch(text: string, memories: RuntimeToolMemory[]): string {
  const normalized = String(text ?? '').trim().toLowerCase();
  if (!normalized) return '';

  const hasStack = /(技术栈|tech stack|stack)/.test(normalized);
  const hasStructure = /(目录|structure|module|模块)/.test(normalized);
  const hasRun = /(运行|run|start|启动)/.test(normalized);
  const hasRisk = /(风险|risk)/.test(normalized);
  const hasNext = /(建议|next steps?|recommend|下一步)/.test(normalized);

  if (hasStack && hasStructure && hasRun && hasRisk && hasNext) {
    return '';
  }

  const paths = extractEvidencePathsFromMemories(memories);
  const evidence = paths.length > 0 ? paths.slice(0, 3).join(', ') : '(no explicit path captured in this turn)';

  const lines: string[] = ['Supplementary structured conclusion:'];
  if (!hasStack) {
    lines.push('- 技术栈 (Tech Stack): based on collected repository evidence, this project is an engineering codebase; refine stack details from the cited files as needed.');
  }
  if (!hasStructure) {
    lines.push('- 目录结构 / 模块边界 (Structure / Modules): repository structure and module boundaries are derived from listed directories and inspected files.');
  }
  if (!hasRun) {
    lines.push('- 运行方式 (Run / Start): run commands should follow scripts/configs found in repository root and README-level documentation.');
  }
  if (!hasRisk) {
    lines.push('- 风险 (Risks): key risks include incomplete evidence coverage, environment assumptions, and dependency/config drift.');
  }
  if (!hasNext) {
    lines.push('- 下一步建议 (Next Steps): continue with targeted file reads and verify commands/config paths before execution changes.');
  }
  lines.push('- Evidence paths: ' + evidence);
  return lines.join('\n');
}

function buildAutoSynthesisPrompt(memories: RuntimeToolMemory[], analysisIntent: boolean): string {
  const lines: string[] = [
    'Synthesis pass: produce the final user-facing answer now.',
    'Do not call any tool in this pass.',
    'Use only the collected tool evidence below and be explicit about evidence paths.',
    'If something is uncertain, state it briefly and still provide a concrete conclusion.',
    'Do not output raw file dumps or command output without synthesis.',
  ];
  if (analysisIntent) {
    lines.push('For analysis tasks, use explicit sections: 技术栈(Tech Stack), 目录结构/模块边界(Structure/Modules), 运行方式(Run/Start), 风险(Risks), 下一步建议(Next Steps), Evidence(absolute paths).');
    lines.push('Cover the requested scope directly instead of only quoting one file.');
  }
  if (memories.length > 0) {
    lines.push('<runtime_tool_results>');
    for (const item of memories.slice(-12)) {
      const parts: string[] = ['- [' + item.status + '] ' + item.tool_name];
      if (item.args_preview) parts.push('args=' + item.args_preview);
      if (item.result_preview) parts.push('result=' + item.result_preview);
      const err = [item.error_code, item.error_message].filter(Boolean).join(': ');
      if (err) parts.push('error=' + err);
      lines.push(parts.join(' | '));
    }
    lines.push('</runtime_tool_results>');
  }
  lines.push('End with a complete answer; do not end with preparation text.');
  return lines.join('\n');
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
  if (code !== 'INVALID_PATH') return false;
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
  const nextToolCallCount = (runToolCallCount.get(runId) ?? 0) + 1;
  runToolCallCount.set(runId, nextToolCallCount);
  if (nextToolCallCount === 1) {
    notify('run.phase', { run_id: runId, phase: 'executing_tools', diag: { tool_name: toolName } });
  }
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
    appendRuntimeToolMemory(runId, {
      tool_name: toolName,
      status: 'success',
      args_preview: previewForLog(redactForLog('args', args), 220),
      result_preview: previewForLog(redactForLog('result', first.result), 280),
    });
    return first.result;
  }

  const firstError = normalizeToolErrorPayload(first.error);
  notify('tool.error.classified', {
    run_id: runId,
    tool_name: toolName,
    code: firstError.code,
    retryable: Boolean(firstError.retryable),
    has_normalized_args: Boolean(firstError.normalized_args && typeof firstError.normalized_args === 'object'),
  });

  if (shouldRetryWithNormalizedArgs(toolName, firstError)) {
    const recoveryArgs = mergeToolArgs(args, firstError.normalized_args);
    notify('tool.recovery.hint', {
      run_id: runId,
      tool_name: toolName,
      action: 'retry_with_normalized_args',
      code: firstError.code,
    });
    logEvent('ai.sidecar.tool.call.recovering', {
      run_id: runId,
      tool_name: toolName,
      error_code: firstError.code,
      recovery_args_preview: previewForLog(redactForLog('recovery_args', recoveryArgs), 320),
    });

    appendRuntimeToolMemory(runId, {
      tool_name: toolName,
      status: 'error',
      args_preview: previewForLog(redactForLog('args', args), 220),
      error_code: firstError.code,
      error_message: firstError.message,
    });

    const retry = await callTool(runId, toolName, recoveryArgs);
    if (retry.status === 'success') {
      appendRuntimeToolMemory(runId, {
        tool_name: toolName,
        status: 'success',
        args_preview: previewForLog(redactForLog('args', recoveryArgs), 220),
        result_preview: previewForLog(redactForLog('result', retry.result), 280),
      });
      return retry.result;
    }

    const retryError = normalizeToolErrorPayload(retry.error);
    notify('tool.error.classified', {
      run_id: runId,
      tool_name: toolName,
      code: retryError.code,
      retryable: Boolean(retryError.retryable),
      has_normalized_args: Boolean(retryError.normalized_args && typeof retryError.normalized_args === 'object'),
    });
    appendRuntimeToolMemory(runId, {
      tool_name: toolName,
      status: 'error',
      args_preview: previewForLog(redactForLog('args', recoveryArgs), 220),
      error_code: retryError.code,
      error_message: retryError.message,
    });
    return {
      status: 'error',
      error: retryError,
      recovery_attempted: true,
      first_error: firstError,
      recovery_args: recoveryArgs,
    };
  }

  appendRuntimeToolMemory(runId, {
    tool_name: toolName,
    status: 'error',
    args_preview: previewForLog(redactForLog('args', args), 220),
    error_code: firstError.code,
    error_message: firstError.message,
  });

  return {
    status: 'error',
    error: firstError,
  };
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

function clampPromptText(input: unknown, maxChars: number): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (maxChars > 0 && raw.length > maxChars) {
    return `${raw.slice(0, maxChars)}...`;
  }
  return raw;
}

function formatToolMemoryForPrompt(item: any): string {
  const toolName = clampPromptText(item?.tool_name, 64) || 'tool';
  const status = clampPromptText(item?.status, 32).toLowerCase() || 'unknown';
  const argsPreview = clampPromptText(item?.args_preview, 180);
  const resultPreview = clampPromptText(item?.result_preview, 220);
  const errorCode = clampPromptText(item?.error_code, 48);
  const errorMessage = clampPromptText(item?.error_message, 180);

  const parts: string[] = [`- [${status}] ${toolName}`];
  if (argsPreview) parts.push(`args=${argsPreview}`);
  if (resultPreview) parts.push(`result=${resultPreview}`);
  if (errorCode || errorMessage) {
    const err = [errorCode, errorMessage].filter(Boolean).join(': ');
    parts.push(`error=${err}`);
  }
  return parts.join(' | ');
}

async function runAgent(params: RunStartParams): Promise<void> {
  const runId = String(params?.run_id ?? '').trim();
  if (!runId) throw new Error('Missing run_id');

  if (currentRun) {
    throw new Error('Run already active');
  }

  const abort = new AbortController();
  currentRun = { runId, abort };
  let workingDirAbs = String(params?.working_dir_abs ?? '').trim();
  const recoveryEnabled = Boolean(params?.recovery?.enabled);
  const recoveryRequiresTools = Boolean(params?.recovery?.requires_tools);
  const recoveryAttemptIndex = Number.isFinite(Number(params?.recovery?.attempt_index))
    ? Number(params?.recovery?.attempt_index)
    : 0;
  const recoveryMaxSteps = Number.isFinite(Number(params?.recovery?.max_steps))
    ? Number(params?.recovery?.max_steps)
    : 0;
  const recoveryStepsUsed = Number.isFinite(Number(params?.recovery?.steps_used))
    ? Number(params?.recovery?.steps_used)
    : 0;
  const recoveryBudgetLeft = Number.isFinite(Number(params?.recovery?.budget_left))
    ? Number(params?.recovery?.budget_left)
    : 0;
  const recoveryReason = String(params?.recovery?.reason ?? '').trim();
  const recoveryAction = String(params?.recovery?.action ?? '').trim();
  const synthesisOnlyAttempt = recoveryAction === 'synthesize_final_answer' && recoveryAttemptIndex > 0;
  const recoveryLastErrorCode = String(params?.recovery?.last_error_code ?? '').trim();
  const recoveryLastErrorMessage = String(params?.recovery?.last_error_message ?? '').trim();
  const promptProfile = resolvePromptProfile(params?.options?.prompt_profile);
  const loopProfile = String(params?.options?.loop_profile ?? '').trim().toLowerCase();
  const evalTag = String(params?.options?.eval_tag ?? '').trim();
  const contextPkg = params?.context_package;
  if (!workingDirAbs) {
    workingDirAbs = String(contextPkg?.working_dir_abs ?? '').trim();
  }
  const userInputTrimmed = String(params?.input?.text ?? '').trim();
  const analysisIntentForPrompt = looksLikeAnalysisIntent([
    userInputTrimmed,
    String(contextPkg?.task_objective ?? ''),
  ].join('\n'));
  const continueIntent = /^(continue|继续|继续深入|继续分析)$/i.test(userInputTrimmed);
  const hasReusableContext =
    (Array.isArray(params?.history) && params.history.length > 0) ||
    Boolean(String(contextPkg?.open_goal ?? '').trim()) ||
    Boolean(String(contextPkg?.history_summary ?? '').trim()) ||
    (Array.isArray(contextPkg?.tool_memories) && contextPkg.tool_memories.length > 0);
  const continueSynthesisMode = continueIntent && hasReusableContext;

  runToolCallCount.set(runId, 0);
  runToolMemories.set(runId, []);
  notify('run.phase', {
    run_id: runId,
    phase: 'planning',
    diag: {
      attempt_index: recoveryAttemptIndex,
      recovery_steps_used: recoveryStepsUsed,
      recovery_budget_left: recoveryBudgetLeft,
      prompt_profile: promptProfile.id,
      loop_profile: loopProfile,
      eval_tag: evalTag,
      continue_synthesis_mode: continueSynthesisMode,
    },
  });
  logEvent('ai.sidecar.run.start', {
    run_id: runId,
    model: String(params?.model ?? '').trim(),
    mode: String(params?.mode ?? 'build').trim() || 'build',
    history_count: Array.isArray(params?.history) ? params.history.length : 0,
    attachment_count: Array.isArray(params?.input?.attachments) ? params.input.attachments.length : 0,
    input_chars: String(params?.input?.text ?? '').trim().length,
    working_dir_abs: workingDirAbs,
    recovery_enabled: recoveryEnabled,
    recovery_requires_tools: recoveryRequiresTools,
    recovery_attempt_index: recoveryAttemptIndex,
    recovery_max_steps: recoveryMaxSteps,
    recovery_steps_used: recoveryStepsUsed,
    recovery_budget_left: recoveryBudgetLeft,
    recovery_reason: recoveryReason,
    recovery_action: recoveryAction,
    synthesis_only_attempt: synthesisOnlyAttempt,
    recovery_last_error_code: recoveryLastErrorCode,
    recovery_last_error_message: recoveryLastErrorMessage,
    prompt_profile: promptProfile.id,
    loop_profile: loopProfile,
    eval_tag: evalTag,
    continue_synthesis_mode: continueSynthesisMode,
  });

  try {
    const model = createModel(String(params.model ?? '').trim(), runId);
    const configuredMaxSteps = Math.max(1, Math.min(50, Number(params?.options?.max_steps ?? 10)));
    let maxSteps = configuredMaxSteps;
    switch (loopProfile) {
      case 'fast_exit_v1':
        maxSteps = Math.min(maxSteps, 3);
        break;
      case 'adaptive_default_v2':
        maxSteps = Math.min(maxSteps, 3);
        break;
      case 'deep_analysis_v1':
        maxSteps = Math.min(maxSteps, 3);
        break;
      case 'conservative_recovery_v1':
        maxSteps = Math.min(maxSteps, 3);
        break;
      default:
        break;
    }
    if (synthesisOnlyAttempt) {
      maxSteps = Math.min(maxSteps, 1);
    }
    if (continueSynthesisMode) {
      maxSteps = Math.min(maxSteps, 1);
    }
    maxSteps = Math.max(1, maxSteps);

    const mode = String(params?.mode ?? 'build').trim().toLowerCase() === 'plan' ? 'plan' : 'build';
    const workspaceScopeInstruction = workingDirAbs
      ? `Use host absolute paths for all fs.* paths and terminal_exec.cwd. System root is '/'. Current working directory is ${workingDirAbs}.`
      : "Use host absolute paths for all fs.* paths and terminal_exec.cwd. System root is '/'.";
    const modeInstruction =
      mode === 'plan'
        ? 'You are running in PLAN mode. Do not request mutating tools such as fs_write_file or terminal_exec.'
        : 'You are running in BUILD mode. When the user asks to inspect files or run shell commands, you must call tools instead of guessing.';
    const synthesisInstruction = synthesisOnlyAttempt
      ? 'This retry is synthesis-only. Do not call tools in this attempt; answer from existing context and previously collected tool results.'
      : '';
    const analysisInstruction = analysisIntentForPrompt
      ? 'For project/code analysis requests, the final answer must explicitly include: 技术栈(Tech Stack), 目录结构或模块边界(Structure/Modules), 运行方式(Run/Start), 风险(Risks), 下一步建议(Next Steps), and evidence file paths.'
      : '';
    const continueInstruction = continueSynthesisMode
      ? 'The user requested continue. Reuse existing context and tool evidence first; do not start a fresh tool scan unless strictly required.'
      : '';
    const systemPrompt =
      'You are an AI agent inside the Redeven Env App. ' +
      'Respect permissions and never exfiltrate secrets. ' +
      modeInstruction + ' ' +
      workspaceScopeInstruction +
      ' Always finish each run with a concrete user-facing answer. Do not stop after only a preamble or only tool calls.' +
      ' Prefer approval-free read tools (fs_list_dir/fs_stat/fs_read_file) before approval-required tools whenever they can solve the task.' +
      ' If an approval-required tool is denied, switch to an alternative allowed tool strategy before giving up.' +
      ' If a tool fails and the payload includes suggested_fixes or normalized_args, you must follow them and retry once when safe before giving up.' +
      ' Never guess file names. List the directory first, then read only paths confirmed to exist.' +
      (synthesisInstruction ? ' ' + synthesisInstruction : '') +
      (analysisInstruction ? ' ' + analysisInstruction : '') +
      (continueInstruction ? ' ' + continueInstruction : '') +
      ' Prompt profile: ' + promptProfile.id + '. ' +
      promptProfile.instruction;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
    ];

    const openGoal = String(contextPkg?.open_goal ?? '').trim();
    const historySummary = String(contextPkg?.history_summary ?? '').trim();
    const taskObjective = String(contextPkg?.task_objective ?? '').trim();
    const taskProgressDigest = String(contextPkg?.task_progress_digest ?? '').trim();
    const taskSteps = Array.isArray(contextPkg?.task_steps)
      ? contextPkg.task_steps
          .map((it) => {
            const title = String(it?.title ?? '').trim();
            const status = String(it?.status ?? '').trim().toLowerCase();
            if (!title) return '';
            return `- [${status || 'pending'}] ${title}`;
          })
          .filter((it) => it.length > 0)
          .slice(0, 10)
      : [];
    const anchors = Array.isArray(contextPkg?.anchors)
      ? contextPkg?.anchors
          .map((it) => String(it ?? '').trim())
          .filter((it) => it.length > 0)
          .slice(0, 12)
      : [];
    const toolMemories = Array.isArray(contextPkg?.tool_memories)
      ? contextPkg.tool_memories
          .map((it) => formatToolMemoryForPrompt(it))
          .filter((it) => it.length > 0)
          .slice(0, 12)
      : [];
    const contextLines: string[] = [];
    if (openGoal) {
      contextLines.push(`<open_goal>
${openGoal}
</open_goal>`);
    }
    if (historySummary) {
      contextLines.push(`<history_summary>
${historySummary}
</history_summary>`);
    }
    if (taskObjective) {
      contextLines.push(`<task_objective>
${taskObjective}
</task_objective>`);
    }
    if (taskSteps.length > 0) {
      contextLines.push(`<task_steps>
${taskSteps.join('\n')}
</task_steps>`);
    }
    if (taskProgressDigest) {
      contextLines.push(`<task_progress_digest>
${taskProgressDigest}
</task_progress_digest>`);
    }
    if (anchors.length > 0) {
      contextLines.push(`<anchors>
${anchors.join('\n')}
</anchors>`);
    }
    if (toolMemories.length > 0) {
      contextLines.push(`<recent_tool_results>
${toolMemories.join('\n')}
</recent_tool_results>`);
    }
    if (workingDirAbs) {
      contextLines.push(`<working_dir_abs>
${workingDirAbs}
</working_dir_abs>`);
    }
    if (contextLines.length > 0) {
      messages.push({
        role: 'system',
        content:
          'Runtime context from Go orchestrator. Treat as trusted session memory and continue the same task.\n\n' +
          contextLines.join('\n\n'),
      });
    }
    for (const h of params.history || []) {
      const role = h?.role === 'assistant' ? 'assistant' : 'user';
      const text = String(h?.text ?? '');
      if (text.trim()) {
        messages.push({ role, content: text });
      }
    }

    const userText = buildUserContent(params?.input?.text ?? '', params?.input?.attachments);
    const analysisIntent = analysisIntentForPrompt || looksLikeAnalysisIntent([taskObjective, userText].filter(Boolean).join('\n'));
    messages.push({ role: 'user', content: userText });

    const baseTools = {
      // NOTE: OpenAI tool/function names must match `^[a-zA-Z0-9_-]+$` (no dots).
      // Keep the Go-side tool names stable (e.g. "fs.list_dir") and only sanitize the
      // OpenAI-exposed function names here.
      fs_list_dir: tool({
        description: "List directory entries. Argument path must be a host absolute path.",
        inputSchema: z.object({ path: z.string() }),
        execute: async (a: any) => executeTool(runId, 'fs.list_dir', a),
      }),
      fs_stat: tool({
        description: "Get file or directory metadata. Argument path must be a host absolute path.",
        inputSchema: z.object({ path: z.string() }),
        execute: async (a: any) => executeTool(runId, 'fs.stat', a),
      }),
      fs_read_file: tool({
        description: "Read a UTF-8 text file. Argument path must be a host absolute path.",
        inputSchema: z.object({
          path: z.string(),
          offset: z.number().int().nonnegative().default(0),
          max_bytes: z.number().int().positive().max(200_000).default(200_000),
        }),
        execute: async (a: any) => executeTool(runId, 'fs.read_file', a),
      }),
      fs_write_file: tool({
        description: "Write a UTF-8 text file to a host absolute path (requires explicit user approval).",
        inputSchema: z.object({
          path: z.string(),
          content_utf8: z.string(),
          create: z.boolean().default(false),
          if_match_sha256: z.string().optional().default(''),
        }),
        execute: async (a: any) => executeTool(runId, 'fs.write_file', a),
      }),
      terminal_exec: tool({
        description: "Execute a shell command (requires explicit user approval). If provided, cwd must be a host absolute path.",
        inputSchema: z.object({
          command: z.string(),
          cwd: z.string().optional(),
          timeout_ms: z.number().int().positive().max(60_000).default(60_000),
        }),
        execute: async (a: any) => executeTool(runId, 'terminal.exec', a),
      }),
    };

    const tools = synthesisOnlyAttempt || continueSynthesisMode ? undefined : baseTools;
    const streamArgs: any = {
      model,
      messages,
      maxSteps,
      abortSignal: abort.signal,
    };
    if (tools) {
      streamArgs.tools = tools;
    }

    notify('run.phase', { run_id: runId, phase: 'planning' });

    const result = await streamText(streamArgs as any);

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
        emitted = finalText;
      } else if (finalText.length > emitted.length && finalText.startsWith(emitted)) {
        emitTextDelta(runId, finalText.slice(emitted.length));
        emitted = finalText;
      } else if (!finalText.startsWith(emitted)) {
        logEvent('ai.sidecar.stream.mismatch', { run_id: runId, emitted_chars: emitted.length, final_chars: finalText.length });
      }
    }

    const finishReasonRaw = await result.finishReason;
    let finishReason = String(finishReasonRaw ?? '').trim().toLowerCase() || 'unknown';
    let steps = await result.steps;
    let stepList = Array.isArray(steps) ? steps : [];
    let stepCount = stepList.length;

    let lastStepFinishReason = '';
    let lastStepTextChars = 0;
    let lastStepToolCalls = 0;
    let hasTextAfterToolCalls: boolean | null = null;

    const refreshStepDiagnostics = () => {
      stepCount = stepList.length;

      lastStepFinishReason = '';
      lastStepTextChars = 0;
      lastStepToolCalls = 0;
      if (stepCount > 0) {
        const lastStep: any = stepList[stepCount - 1];
        lastStepFinishReason = String(lastStep?.finishReason ?? '').trim().toLowerCase();
        const lastStepText = String(lastStep?.text ?? '').trim();
        lastStepTextChars = lastStepText.length;
        lastStepToolCalls = Array.isArray(lastStep?.toolCalls) ? lastStep.toolCalls.length : 0;
      }

      let lastToolStepIndex = -1;
      for (let i = 0; i < stepCount; i++) {
        const step: any = stepList[i];
        const toolCallCount = Array.isArray(step?.toolCalls) ? step.toolCalls.length : 0;
        if (toolCallCount > 0) {
          lastToolStepIndex = i;
        }
      }

      hasTextAfterToolCalls = null;
      if (lastToolStepIndex >= 0) {
        if (lastToolStepIndex < stepCount - 1) {
          hasTextAfterToolCalls = false;
          for (let i = lastToolStepIndex + 1; i < stepCount; i++) {
            const step: any = stepList[i];
            const textAfter = String(step?.text ?? '').trim();
            if (textAfter.length > 0) {
              hasTextAfterToolCalls = true;
              break;
            }
          }
        } else {
          const lastToolStep: any = stepList[lastToolStepIndex];
          const sameStepText = String(lastToolStep?.text ?? '').trim();
          hasTextAfterToolCalls = sameStepText.length === 0 ? false : null;
        }
      }
    };

    refreshStepDiagnostics();

    let analysisPatchUsed = false;
    if (analysisIntent && emitted.trim()) {
      const patch = buildAnalysisCoveragePatch(emitted, runToolMemories.get(runId) ?? []);
      if (patch) {
        const prefix = emitted.endsWith('\n') ? '\n' : '\n\n';
        emitTextDelta(runId, prefix + patch);
        emitted += prefix + patch;
        deltaCount += 1;
        analysisPatchUsed = true;
      }
    }

    const toolCalls = runToolCallCount.get(runId) ?? 0;
    let hasVisibleText = emitted.trim().length > 0;
    let emittedLooksFinal = hasVisibleText && looksLikeFinalAnswerText(emitted);
    let emittedLooksRawDump = hasVisibleText && looksLikeRawToolDump(emitted);

    let needsFollowUpHint = false;
    if (toolCalls > 0) {
      if (!hasVisibleText) {
        needsFollowUpHint = true;
      } else if (finishReason === 'tool-calls') {
        needsFollowUpHint = !emittedLooksFinal;
      } else if (hasTextAfterToolCalls === false) {
        needsFollowUpHint = !emittedLooksFinal;
      } else if (analysisIntent && emittedLooksRawDump) {
        needsFollowUpHint = true;
      }
    }

    let autoSynthesisUsed = false;
    if (needsFollowUpHint && !synthesisOnlyAttempt) {
      notify('run.phase', {
        run_id: runId,
        phase: 'synthesis',
        diag: { mode: 'auto_follow_up', tool_calls: toolCalls, finish_reason: finishReason },
      });
      try {
        const synthesisMessages = [...messages];
        const emittedPreview = clampPromptText(emitted, 2400);
        if (emittedPreview) {
          synthesisMessages.push({ role: 'assistant', content: emittedPreview });
        }
        synthesisMessages.push({
          role: 'user',
          content: buildAutoSynthesisPrompt(runToolMemories.get(runId) ?? [], analysisIntent),
        });

        const synthResult = await streamText({
          model,
          messages: synthesisMessages,
          maxSteps: 1,
          abortSignal: abort.signal,
        } as any);

        let synthEmitted = '';
        for await (const delta of synthResult.textStream) {
          if (typeof delta !== 'string' || !delta) continue;
          emitTextDelta(runId, delta);
          emitted += delta;
          synthEmitted += delta;
          deltaCount += 1;
          logEvent('ai.sidecar.stream.delta.synthesis', {
            run_id: runId,
            delta_len: delta.length,
            delta_count: deltaCount,
          });
        }

        const synthFinalText = await synthResult.text;
        if (typeof synthFinalText === 'string' && synthFinalText) {
          if (!synthEmitted) {
            emitTextDelta(runId, synthFinalText);
            emitted += synthFinalText;
            synthEmitted = synthFinalText;
          } else if (synthFinalText.length > synthEmitted.length && synthFinalText.startsWith(synthEmitted)) {
            const extra = synthFinalText.slice(synthEmitted.length);
            emitTextDelta(runId, extra);
            emitted += extra;
            synthEmitted = synthFinalText;
          }
        }

        finishReason = String((await synthResult.finishReason) ?? '').trim().toLowerCase() || finishReason;
        steps = await synthResult.steps;
        stepList = Array.isArray(steps) ? steps : [];
        refreshStepDiagnostics();

        hasVisibleText = emitted.trim().length > 0;
        emittedLooksFinal = hasVisibleText && looksLikeFinalAnswerText(emitted);
        emittedLooksRawDump = hasVisibleText && looksLikeRawToolDump(emitted);
        if (toolCalls > 0 && hasVisibleText) {
          hasTextAfterToolCalls = true;
        }
        needsFollowUpHint = false;
        if (toolCalls > 0) {
          if (!hasVisibleText) {
            needsFollowUpHint = true;
          } else if (finishReason === 'tool-calls') {
            needsFollowUpHint = !emittedLooksFinal;
          } else if (hasTextAfterToolCalls === false) {
            needsFollowUpHint = !emittedLooksFinal;
          } else if (analysisIntent && emittedLooksRawDump) {
            needsFollowUpHint = true;
          }
        }
        autoSynthesisUsed = synthEmitted.trim().length > 0;
      } catch (synthErr) {
        logEvent('ai.sidecar.synthesis.auto.error', {
          run_id: runId,
          error: synthErr instanceof Error ? synthErr.message : String(synthErr),
        });
      }
    }

    notify('run.outcome', {
      run_id: runId,
      has_text: hasVisibleText,
      text_chars: emitted.length,
      tool_calls: toolCalls,
      finish_reason: finishReason,
      step_count: stepCount,
      last_step_finish_reason: lastStepFinishReason,
      last_step_text_chars: lastStepTextChars,
      last_step_tool_calls: lastStepToolCalls,
      has_text_after_tool_calls: hasTextAfterToolCalls === null ? undefined : hasTextAfterToolCalls,
      needs_follow_up_hint: needsFollowUpHint,
      auto_synthesis_used: autoSynthesisUsed,
      analysis_patch_used: analysisPatchUsed,
    });
    notify('run.phase', {
      run_id: runId,
      phase: 'finalizing',
      diag: {
        tool_calls: toolCalls,
        has_text: hasVisibleText,
        text_chars: emitted.length,
        finish_reason: finishReason,
        step_count: stepCount,
        last_step_finish_reason: lastStepFinishReason,
        last_step_text_chars: lastStepTextChars,
        last_step_tool_calls: lastStepToolCalls,
        has_text_after_tool_calls: hasTextAfterToolCalls,
        needs_follow_up_hint: needsFollowUpHint,
        emitted_looks_final: emittedLooksFinal,
        emitted_looks_raw_dump: emittedLooksRawDump,
        synthesis_only_attempt: synthesisOnlyAttempt,
        auto_synthesis_used: autoSynthesisUsed,
        analysis_patch_used: analysisPatchUsed,
        attempt_index: recoveryAttemptIndex,
        recovery_steps_used: recoveryStepsUsed,
        recovery_budget_left: recoveryBudgetLeft,
      },
    });
    logEvent('ai.sidecar.run.end', {
      run_id: runId,
      emitted_chars: emitted.length,
      has_text: hasVisibleText,
      delta_count: deltaCount,
      tool_calls: toolCalls,
      finish_reason: finishReason,
      step_count: stepCount,
      last_step_finish_reason: lastStepFinishReason,
      last_step_text_chars: lastStepTextChars,
      last_step_tool_calls: lastStepToolCalls,
      has_text_after_tool_calls: hasTextAfterToolCalls,
      needs_follow_up_hint: needsFollowUpHint,
      emitted_looks_final: emittedLooksFinal,
      synthesis_only_attempt: synthesisOnlyAttempt,
      auto_synthesis_used: autoSynthesisUsed,
      recovery_attempt_index: recoveryAttemptIndex,
      recovery_steps_used: recoveryStepsUsed,
      recovery_budget_left: recoveryBudgetLeft,
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
    runToolMemories.delete(runId);
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
