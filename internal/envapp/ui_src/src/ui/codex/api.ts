import { fetchGatewayJSON, prepareGatewayRequestInit } from '../services/gatewayApi';
import type {
  CodexEvent,
  CodexStatus,
  CodexThread,
  CodexThreadDetail,
} from './types';

export async function fetchCodexStatus(): Promise<CodexStatus> {
  return fetchGatewayJSON<CodexStatus>('/_redeven_proxy/api/codex/status', { method: 'GET' });
}

export async function listCodexThreads(limit = 100): Promise<CodexThread[]> {
  const out = await fetchGatewayJSON<Readonly<{ threads?: CodexThread[] }>>(
    `/_redeven_proxy/api/codex/threads?limit=${encodeURIComponent(String(limit))}`,
    { method: 'GET' },
  );
  return Array.isArray(out?.threads) ? out.threads : [];
}

export async function openCodexThread(threadID: string): Promise<CodexThreadDetail> {
  const id = encodeURIComponent(String(threadID ?? '').trim());
  return fetchGatewayJSON<CodexThreadDetail>(`/_redeven_proxy/api/codex/threads/${id}`, { method: 'GET' });
}

export async function startCodexThread(args: { cwd?: string; model?: string }): Promise<CodexThread> {
  const out = await fetchGatewayJSON<Readonly<{ thread?: CodexThread }>>('/_redeven_proxy/api/codex/threads', {
    method: 'POST',
    body: JSON.stringify({
      cwd: String(args.cwd ?? '').trim(),
      model: String(args.model ?? '').trim(),
    }),
  });
  if (!out?.thread) throw new Error('Codex thread response missing thread');
  return out.thread;
}

export async function startCodexTurn(args: { threadID: string; inputText: string }): Promise<void> {
  const threadID = encodeURIComponent(String(args.threadID ?? '').trim());
  await fetchGatewayJSON<unknown>(`/_redeven_proxy/api/codex/threads/${threadID}/turns`, {
    method: 'POST',
    body: JSON.stringify({ input_text: String(args.inputText ?? '') }),
  });
}

export async function archiveCodexThread(threadID: string): Promise<void> {
  const id = encodeURIComponent(String(threadID ?? '').trim());
  await fetchGatewayJSON<unknown>(`/_redeven_proxy/api/codex/threads/${id}/archive`, { method: 'POST' });
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
  await fetchGatewayJSON<unknown>(
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
