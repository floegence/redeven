import type {
  FlowerApprovalAction,
  FlowerChatMessage,
  FlowerChatMessageBlock,
  FlowerContextCompaction,
  FlowerTimelineDecoration,
  FlowerInputRequest,
  FlowerLiveBootstrap,
  FlowerLiveBlock,
  FlowerLiveEvent,
  FlowerLiveThreadPatch,
  FlowerModelIOStatus,
  FlowerThreadSnapshot,
  FlowerThreadStatus,
} from './contracts/flowerSurfaceContracts';

function trim(value: unknown): string {
  return String(value ?? '').trim();
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function runStatus(raw: unknown): FlowerThreadStatus {
  switch (trim(raw)) {
    case 'accepted':
    case 'running':
    case 'recovering':
    case 'finalizing':
      return 'running';
    case 'waiting_approval':
      return 'waiting_approval';
    case 'waiting_user':
      return 'waiting_user';
    case 'failed':
    case 'timed_out':
      return 'failed';
    case 'success':
      return 'success';
    case 'canceled':
      return 'canceled';
    case 'read_only':
      return 'read_only';
    default:
      return 'idle';
  }
}

function mergeMessages(messages: readonly FlowerChatMessage[], message: FlowerChatMessage | null | undefined): readonly FlowerChatMessage[] {
  if (!message) return messages;
  const index = messages.findIndex((item) => item.id === message.id);
  if (index < 0) return [...messages, message];
  const next = messages.slice();
  next[index] = message;
  return next;
}

function visibleApprovalAction(action: FlowerApprovalAction): boolean {
  if (action.status === 'pending' && action.state === 'requested') return true;
  if (action.origin !== 'delegated_subagent') return false;
  return action.delivery_state === 'delivery_pending'
    || action.delivery_state === 'delivery_delivered'
    || action.delivery_state === 'delivery_failed'
    || action.delivery_state === 'delivery_ack_unknown'
    || action.delivery_state === 'delivery_unavailable'
    || action.status === 'unavailable';
}

function delegatedApprovalPendingDecision(action: FlowerApprovalAction): boolean {
  return action.origin === 'delegated_subagent'
    && action.status === 'pending'
    && action.state === 'requested'
    && (!action.delivery_state || action.delivery_state === 'waiting_decision');
}

function delegatedApprovalPrimaryWaitAnchor(action: FlowerApprovalAction): string {
  return trim(action.primary_wait_anchor)
    || (trim(action.delegated_ref?.parent_thread_id) ? `thread:${trim(action.delegated_ref?.parent_thread_id)}` : '')
    || trim(action.scope)
    || 'thread';
}

function normalizeDelegatedApprovalSurfaces(actions: readonly FlowerApprovalAction[]): readonly FlowerApprovalAction[] {
  const pending = actions
    .filter(delegatedApprovalPendingDecision)
    .sort((left, right) => {
      const requestedDelta = Number(left.requested_at_ms ?? 0) - Number(right.requested_at_ms ?? 0);
      if (requestedDelta !== 0) return requestedDelta;
      const seqDelta = Number(left.expected_seq ?? 0) - Number(right.expected_seq ?? 0);
      if (seqDelta !== 0) return seqDelta;
      return left.action_id.localeCompare(right.action_id);
    });
  if (pending.length === 0) return actions;
  const primaryID = pending[0].action_id;
  return actions.map((action) => {
    if (!delegatedApprovalPendingDecision(action)) return action;
    const surfaceRole = action.action_id === primaryID ? 'primary_action' : 'locator';
    if (action.surface_role === surfaceRole && trim(action.primary_wait_anchor)) return action;
    return {
      ...action,
      surface_role: surfaceRole,
      primary_wait_anchor: delegatedApprovalPrimaryWaitAnchor(action),
    };
  });
}

function pendingApprovalActions(actions: readonly FlowerApprovalAction[] | undefined): readonly FlowerApprovalAction[] {
  return normalizeDelegatedApprovalSurfaces(actions ?? []).filter(visibleApprovalAction);
}

function blockFromLiveBlock(block: FlowerLiveBlock): FlowerChatMessageBlock | null {
  const type = trim(block.type);
  if (type === 'activity-timeline') {
    return (block.block ?? block) as FlowerChatMessageBlock;
  }
  if (type === 'thinking') {
    return { type: 'thinking', content: text(block.content) };
  }
  if (type === 'markdown' || type === 'text') {
    return { type, content: text(block.content) };
  }
  return null;
}

function contentFromBlocks(blocks: readonly FlowerChatMessageBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === 'activity-timeline') return '';
      if (block.type === 'thinking') return '';
      return trim(block.content);
    })
    .filter(Boolean)
    .join('\n\n');
}

function applyThreadPatch(thread: FlowerThreadSnapshot, patch: FlowerLiveThreadPatch): FlowerThreadSnapshot {
  const status = patch.run_status ? runStatus(patch.run_status) : thread.status;
  return {
    ...thread,
    ...(trim(patch.thread_id) ? { thread_id: trim(patch.thread_id) } : {}),
    ...(trim(patch.title) ? { title: trim(patch.title) } : {}),
    ...(trim(patch.model_id) ? { model_id: trim(patch.model_id) } : {}),
    ...(trim(patch.working_dir) ? { working_dir: trim(patch.working_dir) } : {}),
    ...(Number(patch.pinned_at_ms ?? 0) > 0 ? { pinned_at_ms: Number(patch.pinned_at_ms) } : {}),
    ...(Number(patch.created_at_ms ?? 0) > 0 ? { created_at_ms: Number(patch.created_at_ms) } : {}),
    ...(Number(patch.updated_at_ms ?? 0) > 0 ? { updated_at_ms: Number(patch.updated_at_ms) } : {}),
    status,
    ...(Number(patch.queued_turn_count ?? -1) >= 0 ? { queued_turn_count: Number(patch.queued_turn_count) } : {}),
    ...(patch.permission_type !== undefined ? { permission_type: patch.permission_type } : {}),
    ...(patch.reasoning_selection !== undefined ? { reasoning_selection: patch.reasoning_selection ?? undefined } : {}),
    ...(patch.reasoning_capability !== undefined ? { reasoning_capability: patch.reasoning_capability ?? undefined } : {}),
    ...(patch.read_status ? { read_status: patch.read_status } : {}),
    ...(trim(patch.read_only_reason) ? { read_only_reason: trim(patch.read_only_reason) } : {}),
    ...(trim(patch.owner_kind) ? { owner_kind: trim(patch.owner_kind).toLowerCase() } : {}),
    ...(trim(patch.owner_id) ? { owner_id: trim(patch.owner_id) } : {}),
    ...(trim(patch.parent_thread_id) ? { parent_thread_id: trim(patch.parent_thread_id) } : {}),
    ...(patch.waiting_prompt !== undefined ? { input_request: patch.waiting_prompt ?? null } : {}),
    ...(trim(patch.run_error) ? { error: { message: trim(patch.run_error), ...(trim(patch.run_error_code) ? { code: trim(patch.run_error_code) } : {}) } } : {}),
  };
}

function approvalsFromRecord(actions: Readonly<Record<string, FlowerApprovalAction>>): readonly FlowerApprovalAction[] {
  return normalizeDelegatedApprovalSurfaces(Object.values(actions))
    .filter(visibleApprovalAction)
    .sort((left, right) => left.action_id.localeCompare(right.action_id));
}

function firstInputRequest(inputRequests: Readonly<Record<string, FlowerInputRequest>>): FlowerInputRequest | null {
  return Object.values(inputRequests).sort((left, right) => left.prompt_id.localeCompare(right.prompt_id))[0] ?? null;
}

function activeRunIDFromRuns(runs: FlowerLiveBootstrap['live_state']['runs']): string {
  const active = Object.values(runs)
    .filter((run) => !threadStatusHidesModelIO(runStatus(run.status)))
    .sort((left, right) => trim(left.run_id).localeCompare(trim(right.run_id)))[0];
  return trim(active?.run_id);
}

function threadStatusHidesModelIO(status: FlowerThreadStatus): boolean {
	return status === 'waiting_approval'
		|| status === 'waiting_user'
    || status === 'failed'
    || status === 'success'
    || status === 'canceled'
		|| status === 'idle';
}

function threadStatusClearsActiveRunID(status: FlowerThreadStatus): boolean {
	return status === 'waiting_user'
		|| status === 'failed'
		|| status === 'success'
		|| status === 'canceled'
		|| status === 'idle';
}

function clearModelIOForRun(thread: FlowerThreadSnapshot, runID: string | undefined): FlowerThreadSnapshot {
  const current = thread.model_io_status ?? null;
  if (!current) return thread;
  const targetRunID = trim(runID);
  if (!targetRunID || trim(current.run_id) !== targetRunID) return thread;
  return { ...thread, model_io_status: null };
}

function withoutModelIO(thread: FlowerThreadSnapshot): FlowerThreadSnapshot {
	if (!thread.model_io_status && !thread.active_run_id) return thread;
	return threadStatusClearsActiveRunID(thread.status)
		? { ...thread, model_io_status: null, active_run_id: undefined }
		: { ...thread, model_io_status: null };
}

function withModelIOStatus(thread: FlowerThreadSnapshot, status: FlowerModelIOStatus | null | undefined, runID?: string): FlowerThreadSnapshot {
  if (!status) return clearModelIOForRun(thread, runID);
  if (threadStatusHidesModelIO(thread.status)) return thread;
  const statusRunID = trim(status.run_id || runID);
  if (!statusRunID || trim(thread.active_run_id) !== statusRunID) return thread;
  return { ...thread, model_io_status: status };
}

function upsertContextCompaction(
  thread: FlowerThreadSnapshot,
  compaction: FlowerContextCompaction,
  decoration: FlowerTimelineDecoration,
): FlowerThreadSnapshot {
  const operationID = trim(compaction.operation_id);
  if (!operationID) return thread;
  const compactions = [...(thread.context_compactions ?? [])];
  const compactionIndex = compactions.findIndex((item) => trim(item.operation_id) === operationID);
  if (compactionIndex >= 0) {
    compactions[compactionIndex] = compaction;
  } else {
    compactions.push(compaction);
  }

  const decorations = [...(thread.timeline_decorations ?? [])];
  const decorationIndex = decorations.findIndex((item) => trim(item.decoration_id) === decoration.decoration_id);
  if (decorationIndex >= 0) {
    decorations[decorationIndex] = decoration;
  } else {
    decorations.push(decoration);
  }

  return {
    ...thread,
    context_compactions: compactions,
    timeline_decorations: decorations,
  };
}

function applyLiveMaterializedState(thread: FlowerThreadSnapshot, liveState: FlowerLiveBootstrap['live_state']): FlowerThreadSnapshot {
  let next: FlowerThreadSnapshot = {
    ...thread,
    model_io_status: liveState.model_io ?? null,
    context_usage: liveState.context_usage ?? null,
    context_compactions: liveState.context_compactions ?? [],
    timeline_decorations: liveState.timeline_decorations ?? [],
    approval_actions: approvalsFromRecord(liveState.approval_actions),
  };
  next = applyThreadPatch(next, liveState.thread_patch);
  const inputRequest = firstInputRequest(liveState.input_requests);
  if (inputRequest) {
    next = { ...next, status: 'waiting_user', input_request: inputRequest };
  } else if (next.status !== 'waiting_user') {
    next = { ...next, input_request: null };
  }
	const activeRunID = activeRunIDFromRuns(liveState.runs);
	if (threadStatusHidesModelIO(next.status)) {
		next = withoutModelIO(next);
	} else if (activeRunID) {
		next = { ...next, active_run_id: activeRunID, status: 'running' };
	} else if (threadStatusClearsActiveRunID(next.status)) {
    const { active_run_id: _activeRunID, model_io_status: _modelIOStatus, ...rest } = next;
    next = { ...rest, model_io_status: null };
  }
  return next;
}

export function projectFlowerLiveBootstrap(bootstrap: FlowerLiveBootstrap): FlowerThreadSnapshot {
  const thread: FlowerThreadSnapshot = {
    ...bootstrap.thread,
    read_status: bootstrap.read_status,
    messages: [...bootstrap.timeline_messages],
  };
  return applyLiveMaterializedState(thread, {
    ...bootstrap.live_state,
    context_usage: bootstrap.live_state.context_usage ?? bootstrap.thread.context_usage ?? null,
    context_compactions: bootstrap.live_state.context_compactions ?? bootstrap.thread.context_compactions ?? [],
    timeline_decorations: bootstrap.live_state.timeline_decorations ?? bootstrap.thread.timeline_decorations ?? [],
  });
}

export type FlowerLiveEventResult = Readonly<{
  thread: FlowerThreadSnapshot;
  cursor: number;
  resyncRequired: boolean;
  tailKey: string;
  tailLength: number;
}>;

function upsertBlock(message: FlowerChatMessage, blockIndex: number, block: FlowerChatMessageBlock): FlowerChatMessage | null {
  if (blockIndex < 0) return null;
  const blocks = [...(message.blocks ?? [])];
  if (blockIndex > blocks.length) return null;
  blocks[blockIndex] = block;
  return { ...message, blocks, content: contentFromBlocks(blocks) };
}

function appendBlockDelta(message: FlowerChatMessage, blockIndex: number, delta: string): FlowerChatMessage | null {
  const blocks = [...(message.blocks ?? [])];
  if (blockIndex < 0 || blockIndex >= blocks.length) return null;
  const current = blocks[blockIndex];
  if (!current || current.type === 'activity-timeline') return null;
  blocks[blockIndex] = {
    type: current.type,
    content: `${current.content ?? ''}${delta}`,
  };
  return { ...message, blocks, content: contentFromBlocks(blocks) };
}

function findMessage(thread: FlowerThreadSnapshot, messageID: string): FlowerChatMessage | null {
  return thread.messages.find((message) => message.id === messageID) ?? null;
}

function replaceMessage(thread: FlowerThreadSnapshot, message: FlowerChatMessage): FlowerThreadSnapshot {
  return { ...thread, messages: mergeMessages(thread.messages, message) };
}

function withSingleActiveAssistantCursor(messages: readonly FlowerChatMessage[], activeID: string): readonly FlowerChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'assistant') return message;
    const shouldBeActive = message.id === activeID;
    if (shouldBeActive && message.active_cursor === true) return message;
    if (!shouldBeActive && message.active_cursor !== true) return message;
    if (shouldBeActive) return { ...message, active_cursor: true };
    const next = { ...message };
    delete next.active_cursor;
    return next;
  });
}

function upsertStreamingAssistantMessage(
  thread: FlowerThreadSnapshot,
  messageID: string,
  createdAtMs: number,
): FlowerThreadSnapshot | null {
  messageID = trim(messageID);
  if (!messageID) return null;
  const current = findMessage(thread, messageID);
  const nextMessage: FlowerChatMessage = current
    ? {
        ...current,
        role: 'assistant',
        status: current.status === 'complete' ? current.status : 'streaming',
        created_at_ms: current.created_at_ms || createdAtMs,
        active_cursor: current.status === 'complete' ? current.active_cursor : true,
      }
    : {
        id: messageID,
        role: 'assistant',
        content: '',
        status: 'streaming',
        created_at_ms: createdAtMs,
        blocks: [],
        active_cursor: true,
      };
  const replaced = replaceMessage(thread, nextMessage);
  return {
    ...replaced,
    messages: withSingleActiveAssistantCursor(replaced.messages, messageID),
  };
}

function updateMessageStrict(
  thread: FlowerThreadSnapshot,
  messageID: string,
  update: (message: FlowerChatMessage) => FlowerChatMessage | null,
): { thread: FlowerThreadSnapshot; ok: boolean } {
  const current = findMessage(thread, messageID);
  if (!current) return { thread, ok: false };
  const updated = update(current);
  if (!updated) return { thread, ok: false };
  return { thread: replaceMessage(thread, updated), ok: true };
}

function withApprovalAction(thread: FlowerThreadSnapshot, action: FlowerApprovalAction): FlowerThreadSnapshot {
  const current = thread.approval_actions ?? [];
  const next = current.filter((item) => item.action_id !== action.action_id);
  if (visibleApprovalAction(action)) {
    next.push(action);
  }
  const approvalActions = normalizeDelegatedApprovalSurfaces(next)
    .filter(visibleApprovalAction)
    .sort((left, right) => left.action_id.localeCompare(right.action_id));
  const updated = {
    ...thread,
    approval_actions: approvalActions,
    status: action.status === 'pending' ? 'waiting_approval' : thread.status,
  };
  return action.status === 'pending' ? clearModelIOForRun(updated, action.run_id) : updated;
}

export function applyFlowerLiveEvent(
  current: FlowerThreadSnapshot,
  cursor: number,
  event: FlowerLiveEvent,
): FlowerLiveEventResult {
  if (event.kind === 'stream.resync_required') {
    return { thread: current, cursor, resyncRequired: true, tailKey: '', tailLength: 0 };
  }
  if (event.seq <= cursor) {
    return { thread: current, cursor, resyncRequired: false, tailKey: '', tailLength: 0 };
  }

  let next = current;
  let tailKey = '';
  let tailLength = 0;
  let resyncRequired = false;

  switch (event.kind) {
    case 'run.started':
      next = { ...next, status: 'running', active_run_id: trim(event.payload.run_id) || trim(event.run_id) || next.active_run_id };
      break;
    case 'run.status_changed':
      next = {
        ...next,
        status: runStatus(event.payload.status),
        ...(event.payload.waiting_prompt !== undefined ? { input_request: event.payload.waiting_prompt ?? null } : {}),
        ...(trim(event.payload.error) ? { error: { message: trim(event.payload.error), ...(trim(event.payload.error_code) ? { code: trim(event.payload.error_code) } : {}) } } : {}),
      };
		if (threadStatusHidesModelIO(next.status)) {
			next = clearModelIOForRun(next, event.payload.run_id);
			if (threadStatusClearsActiveRunID(next.status) && trim(next.active_run_id) === trim(event.payload.run_id)) {
				next = { ...next, active_run_id: undefined };
			}
		} else if (trim(event.payload.run_id)) {
        next = { ...next, active_run_id: trim(event.payload.run_id) };
      }
      break;
    case 'thread.patched':
      next = applyThreadPatch(next, event.payload.patch);
      if (threadStatusHidesModelIO(next.status)) {
        next = withoutModelIO(next);
      }
      break;
    case 'message.started':
      {
        const started = upsertStreamingAssistantMessage(
          next,
          event.payload.message_id,
          Number(event.payload.created_at_ms || event.at_unix_ms || 0),
        );
        if (!started) {
          resyncRequired = true;
          break;
        }
        next = started;
      }
      break;
    case 'message.block_started':
      {
        const block = blockFromLiveBlock({ type: event.payload.block_type, content: '' });
        if (!block || block.type === 'activity-timeline') {
          resyncRequired = true;
          break;
        }
        const result = updateMessageStrict(next, event.payload.message_id, (message) => upsertBlock(message, event.payload.block_index, block));
        next = result.thread;
        resyncRequired = !result.ok;
      }
      break;
    case 'message.block_delta':
      {
        const result = updateMessageStrict(next, event.payload.message_id, (message) => appendBlockDelta(message, event.payload.block_index, event.payload.delta));
        next = result.thread;
        resyncRequired = !result.ok;
      }
      tailKey = `message:${event.payload.message_id}:block:${event.payload.block_index}`;
      tailLength = event.payload.delta.length;
      break;
    case 'message.block_set':
      {
        const block = blockFromLiveBlock({
          type: trim(event.payload.block?.type),
          content: text(event.payload.block?.content),
          block: event.payload.block?.block ?? event.payload.block,
        });
        if (!block) {
          resyncRequired = true;
          break;
        }
        const result = updateMessageStrict(next, event.payload.message_id, (message) => upsertBlock(message, event.payload.block_index, block));
        next = result.thread;
        resyncRequired = !result.ok;
      }
      break;
    case 'message.committed':
      if (!event.payload.message || !trim(event.payload.message.id)) {
        resyncRequired = true;
      } else {
        next = {
          ...replaceMessage(next, event.payload.message),
          approval_actions: pendingApprovalActions(next.approval_actions),
        };
      }
      break;
    case 'message.failed':
      {
        const result = updateMessageStrict(next, event.payload.message_id, (message) => ({ ...message, status: 'error' }));
        next = result.thread;
        resyncRequired = !result.ok;
      }
      break;
    case 'approval.requested':
    case 'approval.resolved':
      if (event.payload.action) {
        next = withApprovalAction(next, event.payload.action);
      }
      break;
    case 'input.requested':
      if (event.payload.request) {
        next = clearModelIOForRun({ ...next, status: 'waiting_user', input_request: event.payload.request }, event.run_id);
      }
      break;
    case 'input.resolved':
      next = { ...next, input_request: null };
      break;
    case 'activity.updated':
      {
        const result = updateMessageStrict(next, event.payload.message_id, (message) => upsertBlock(message, event.payload.block_index, event.payload.activity));
        next = result.thread;
        resyncRequired = !result.ok;
      }
      break;
    case 'model_io.updated':
      next = withModelIOStatus(next, event.payload.status ?? null, event.run_id);
      break;
    case 'context.usage.updated':
      next = { ...next, context_usage: event.payload.usage };
      break;
    case 'context.compaction.updated':
      next = upsertContextCompaction(next, event.payload.compaction, event.payload.timeline_decoration);
      break;
    case 'timeline.replaced':
      next = {
        ...next,
        messages: [...event.payload.messages],
      };
      if (event.payload.read_status) {
        next = { ...next, read_status: event.payload.read_status };
      }
      if (event.payload.context_usage !== undefined) {
        next = { ...next, context_usage: event.payload.context_usage };
      }
      if (event.payload.context_compactions !== undefined) {
        next = { ...next, context_compactions: [...event.payload.context_compactions] };
      }
      if (event.payload.timeline_decorations !== undefined) {
        next = { ...next, timeline_decorations: [...event.payload.timeline_decorations] };
      }
      if (event.payload.thread_patch) {
        next = applyThreadPatch(next, event.payload.thread_patch);
      }
      if (event.payload.live_state) {
        next = applyLiveMaterializedState(next, event.payload.live_state);
      }
      if (threadStatusHidesModelIO(next.status)) {
        next = withoutModelIO(next);
      }
      break;
  }

  const nextCursor = event.kind === 'timeline.replaced'
    ? Math.max(event.seq, Math.floor(Number(event.payload.snapshot_through_seq ?? 0)))
    : event.seq;
  return { thread: next, cursor: nextCursor, resyncRequired, tailKey, tailLength };
}
