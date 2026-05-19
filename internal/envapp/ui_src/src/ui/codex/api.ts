import { AccessUnlockError, normalizeRetryAfterMs } from '../services/accessUnlockError';
import { prepareGatewayRequestInit } from '../services/gatewayApi';
import type {
  CodexCapabilitiesSnapshot,
  CodexEvent,
  CodexForkThreadRequest,
  CodexInterruptTurnRequest,
  CodexSteerTurnRequest,
  CodexThreadReadStatus,
  CodexReviewStartRequest,
  CodexStatus,
  CodexThread,
  CodexThreadDetail,
  CodexUserInputEntry,
} from './types';

export class CodexGatewayError extends Error {
  errorCode: string;
  details: string;
  status: number;

  constructor(message: string, errorCode = '', status = 400, details = '') {
    super(message);
    this.name = 'CodexGatewayError';
    this.errorCode = String(errorCode ?? '').trim();
    this.details = String(details ?? '').trim();
    this.status = Math.max(0, Number(status ?? 0) || 0);
  }
}

function codexGatewayErrorMessage(data: any, status: number): string {
  const nested = String(data?.error?.message ?? '').trim();
  if (nested) return nested;
  const flat = String(data?.error ?? '').trim();
  if (flat && flat !== '[object Object]') return flat;
  return `HTTP ${status}`;
}

function codexGatewayErrorCode(data: any): string {
  return String(data?.error_code ?? data?.error?.code ?? '').trim();
}

function codexGatewayErrorDetails(data: any): string {
  return String(data?.error_details ?? data?.error?.details ?? '').trim();
}

function codexGatewayRetryAfterMs(data: any): number {
  return normalizeRetryAfterMs(data?.error?.retry_after_ms ?? data?.data?.retry_after_ms);
}

async function fetchCodexGatewayJSON<T>(url: string, init: RequestInit): Promise<T> {
  const resp = await fetch(url, await prepareGatewayRequestInit(init));
  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  const errorCode = codexGatewayErrorCode(data);
  const errorDetails = codexGatewayErrorDetails(data);
  if (!resp.ok) {
    const message = codexGatewayErrorMessage(data, resp.status);
    const retryAfterMs = codexGatewayRetryAfterMs(data);
    if (retryAfterMs > 0 || errorCode === 'ACCESS_PASSWORD_RETRY_LATER') {
      throw new AccessUnlockError({ message, status: resp.status, code: errorCode || 'HTTP_ERROR', retryAfterMs });
    }
    throw new CodexGatewayError(message, errorCode, resp.status, errorDetails);
  }
  if (data?.ok === false) {
    const status = resp.status || 400;
    const message = codexGatewayErrorMessage(data, status);
    const retryAfterMs = codexGatewayRetryAfterMs(data);
    if (retryAfterMs > 0 || errorCode === 'ACCESS_PASSWORD_RETRY_LATER') {
      throw new AccessUnlockError({ message, status, code: errorCode || 'REQUEST_FAILED', retryAfterMs });
    }
    throw new CodexGatewayError(message, errorCode, status, errorDetails);
  }
  return (data?.data ?? data) as T;
}

export async function fetchCodexStatus(): Promise<CodexStatus> {
  return fetchCodexGatewayJSON<CodexStatus>('/_redeven_proxy/api/codex/status', { method: 'GET' });
}

export async function fetchCodexCapabilities(cwd?: string): Promise<CodexCapabilitiesSnapshot> {
  const params = new URLSearchParams();
  const normalizedCWD = String(cwd ?? '').trim();
  if (normalizedCWD) {
    params.set('cwd', normalizedCWD);
  }
  const query = params.toString();
  return fetchCodexGatewayJSON<CodexCapabilitiesSnapshot>(
    `/_redeven_proxy/api/codex/capabilities${query ? `?${query}` : ''}`,
    { method: 'GET' },
  );
}

export async function listCodexThreads(args: {
  limit?: number;
  archived?: boolean;
} = {}): Promise<CodexThread[]> {
  const params = new URLSearchParams();
  params.set('limit', String(args.limit ?? 100));
  if (typeof args.archived === 'boolean') {
    params.set('archived', String(args.archived));
  }
  const out = await fetchCodexGatewayJSON<Readonly<{ threads?: CodexThread[] }>>(
    `/_redeven_proxy/api/codex/threads?${params.toString()}`,
    { method: 'GET' },
  );
  return Array.isArray(out?.threads) ? out.threads : [];
}

export async function openCodexThread(threadID: string): Promise<CodexThreadDetail> {
  const id = encodeURIComponent(String(threadID ?? '').trim());
  return fetchCodexGatewayJSON<CodexThreadDetail>(`/_redeven_proxy/api/codex/threads/${id}`, { method: 'GET' });
}

export async function markCodexThreadRead(args: {
  threadID: string;
  snapshot: {
    updated_at_unix_s: number;
    activity_signature?: string;
  };
}): Promise<CodexThreadReadStatus> {
  const threadID = encodeURIComponent(String(args.threadID ?? '').trim());
  const out = await fetchCodexGatewayJSON<Readonly<{ read_status: CodexThreadReadStatus }>>(
    `/_redeven_proxy/api/codex/threads/${threadID}/read`,
    {
      method: 'POST',
      body: JSON.stringify({
        snapshot: {
          updated_at_unix_s: Math.max(0, Math.floor(Number(args.snapshot.updated_at_unix_s ?? 0) || 0)),
          activity_signature: String(args.snapshot.activity_signature ?? '').trim() || undefined,
        },
      }),
    },
  );
  return out.read_status;
}

export async function startCodexThread(args: {
  cwd?: string;
  model?: string;
  approval_policy?: string;
  sandbox_mode?: string;
  approvals_reviewer?: string;
}): Promise<CodexThreadDetail> {
  return fetchCodexGatewayJSON<CodexThreadDetail>('/_redeven_proxy/api/codex/threads', {
    method: 'POST',
    body: JSON.stringify({
      cwd: String(args.cwd ?? '').trim(),
      model: String(args.model ?? '').trim(),
      approval_policy: String(args.approval_policy ?? '').trim(),
      sandbox_mode: String(args.sandbox_mode ?? '').trim(),
      approvals_reviewer: String(args.approvals_reviewer ?? '').trim(),
    }),
  });
}

export async function startCodexTurn(args: {
  threadID: string;
  inputText?: string;
  inputs?: CodexUserInputEntry[];
  cwd?: string;
  model?: string;
  effort?: string;
  approval_policy?: string;
  sandbox_mode?: string;
  approvals_reviewer?: string;
}): Promise<void> {
  const threadID = encodeURIComponent(String(args.threadID ?? '').trim());
  await fetchCodexGatewayJSON<unknown>(`/_redeven_proxy/api/codex/threads/${threadID}/turns`, {
    method: 'POST',
    body: JSON.stringify({
      input_text: String(args.inputText ?? ''),
      inputs: Array.isArray(args.inputs) ? args.inputs : [],
      cwd: String(args.cwd ?? '').trim(),
      model: String(args.model ?? '').trim(),
      effort: String(args.effort ?? '').trim(),
      approval_policy: String(args.approval_policy ?? '').trim(),
      sandbox_mode: String(args.sandbox_mode ?? '').trim(),
      approvals_reviewer: String(args.approvals_reviewer ?? '').trim(),
    }),
  });
}

export async function steerCodexTurn(args: CodexSteerTurnRequest): Promise<void> {
  const threadID = encodeURIComponent(String(args.thread_id ?? '').trim());
  await fetchCodexGatewayJSON<unknown>(`/_redeven_proxy/api/codex/threads/${threadID}/turns/steer`, {
    method: 'POST',
    body: JSON.stringify({
      expected_turn_id: String(args.expected_turn_id ?? '').trim(),
      inputs: Array.isArray(args.inputs) ? args.inputs : [],
    }),
  });
}

export async function archiveCodexThread(threadID: string): Promise<void> {
  const id = encodeURIComponent(String(threadID ?? '').trim());
  await fetchCodexGatewayJSON<unknown>(`/_redeven_proxy/api/codex/threads/${id}/archive`, { method: 'POST' });
}

export async function unarchiveCodexThread(threadID: string): Promise<void> {
  const id = encodeURIComponent(String(threadID ?? '').trim());
  await fetchCodexGatewayJSON<unknown>(`/_redeven_proxy/api/codex/threads/${id}/unarchive`, { method: 'POST' });
}

export async function forkCodexThread(args: CodexForkThreadRequest): Promise<CodexThreadDetail> {
  const id = encodeURIComponent(String(args.thread_id ?? '').trim());
  return fetchCodexGatewayJSON<CodexThreadDetail>(`/_redeven_proxy/api/codex/threads/${id}/fork`, {
    method: 'POST',
    body: JSON.stringify({
      model: String(args.model ?? '').trim(),
      approval_policy: String(args.approval_policy ?? '').trim(),
      sandbox_mode: String(args.sandbox_mode ?? '').trim(),
      approvals_reviewer: String(args.approvals_reviewer ?? '').trim(),
    }),
  });
}

export async function interruptCodexTurn(args: CodexInterruptTurnRequest): Promise<void> {
  const id = encodeURIComponent(String(args.thread_id ?? '').trim());
  await fetchCodexGatewayJSON<unknown>(`/_redeven_proxy/api/codex/threads/${id}/interrupt`, {
    method: 'POST',
    body: JSON.stringify({
      turn_id: String(args.turn_id ?? '').trim(),
    }),
  });
}

export async function startCodexReview(args: CodexReviewStartRequest): Promise<CodexThreadDetail> {
  const id = encodeURIComponent(String(args.thread_id ?? '').trim());
  return fetchCodexGatewayJSON<CodexThreadDetail>(`/_redeven_proxy/api/codex/threads/${id}/review`, {
    method: 'POST',
    body: JSON.stringify({
      target: String(args.target ?? 'uncommitted_changes').trim() || 'uncommitted_changes',
    }),
  });
}

export async function respondToCodexRequest(args: {
  threadID: string;
  requestID: string;
  type: string;
  decision?: string;
  answers?: Record<string, string>;
}): Promise<void> {
  const answers: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(args.answers ?? {})) {
    const normalizedKey = String(key ?? '').trim();
    if (!normalizedKey) continue;
    answers[normalizedKey] = [String(value ?? '').trim()];
  }
  await fetchCodexGatewayJSON<unknown>(
    `/_redeven_proxy/api/codex/threads/${encodeURIComponent(String(args.threadID ?? '').trim())}/requests/${encodeURIComponent(String(args.requestID ?? '').trim())}/response`,
    {
      method: 'POST',
      body: JSON.stringify({
        type: String(args.type ?? '').trim(),
        decision: String(args.decision ?? '').trim(),
        answers,
      }),
    },
  );
}

export async function connectCodexEventStream(args: {
  threadID: string;
  afterSeq?: number;
  signal: AbortSignal;
  onEvent: (event: CodexEvent) => void;
}): Promise<void> {
  const response = await fetch(
    `/_redeven_proxy/api/codex/threads/${encodeURIComponent(String(args.threadID ?? '').trim())}/events?after_seq=${encodeURIComponent(String(args.afterSeq ?? 0))}`,
    await prepareGatewayRequestInit({
      method: 'GET',
      headers: { Accept: 'text/event-stream' },
      signal: args.signal,
    }),
  );
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('Codex event stream unavailable');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushEventBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    if (!payload) return;
    args.onEvent(JSON.parse(payload) as CodexEvent);
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        flushEventBlock(block);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    const finalBlock = buffer.trim();
    if (finalBlock) flushEventBlock(finalBlock);
  } finally {
    reader.releaseLock();
  }
}
