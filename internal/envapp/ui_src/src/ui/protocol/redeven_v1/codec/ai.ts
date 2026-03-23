import type {
  AIActiveRun,
  AICancelRunRequest,
  AICancelRunResponse,
  AIFollowupAttachment,
  AIFollowupItem,
  AIGetActiveRunSnapshotRequest,
  AIGetActiveRunSnapshotResponse,
  AIListMessagesRequest,
  AIListMessagesResponse,
  AIRealtimeEvent,
  AISetToolCollapsedRequest,
  AISetToolCollapsedResponse,
  AISendUserTurnRequest,
  AISendUserTurnResponse,
  AISubmitStructuredPromptResponseRequest,
  AISubmitStructuredPromptResponseResponse,
  AIStopThreadRequest,
  AIStopThreadResponse,
  AIRequestUserInputAction,
  AIRequestUserInputAnswer,
  AIRequestUserInputOption,
  AIRequestUserInputPrompt,
  AIRequestUserInputQuestion,
  AISubscribeSummaryResponse,
  AISubscribeThreadRequest,
  AISubscribeThreadResponse,
  AIThreadRewindRequest,
  AIThreadRewindResponse,
  AIToolApprovalRequest,
  AIToolApprovalResponse,
  AITranscriptMessageItem,
  AIThreadRunStatus,
} from '../sdk/ai';
import type {
  wire_ai_active_run,
  wire_ai_cancel_run_req,
  wire_ai_cancel_run_resp,
  wire_ai_event_notify,
  wire_ai_followup_attachment,
  wire_ai_followup_item,
  wire_ai_get_active_run_snapshot_req,
  wire_ai_get_active_run_snapshot_resp,
  wire_ai_list_messages_req,
  wire_ai_list_messages_resp,
  wire_ai_set_tool_collapsed_req,
  wire_ai_set_tool_collapsed_resp,
  wire_ai_send_user_turn_req,
  wire_ai_send_user_turn_resp,
  wire_ai_submit_structured_prompt_response_req,
  wire_ai_submit_structured_prompt_response_resp,
  wire_ai_stop_thread_req,
  wire_ai_stop_thread_resp,
  wire_ai_subscribe_summary_resp,
  wire_ai_subscribe_thread_req,
  wire_ai_subscribe_thread_resp,
  wire_ai_thread_rewind_req,
  wire_ai_thread_rewind_resp,
  wire_ai_transcript_message_item,
  wire_ai_tool_approval_req,
  wire_ai_tool_approval_resp,
  wire_ai_request_user_input_action,
  wire_ai_request_user_input_answer,
  wire_ai_request_user_input_option,
  wire_ai_request_user_input_question,
  wire_ai_waiting_prompt,
} from '../wire/ai';

function toAIActiveRun(raw: wire_ai_active_run): AIActiveRun {
  return {
    threadId: String(raw?.thread_id ?? '').trim(),
    runId: String(raw?.run_id ?? '').trim(),
  };
}

function normalizeExecutionMode(raw: unknown): 'act' | 'plan' | undefined {
  const mode = String(raw ?? '').trim().toLowerCase();
  if (mode === 'act' || mode === 'plan') return mode;
  return undefined;
}


function fromWireAIFollowupAttachment(raw: wire_ai_followup_attachment): AIFollowupAttachment | null {
  const name = String(raw?.name ?? '').trim();
  if (!name) return null;
  const mimeType = String(raw?.mime_type ?? '').trim();
  const url = String(raw?.url ?? '').trim();
  return {
    name,
    mimeType: mimeType || undefined,
    url: url || undefined,
  };
}

function fromWireAIFollowupItem(raw: wire_ai_followup_item): AIFollowupItem | null {
  const followupId = String(raw?.followup_id ?? '').trim();
  const lane = String(raw?.lane ?? '').trim().toLowerCase();
  const messageId = String(raw?.message_id ?? '').trim();
  if (!followupId || (lane !== 'queued' && lane !== 'draft') || !messageId) {
    return null;
  }
  const attachments = Array.isArray(raw?.attachments)
    ? raw.attachments.map(fromWireAIFollowupAttachment).filter(Boolean) as AIFollowupAttachment[]
    : [];
  return {
    followupId,
    lane,
    messageId,
    text: String(raw?.text ?? ''),
    modelId: String(raw?.model_id ?? '').trim() || undefined,
    executionMode: normalizeExecutionMode(raw?.execution_mode),
    position: Math.max(1, Math.floor(Number(raw?.position ?? 0) || 0)),
    createdAtUnixMs: Math.max(0, Math.floor(Number(raw?.created_at_unix_ms ?? 0) || 0)),
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

function fromWireAIRequestUserInputAction(raw: wire_ai_request_user_input_action): AIRequestUserInputAction | null {
  const type = String(raw?.type ?? '').trim().toLowerCase();
  if (!type) return null;
  const mode = normalizeExecutionMode(raw?.mode);
  return {
    type,
    mode,
  };
}

function fromWireAIRequestUserInputOption(raw: wire_ai_request_user_input_option): AIRequestUserInputOption | null {
  const optionId = String(raw?.option_id ?? '').trim();
  const label = String(raw?.label ?? '').trim();
  if (!optionId || !label) return null;
  const detailInputModeRaw = String(raw?.detail_input_mode ?? '').trim().toLowerCase();
  const detailInputMode = detailInputModeRaw === 'required' || detailInputModeRaw === 'optional'
    ? detailInputModeRaw
    : undefined;
  const actions = Array.isArray(raw?.actions)
    ? raw.actions.map(fromWireAIRequestUserInputAction).filter(Boolean) as AIRequestUserInputAction[]
    : [];
  return {
    optionId,
    label,
    description: String(raw?.description ?? '').trim() || undefined,
    detailInputMode,
    detailInputPlaceholder: String(raw?.detail_input_placeholder ?? '').trim() || undefined,
    actions: actions.length > 0 ? actions : undefined,
  };
}

function fromWireAIRequestUserInputQuestion(raw: wire_ai_request_user_input_question): AIRequestUserInputQuestion | null {
  const id = String(raw?.id ?? '').trim();
  const header = String(raw?.header ?? '').trim();
  const question = String(raw?.question ?? '').trim();
  if (!id || !header || !question) return null;
  const options = Array.isArray(raw?.options)
    ? raw.options.map(fromWireAIRequestUserInputOption).filter(Boolean) as AIRequestUserInputOption[]
    : [];
  return {
    id,
    header,
    question,
    isOther: Boolean(raw?.is_other),
    isSecret: Boolean(raw?.is_secret),
    options: options.length > 0 ? options : undefined,
  };
}

function fromWireAIWaitingPrompt(raw: wire_ai_waiting_prompt | undefined): AIRequestUserInputPrompt | undefined {
  const promptId = String(raw?.prompt_id ?? '').trim();
  const messageId = String(raw?.message_id ?? '').trim();
  const toolId = String(raw?.tool_id ?? '').trim();
  if (!promptId || !messageId || !toolId) {
    return undefined;
  }
  const questions = Array.isArray(raw?.questions)
    ? raw.questions.map(fromWireAIRequestUserInputQuestion).filter(Boolean) as AIRequestUserInputQuestion[]
    : [];
  return {
    promptId,
    messageId,
    toolId,
    reasonCode: String(raw?.reason_code ?? '').trim() || undefined,
    requiredFromUser: Array.isArray(raw?.required_from_user)
      ? raw.required_from_user.map((item) => String(item ?? '').trim()).filter(Boolean)
      : undefined,
    evidenceRefs: Array.isArray(raw?.evidence_refs)
      ? raw.evidence_refs.map((item) => String(item ?? '').trim()).filter(Boolean)
      : undefined,
    publicSummary: String(raw?.public_summary ?? '').trim() || undefined,
    containsSecret: Boolean(raw?.contains_secret),
    questions: questions.length > 0 ? questions : undefined,
  };
}

function toWireAIRequestUserInputAnswer(answer: AIRequestUserInputAnswer): wire_ai_request_user_input_answer {
  return {
    selected_option_id: String(answer?.selectedOptionId ?? '').trim() || undefined,
    answers: Array.isArray(answer?.answers)
      ? answer.answers.map((item) => String(item ?? '').trim()).filter(Boolean)
      : [],
  };
}

export function toWireAISendUserTurnRequest(req: AISendUserTurnRequest): wire_ai_send_user_turn_req {
  return {
    thread_id: String(req.threadId ?? '').trim(),
    model: req.model?.trim() ? req.model.trim() : undefined,
    input: {
      message_id: req.input?.messageId?.trim() ? String(req.input.messageId).trim() : undefined,
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
    expected_run_id: req.expectedRunId?.trim() ? String(req.expectedRunId).trim() : undefined,
    queue_after_waiting_user: Boolean(req.queueAfterWaitingUser),
    source_followup_id: req.sourceFollowupId?.trim() ? String(req.sourceFollowupId).trim() : undefined,
  };
}

export function fromWireAISendUserTurnResponse(resp: wire_ai_send_user_turn_resp): AISendUserTurnResponse {
  return {
    runId: String(resp?.run_id ?? '').trim(),
    kind: String(resp?.kind ?? '').trim(),
    queueId: String(resp?.queue_id ?? '').trim() || undefined,
    queuePosition: typeof resp?.queue_position === 'number' ? resp.queue_position : undefined,
    consumedWaitingPromptId:
      String(resp?.consumed_waiting_prompt_id ?? '').trim() || undefined,
    appliedExecutionMode: normalizeExecutionMode(resp?.applied_execution_mode),
  };
}

export function toWireAISubmitStructuredPromptResponseRequest(req: AISubmitStructuredPromptResponseRequest): wire_ai_submit_structured_prompt_response_req {
  const answers: Record<string, wire_ai_request_user_input_answer> = {};
  for (const [questionId, answer] of Object.entries(req.response?.answers ?? {})) {
    const qid = String(questionId ?? '').trim();
    if (!qid) continue;
    answers[qid] = toWireAIRequestUserInputAnswer(answer);
  }
  return {
    thread_id: String(req.threadId ?? '').trim(),
    model: req.model?.trim() ? req.model.trim() : undefined,
    response: {
      prompt_id: String(req.response?.promptId ?? '').trim(),
      answers,
    },
    input: {
      message_id: req.input?.messageId?.trim() ? String(req.input.messageId).trim() : undefined,
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
    expected_run_id: req.expectedRunId?.trim() ? String(req.expectedRunId).trim() : undefined,
    source_followup_id: req.sourceFollowupId?.trim() ? String(req.sourceFollowupId).trim() : undefined,
  };
}

export function fromWireAISubmitStructuredPromptResponseResponse(resp: wire_ai_submit_structured_prompt_response_resp): AISubmitStructuredPromptResponseResponse {
  return {
    runId: String(resp?.run_id ?? '').trim(),
    kind: String(resp?.kind ?? '').trim(),
    consumedWaitingPromptId: String(resp?.consumed_waiting_prompt_id ?? '').trim() || undefined,
    appliedExecutionMode: normalizeExecutionMode(resp?.applied_execution_mode),
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

export function fromWireAISubscribeSummaryResponse(resp: wire_ai_subscribe_summary_resp): AISubscribeSummaryResponse {
  const activeRuns = Array.isArray(resp?.active_runs) ? resp.active_runs.map(toAIActiveRun) : [];
  return {
    activeRuns: activeRuns.filter((it) => !!it.threadId && !!it.runId),
  };
}

export function toWireAISubscribeThreadRequest(req: AISubscribeThreadRequest): wire_ai_subscribe_thread_req {
  return {
    thread_id: String(req.threadId ?? '').trim(),
  };
}

export function fromWireAISubscribeThreadResponse(resp: wire_ai_subscribe_thread_resp): AISubscribeThreadResponse {
  const runId = String(resp?.run_id ?? '').trim();
  return { runId: runId ? runId : undefined };
}

export function toWireAIThreadRewindRequest(req: AIThreadRewindRequest): wire_ai_thread_rewind_req {
  return {
    thread_id: String(req.threadId ?? '').trim(),
  };
}

export function fromWireAIThreadRewindResponse(resp: wire_ai_thread_rewind_resp): AIThreadRewindResponse {
  const ok = Boolean(resp?.ok ?? false);
  const checkpointId = String(resp?.checkpoint_id ?? '').trim();
  return {
    ok,
    checkpointId: ok && checkpointId ? checkpointId : undefined,
  };
}


export function toWireAIStopThreadRequest(req: AIStopThreadRequest): wire_ai_stop_thread_req {
  return {
    thread_id: String(req.threadId ?? '').trim(),
  };
}

export function fromWireAIStopThreadResponse(resp: wire_ai_stop_thread_resp): AIStopThreadResponse {
  const recoveredFollowups = Array.isArray(resp?.recovered_followups)
    ? resp.recovered_followups.map(fromWireAIFollowupItem).filter(Boolean) as AIFollowupItem[]
    : [];
  return {
    ok: Boolean(resp?.ok ?? false),
    recoveredFollowups: recoveredFollowups.length > 0 ? recoveredFollowups : undefined,
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

export function toWireAIGetActiveRunSnapshotRequest(req: AIGetActiveRunSnapshotRequest): wire_ai_get_active_run_snapshot_req {
  return {
    thread_id: String(req.threadId ?? '').trim(),
  };
}

export function fromWireAIGetActiveRunSnapshotResponse(resp: wire_ai_get_active_run_snapshot_resp): AIGetActiveRunSnapshotResponse {
  const ok = Boolean(resp?.ok ?? false);
  const runId = String(resp?.run_id ?? '').trim();
  return {
    ok,
    runId: ok && runId ? runId : undefined,
    messageJson: ok ? resp?.message_json : undefined,
  };
}

export function toWireAISetToolCollapsedRequest(req: AISetToolCollapsedRequest): wire_ai_set_tool_collapsed_req {
  return {
    thread_id: String(req.threadId ?? '').trim(),
    message_id: String(req.messageId ?? '').trim(),
    tool_id: String(req.toolId ?? '').trim(),
    collapsed: Boolean(req.collapsed),
  };
}

export function fromWireAISetToolCollapsedResponse(resp: wire_ai_set_tool_collapsed_resp): AISetToolCollapsedResponse {
  return { ok: Boolean(resp?.ok ?? false) };
}

export function fromWireAIEventNotify(payload: wire_ai_event_notify): AIRealtimeEvent | null {
  const eventType = String(payload?.event_type ?? '').trim();
  if (eventType !== 'stream_event' && eventType !== 'thread_state' && eventType !== 'transcript_message' && eventType !== 'transcript_reset' && eventType !== 'thread_summary') {
    return null;
  }

  const threadId = String(payload?.thread_id ?? '').trim();
  const runId = String(payload?.run_id ?? '').trim();
  const endpointId = String(payload?.endpoint_id ?? '').trim();
  if (!threadId || !endpointId) {
    return null;
  }
  if (eventType !== 'transcript_message' && eventType !== 'transcript_reset' && eventType !== 'thread_summary' && !runId) {
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
    rawStatus === 'finalizing' ||
    rawStatus === 'waiting_user' ||
    rawStatus === 'success' ||
    rawStatus === 'failed' ||
    rawStatus === 'canceled' ||
    rawStatus === 'timed_out'
      ? (rawStatus as AIThreadRunStatus)
      : undefined;

  const streamKindRaw = String(payload?.stream_kind ?? '').trim().toLowerCase();
  const streamKind =
    streamKindRaw === 'lifecycle' || streamKindRaw === 'assistant' || streamKindRaw === 'tool' || streamKindRaw === 'context'
      ? (streamKindRaw as 'lifecycle' | 'assistant' | 'tool' | 'context')
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
    waitingPrompt: fromWireAIWaitingPrompt(payload?.waiting_prompt),

    messageRowId: Number(payload?.message_row_id ?? 0) || undefined,
    messageJson: payload?.message_json,

    title: typeof payload?.title === 'string' ? payload.title : undefined,
    updatedAtUnixMs: typeof payload?.updated_at_unix_ms === 'number' ? payload.updated_at_unix_ms : undefined,
    lastMessagePreview: typeof payload?.last_message_preview === 'string' ? payload.last_message_preview : undefined,
    lastMessageAtUnixMs: typeof payload?.last_message_at_unix_ms === 'number' ? payload.last_message_at_unix_ms : undefined,
    activeRunId: typeof payload?.active_run_id === 'string' ? payload.active_run_id : undefined,
    executionMode: normalizeExecutionMode(payload?.execution_mode),
    queuedTurnCount: typeof payload?.queued_turn_count === 'number' ? payload.queued_turn_count : undefined,

    resetReason: typeof payload?.reset_reason === 'string' ? payload.reset_reason : undefined,
    resetCheckpointId: typeof payload?.reset_checkpoint_id === 'string' ? payload.reset_checkpoint_id : undefined,
  };
}

function fromWireTranscriptMessageItem(raw: wire_ai_transcript_message_item): AITranscriptMessageItem | null {
  const rowId = Number(raw?.row_id ?? 0);
  if (!Number.isFinite(rowId) || rowId <= 0) return null;
  return {
    rowId,
    messageJson: raw?.message_json,
  };
}

export function toWireAIListMessagesRequest(req: AIListMessagesRequest): wire_ai_list_messages_req {
  return {
    thread_id: String(req.threadId ?? '').trim(),
    after_row_id: typeof req.afterRowId === 'number' && Number.isFinite(req.afterRowId) && req.afterRowId > 0 ? Math.floor(req.afterRowId) : undefined,
    tail: req.tail === true ? true : undefined,
    limit: typeof req.limit === 'number' && Number.isFinite(req.limit) && req.limit > 0 ? Math.floor(req.limit) : undefined,
  };
}

export function fromWireAIListMessagesResponse(resp: wire_ai_list_messages_resp): AIListMessagesResponse {
  const items = Array.isArray(resp?.messages) ? resp.messages.map(fromWireTranscriptMessageItem).filter(Boolean) as AITranscriptMessageItem[] : [];
  const next = Number(resp?.next_after_row_id ?? 0);
  return {
    messages: items,
    nextAfterRowId: Number.isFinite(next) && next > 0 ? next : undefined,
    hasMore: Boolean(resp?.has_more ?? false),
  };
}
