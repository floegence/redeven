import { prepareGatewayRequestInit } from './gatewayApi';
import {
  normalizeRuntimeWorkbenchLayoutEvent,
  normalizeRuntimeWorkbenchOpenPreviewResponse,
  normalizeRuntimeWorkbenchLayoutSnapshot,
  normalizeRuntimeWorkbenchWidgetState,
  type RuntimeWorkbenchLayoutEvent,
  type RuntimeWorkbenchOpenPreviewRequest,
  type RuntimeWorkbenchOpenPreviewResponse,
  type RuntimeWorkbenchLayoutPutRequest,
  type RuntimeWorkbenchLayoutSnapshot,
  type RuntimeWorkbenchTerminalCreateSessionRequest,
  type RuntimeWorkbenchTerminalCreateSessionResponse,
  type RuntimeWorkbenchWidgetState,
  type RuntimeWorkbenchWidgetStatePutRequest,
} from '../workbench/runtimeWorkbenchLayout';

export class WorkbenchLayoutConflictError extends Error {
  currentRevision: number;

  constructor(message: string, currentRevision: number) {
    super(message);
    this.name = 'WorkbenchLayoutConflictError';
    this.currentRevision = currentRevision;
  }
}

export class WorkbenchWidgetStateConflictError extends Error {
  widgetId: string;
  currentRevision: number;

  constructor(message: string, widgetId: string, currentRevision: number) {
    super(message);
    this.name = 'WorkbenchWidgetStateConflictError';
    this.widgetId = widgetId;
    this.currentRevision = currentRevision;
  }
}

function gatewayErrorMessage(data: any, status: number): string {
  const nested = String(data?.error?.message ?? '').trim();
  if (nested) return nested;
  const flat = String(data?.error ?? '').trim();
  if (flat && flat !== '[object Object]') return flat;
  return `HTTP ${status}`;
}

function gatewayErrorCode(data: any): string {
  return String(data?.error_code ?? data?.error?.code ?? '').trim();
}

async function fetchWorkbenchLayoutJSON<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, await prepareGatewayRequestInit(init));
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  if (!response.ok || data?.ok === false) {
    const message = gatewayErrorMessage(data, response.status);
    const errorCode = gatewayErrorCode(data);
    if (errorCode === 'WORKBENCH_LAYOUT_REVISION_CONFLICT') {
      throw new WorkbenchLayoutConflictError(message, Number(data?.data?.current_revision ?? 0));
    }
    if (errorCode === 'WORKBENCH_WIDGET_STATE_REVISION_CONFLICT') {
      throw new WorkbenchWidgetStateConflictError(
        message,
        String(data?.data?.widget_id ?? '').trim(),
        Number(data?.data?.current_revision ?? 0),
      );
    }
    throw new Error(message);
  }
  return (data?.data ?? data) as T;
}

export async function getWorkbenchLayoutSnapshot(): Promise<RuntimeWorkbenchLayoutSnapshot> {
  return normalizeRuntimeWorkbenchLayoutSnapshot(
    await fetchWorkbenchLayoutJSON('/_redeven_proxy/api/workbench/layout/snapshot', { method: 'GET' }),
  );
}

export async function putWorkbenchLayout(
  input: RuntimeWorkbenchLayoutPutRequest,
): Promise<RuntimeWorkbenchLayoutSnapshot> {
  return normalizeRuntimeWorkbenchLayoutSnapshot(
    await fetchWorkbenchLayoutJSON('/_redeven_proxy/api/workbench/layout', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  );
}

export async function putWorkbenchWidgetState(
  widgetId: string,
  input: RuntimeWorkbenchWidgetStatePutRequest,
): Promise<RuntimeWorkbenchWidgetState> {
  const state = normalizeRuntimeWorkbenchWidgetState(
    await fetchWorkbenchLayoutJSON(
      `/_redeven_proxy/api/workbench/widgets/${encodeURIComponent(String(widgetId ?? '').trim())}/state`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      },
    ),
  );
  if (!state) {
    throw new Error('Invalid workbench widget state response');
  }
  return state;
}

export async function openWorkbenchPreview(
  input: RuntimeWorkbenchOpenPreviewRequest,
): Promise<RuntimeWorkbenchOpenPreviewResponse> {
  const response = normalizeRuntimeWorkbenchOpenPreviewResponse(
    await fetchWorkbenchLayoutJSON('/_redeven_proxy/api/workbench/actions/open_preview', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  );
  if (!response) {
    throw new Error('Invalid workbench preview open response');
  }
  return response;
}

export async function createWorkbenchTerminalSession(
  widgetId: string,
  input: RuntimeWorkbenchTerminalCreateSessionRequest,
): Promise<RuntimeWorkbenchTerminalCreateSessionResponse> {
  const data = await fetchWorkbenchLayoutJSON<any>(
    `/_redeven_proxy/api/workbench/widgets/${encodeURIComponent(String(widgetId ?? '').trim())}/terminal/sessions`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  );
  const widgetState = normalizeRuntimeWorkbenchWidgetState(data?.widget_state);
  if (!widgetState) {
    throw new Error('Invalid workbench terminal session response');
  }
  const sessionId = String(data?.session?.id ?? '').trim();
  if (!sessionId) {
    throw new Error('Invalid workbench terminal session response');
  }
  return {
    session: {
      id: sessionId,
      name: String(data?.session?.name ?? '').trim(),
      working_dir: String(data?.session?.working_dir ?? '').trim(),
      created_at_ms: Number(data?.session?.created_at_ms ?? 0),
      last_active_at_ms: Number(data?.session?.last_active_at_ms ?? 0),
      is_active: Boolean(data?.session?.is_active),
    },
    widget_state: widgetState,
  };
}

export async function deleteWorkbenchTerminalSession(
  widgetId: string,
  sessionId: string,
): Promise<RuntimeWorkbenchWidgetState> {
  const state = normalizeRuntimeWorkbenchWidgetState(
    await fetchWorkbenchLayoutJSON(
      `/_redeven_proxy/api/workbench/widgets/${encodeURIComponent(String(widgetId ?? '').trim())}/terminal/sessions/${encodeURIComponent(String(sessionId ?? '').trim())}`,
      { method: 'DELETE' },
    ),
  );
  if (!state) {
    throw new Error('Invalid workbench widget state response');
  }
  return state;
}

export async function connectWorkbenchLayoutEventStream(args: {
  afterSeq?: number;
  signal: AbortSignal;
  onEvent: (event: RuntimeWorkbenchLayoutEvent) => void;
}): Promise<void> {
  const response = await fetch(
    `/_redeven_proxy/api/workbench/layout/events?after_seq=${encodeURIComponent(String(args.afterSeq ?? 0))}`,
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
    throw new Error('Workbench layout event stream unavailable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushBlock = (block: string) => {
    const lines = block.split(/\r?\n/);
    const dataLines = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length <= 0) return;
    const payload = dataLines.join('\n');
    if (!payload) return;
    const event = normalizeRuntimeWorkbenchLayoutEvent(JSON.parse(payload));
    if (!event) return;
    args.onEvent(event);
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
        flushBlock(block);
        boundary = buffer.indexOf('\n\n');
      }
    }
    buffer += decoder.decode();
    const finalBlock = buffer.trim();
    if (finalBlock) {
      flushBlock(finalBlock);
    }
  } finally {
    reader.releaseLock();
  }
}
