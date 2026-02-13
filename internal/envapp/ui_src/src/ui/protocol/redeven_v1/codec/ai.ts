import type {
  AIActiveRun,
  AICancelRunRequest,
  AICancelRunResponse,
  AIRealtimeEvent,
  AIStartRunRequest,
  AIStartRunResponse,
  AISubscribeResponse,
  AIToolApprovalRequest,
  AIToolApprovalResponse,
  AIThreadRunStatus,
} from '../sdk/ai';
import type {
  wire_ai_active_run,
  wire_ai_cancel_run_req,
  wire_ai_cancel_run_resp,
  wire_ai_event_notify,
  wire_ai_start_run_req,
  wire_ai_start_run_resp,
  wire_ai_subscribe_resp,
  wire_ai_tool_approval_req,
  wire_ai_tool_approval_resp,
} from '../wire/ai';

function toAIActiveRun(raw: wire_ai_active_run): AIActiveRun {
  return {
    threadId: String(raw?.thread_id ?? '').trim(),
    runId: String(raw?.run_id ?? '').trim(),
  };
}

export function toWireAIStartRunRequest(req: AIStartRunRequest): wire_ai_start_run_req {
  return {
    thread_id: String(req.threadId ?? '').trim(),
    model: req.model?.trim() ? req.model.trim() : undefined,
    input: {
      text: String(req.input?.text ?? ''),
      attachments: Array.isArray(req.input?.attachments)
        ? req.input.attachments
            .map((it) => ({
              name: String(it?.name ?? ''),
              mime_type: String(it?.mimeType ?? ''),
              url: String(it?.url ?? ''),
            }))
            .filter((it) => !!it.url.trim())
        : [],
    },
    options: {
      max_steps: Number(req.options?.maxSteps ?? 0),
      mode: req.options?.mode ? String(req.options.mode).trim() : undefined,
    },
  };
}

export function fromWireAIStartRunResponse(resp: wire_ai_start_run_resp): AIStartRunResponse {
  return {
    runId: String(resp?.run_id ?? '').trim(),
  };
}

export function toWireAICancelRunRequest(req: AICancelRunRequest): wire_ai_cancel_run_req {
  const runId = String(req.runId ?? '').trim();
  const threadId = String(req.threadId ?? '').trim();
  return {
    run_id: runId || undefined,
    thread_id: threadId || undefined,
  };
}

export function fromWireAICancelRunResponse(resp: wire_ai_cancel_run_resp): AICancelRunResponse {
  return { ok: Boolean(resp?.ok ?? false) };
}

export function fromWireAISubscribeResponse(resp: wire_ai_subscribe_resp): AISubscribeResponse {
  const activeRuns = Array.isArray(resp?.active_runs) ? resp.active_runs.map(toAIActiveRun) : [];
  return {
    activeRuns: activeRuns.filter((it) => !!it.threadId && !!it.runId),
  };
}

export function toWireAIToolApprovalRequest(req: AIToolApprovalRequest): wire_ai_tool_approval_req {
  return {
    run_id: String(req.runId ?? '').trim(),
    tool_id: String(req.toolId ?? '').trim(),
    approved: Boolean(req.approved),
  };
}

export function fromWireAIToolApprovalResponse(resp: wire_ai_tool_approval_resp): AIToolApprovalResponse {
  return { ok: Boolean(resp?.ok ?? false) };
}

export function fromWireAIEventNotify(payload: wire_ai_event_notify): AIRealtimeEvent | null {
  const eventType = String(payload?.event_type ?? '').trim();
  if (eventType !== 'stream_event' && eventType !== 'thread_state') {
    return null;
  }

  const threadId = String(payload?.thread_id ?? '').trim();
  const runId = String(payload?.run_id ?? '').trim();
  const endpointId = String(payload?.endpoint_id ?? '').trim();
  if (!threadId || !runId || !endpointId) {
    return null;
  }

  const atUnixMs = Number(payload?.at_unix_ms ?? 0);
  const rawStatus = typeof payload?.run_status === 'string' ? payload.run_status.trim().toLowerCase() : '';
  const runStatus =
    rawStatus === 'idle' ||
    rawStatus === 'accepted' ||
    rawStatus === 'running' ||
    rawStatus === 'waiting_approval' ||
    rawStatus === 'recovering' ||
    rawStatus === 'waiting_user' ||
    rawStatus === 'success' ||
    rawStatus === 'failed' ||
    rawStatus === 'canceled' ||
    rawStatus === 'timed_out'
      ? (rawStatus as AIThreadRunStatus)
      : undefined;

  const streamKindRaw = String(payload?.stream_kind ?? '').trim().toLowerCase();
  const streamKind =
    streamKindRaw === 'lifecycle' || streamKindRaw === 'assistant' || streamKindRaw === 'tool'
      ? (streamKindRaw as 'lifecycle' | 'assistant' | 'tool')
      : undefined;

  const phaseRaw = String(payload?.phase ?? '').trim().toLowerCase();
  const phase =
    phaseRaw === 'start' || phaseRaw === 'state_change' || phaseRaw === 'end' || phaseRaw === 'error'
      ? (phaseRaw as 'start' | 'state_change' | 'end' | 'error')
      : undefined;

  return {
    eventType,
    endpointId,
    threadId,
    runId,
    atUnixMs: Number.isFinite(atUnixMs) && atUnixMs > 0 ? atUnixMs : Date.now(),
    streamKind,
    phase,
    diag: payload?.diag && typeof payload.diag === 'object' ? (payload.diag as Record<string, any>) : undefined,
    streamEvent: eventType === 'stream_event' ? (payload?.stream_event as any) : undefined,
    runStatus,
    runError: typeof payload?.run_error === 'string' ? payload.run_error : undefined,
  };
}
