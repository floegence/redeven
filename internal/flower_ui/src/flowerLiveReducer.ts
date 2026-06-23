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

function pendingApprovalActions(actions: readonly FlowerApprovalAction[] | undefined): readonly FlowerApprovalAction[] {
  return (actions ?? []).filter((action) => action.status === 'pending' && action.state === 'requested');
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
    ...(patch.reasoning_selection !== undefined ? { reasoning_selection: patch.reasoning_selection ?? undefined } : {}),
    ...(patch.reasoning_capability !== undefined ? { reasoning_capability: patch.reasoning_capability ?? undefined } : {}),
    ...(patch.read_status ? { read_status: patch.read_status } : {}),
    ...(patch.waiting_prompt !== undefined ? { input_request: patch.waiting_prompt ?? null } : {}),
    ...(trim(patch.run_error) ? { error: { message: trim(patch.run_error), ...(trim(patch.run_error_code) ? { code: trim(patch.run_error_code) } : {}) } } : {}),
  };
}

function approvalsFromRecord(actions: Readonly<Record<string, FlowerApprovalAction>>): readonly FlowerApprovalAction[] {
  return pendingApprovalActions(Object.values(actions).sort((left, right) => left.action_id.localeCompare(right.action_id)));
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

function clearModelIOForRun(thread: FlowerThreadSnapshot, runID: string | undefined): FlowerThreadSnapshot {
  const current = thread.model_io_status ?? null;
  if (!current) return thread;
  const targetRunID = trim(runID);
  if (!targetRunID || trim(current.run_id) !== targetRunID) return thread;
  return { ...thread, model_io_status: null };
}

function withoutModelIO(thread: FlowerThreadSnapshot): FlowerThreadSnapshot {
  if (!thread.model_io_status && !thread.active_run_id) return thread;
  return { ...thread, model_io_status: null, active_run_id: undefined };
}

function withModelIOStatus(thread: FlowerThreadSnapshot, status: FlowerModelIOStatus | null | undefined, runID?: string): FlowerThreadSnapshot {
  if (!status) return clearModelIOForRun(thread, runID);
  if (threadStatusHidesModelIO(thread.status)) return thread;
  const statusRunID = trim(status.run_id || runID);
  if (!statusRunID || trim(thread.active_run_id) !== statusRunID) return thread;
  return { ...thread, model_io_status: status };
}

function contextCompactionDecorationID(compaction: FlowerContextCompaction): string {
  return `context-compaction:${trim(compaction.operation_id)}`;
}

function timelineDecorationForCompaction(thread: FlowerThreadSnapshot, compaction: FlowerContextCompaction): FlowerTimelineDecoration {
  const existing = (thread.timeline_decorations ?? []).find((decoration) => decoration.decoration_id === contextCompactionDecorationID(compaction));
  const anchorMessageID = trim(compaction.anchor_message_id) || trim(existing?.anchor_message_id);
  return {
    decoration_id: contextCompactionDecorationID(compaction),
    kind: 'context_compaction',
    placement: 'before',
    ordinal: existing?.ordinal ?? thread.timeline_decorations?.length ?? 0,
    ...(anchorMessageID ? { anchor_message_id: anchorMessageID } : {}),
    compaction,
  };
}

function upsertContextCompaction(thread: FlowerThreadSnapshot, compaction: FlowerContextCompaction): FlowerThreadSnapshot {
  const operationID = trim(compaction.operation_id);
  if (!operationID) return thread;
  const compactions = [...(thread.context_compactions ?? [])];
  const compactionIndex = compactions.findIndex((item) => trim(item.operation_id) === operationID);
  if (compactionIndex >= 0) {
    compactions[compactionIndex] = compaction;
  } else {
    compactions.push(compaction);
  }

  const decoration = timelineDecorationForCompaction(thread, compaction);
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

export function projectFlowerLiveBootstrap(bootstrap: FlowerLiveBootstrap): FlowerThreadSnapshot {
  let thread: FlowerThreadSnapshot = {
    ...bootstrap.thread,
    read_status: bootstrap.read_status,
    messages: [...bootstrap.timeline_messages],
    model_io_status: bootstrap.live_state.model_io ?? null,
    context_usage: bootstrap.live_state.context_usage ?? bootstrap.thread.context_usage ?? null,
    context_compactions: bootstrap.live_state.context_compactions ?? bootstrap.thread.context_compactions ?? [],
    timeline_decorations: bootstrap.live_state.timeline_decorations ?? bootstrap.thread.timeline_decorations ?? [],
    approval_actions: approvalsFromRecord(bootstrap.live_state.approval_actions),
  };
  thread = applyThreadPatch(thread, bootstrap.live_state.thread_patch);
  const inputRequest = firstInputRequest(bootstrap.live_state.input_requests);
  if (inputRequest) {
    thread = { ...thread, status: 'waiting_user', input_request: inputRequest };
  }
  const activeRunID = activeRunIDFromRuns(bootstrap.live_state.runs);
  if (activeRunID) {
    thread = { ...thread, active_run_id: activeRunID };
  }
  if (threadStatusHidesModelIO(thread.status)) {
    thread = withoutModelIO(thread);
  } else if (thread.model_io_status && trim(thread.model_io_status.run_id) !== trim(thread.active_run_id)) {
    thread = { ...thread, model_io_status: null };
  }
  return thread;
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
  if (action.status === 'pending' && action.state === 'requested') {
    next.push(action);
  }
  const updated = {
    ...thread,
    approval_actions: next.sort((left, right) => left.action_id.localeCompare(right.action_id)),
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
        if (trim(next.active_run_id) === trim(event.payload.run_id)) {
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
      if (findMessage(next, event.payload.message_id || event.payload.message.id)) {
        next = {
          ...replaceMessage(next, event.payload.message),
          approval_actions: pendingApprovalActions(next.approval_actions),
        };
      } else {
        resyncRequired = true;
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
      next = upsertContextCompaction(next, event.payload.compaction);
      break;
    case 'timeline.replaced':
      next = {
        ...next,
        messages: [...event.payload.messages],
      };
      break;
  }

  return { thread: next, cursor: event.seq, resyncRequired, tailKey, tailLength };
}
