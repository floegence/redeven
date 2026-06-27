import type {
  FlowerChatMessage,
  FlowerChatMessageRole,
  FlowerChatMessageStatus,
  FlowerContextCompaction,
  FlowerSubagentDetail,
  FlowerSubagentTimelineRow,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerThreadStatus,
  FlowerTimelineDecoration,
} from './contracts/flowerSurfaceContracts';
import { trimString } from './flowerSurfaceModel';

function safeIDPart(value: string): string {
  return trimString(value).replace(/[^a-zA-Z0-9_.:-]+/g, '_') || 'subagent';
}

function subagentThreadStatus(status: string): FlowerThreadStatus {
  switch (trimString(status)) {
    case 'queued':
    case 'running':
      return 'running';
    case 'waiting_input':
    case 'waiting':
      return 'waiting_user';
    case 'completed':
    case 'success':
      return 'success';
    case 'failed':
    case 'timed_out':
      return 'failed';
    case 'canceled':
    case 'cancelled':
      return 'canceled';
    default:
      return 'idle';
  }
}

function normalizeMessageRole(role: string | undefined): FlowerChatMessageRole {
  switch (trimString(role)) {
    case 'user':
      return 'user';
    case 'system':
      return 'system';
    default:
      return 'assistant';
  }
}

function messageStatus(row: FlowerSubagentTimelineRow): FlowerChatMessageStatus {
  if (row.kind === 'error' || trimString(row.error)) return 'error';
  return 'complete';
}

function rowMessageID(threadID: string, row: FlowerSubagentTimelineRow, suffix: string): string {
  return `${safeIDPart(threadID)}:${Math.max(0, Math.floor(Number(row.ordinal ?? 0)))}:${suffix}`;
}

function messageForTextRow(threadID: string, row: FlowerSubagentTimelineRow): FlowerChatMessage | null {
  const text = trimString(row.message?.text) || trimString(row.message?.preview) || trimString(row.error);
  if (!text) return null;
  const status = messageStatus(row);
  return {
    id: rowMessageID(threadID, row, status === 'error' ? 'error' : 'message'),
    role: row.kind === 'error' ? 'assistant' : normalizeMessageRole(row.message?.role),
    content: text,
    status,
    created_at_ms: Math.max(0, Math.floor(Number(row.created_at_ms ?? 0))),
    blocks: [{ type: status === 'error' ? 'text' : 'markdown', content: text }],
  };
}

function messageForActivityRow(threadID: string, row: FlowerSubagentTimelineRow): FlowerChatMessage | null {
  if (!row.activity) return null;
  return {
    id: rowMessageID(threadID, row, 'activity'),
    role: 'assistant',
    content: '',
    status: 'complete',
    created_at_ms: Math.max(0, Math.floor(Number(row.created_at_ms ?? 0))),
    blocks: [row.activity],
  };
}

function messageForSummaryOnlyDetail(threadID: string, detail: FlowerSubagentDetail): FlowerChatMessage | null {
  const summary = detail.summary;
  const text = trimString(summary.waiting_prompt) || trimString(summary.last_message);
  if (!text) return null;
  const updatedAt = Math.max(0, Math.floor(Number(summary.updated_at_ms ?? detail.generated_at_ms ?? 0)));
  const waiting = trimString(summary.status) === 'waiting_input' || trimString(summary.status) === 'waiting';
  return {
    id: `${safeIDPart(threadID)}:summary:${waiting ? 'waiting' : 'message'}`,
    role: 'assistant',
    content: text,
    status: 'complete',
    created_at_ms: updatedAt,
    blocks: [{ type: waiting ? 'text' : 'markdown', content: text }],
  };
}

function compactionDecoration(threadID: string, row: FlowerSubagentTimelineRow, anchorMessageID: string): FlowerTimelineDecoration | null {
  if (row.kind !== 'compaction' || !row.compaction || !trimString(anchorMessageID)) return null;
  const ordinal = Math.max(0, Math.floor(Number(row.ordinal ?? 0)));
  const operationID = `${safeIDPart(threadID)}:compaction:${ordinal}`;
  const compaction: FlowerContextCompaction = {
    operation_id: operationID,
    phase: trimString(row.compaction.phase) || 'complete',
    status: trimString(row.compaction.phase) === 'failed' ? 'failed' : 'compacted',
    trigger: trimString(row.compaction.trigger),
    reason: trimString(row.compaction.reason) || trimString(row.compaction.summary),
    tokens_before: Number(row.compaction.tokens_before ?? 0) || undefined,
    tokens_after_estimate: Number(row.compaction.tokens_after_estimate ?? 0) || undefined,
    updated_at_ms: Math.max(0, Math.floor(Number(row.created_at_ms ?? 0))),
  };
  return {
    decoration_id: operationID,
    kind: 'context_compaction',
    anchor: {
      target_kind: 'message',
      message_id: anchorMessageID,
      edge: 'after',
    },
    ordinal,
    compaction,
  };
}

function readStatus(thread: FlowerThreadSnapshot): FlowerThreadReadStatus {
  const signature = `status:${thread.status}\x1fmessages:${thread.messages.length}\x1fupdated:${thread.updated_at_ms}`;
  return {
    is_unread: false,
    snapshot: {
      activity_revision: Math.max(1, thread.messages.length),
      last_message_at_unix_ms: thread.updated_at_ms,
      activity_signature: signature,
    },
    read_state: {
      last_seen_activity_revision: Math.max(1, thread.messages.length),
      last_read_message_at_unix_ms: thread.updated_at_ms,
      last_seen_activity_signature: signature,
    },
  };
}

export function projectSubagentDetailThread(detail: FlowerSubagentDetail | null, fallbackThreadID: string, fallbackTitle: string): FlowerThreadSnapshot | null {
  if (!detail) return null;
  const summary = detail.summary;
  const threadID = trimString(summary.thread_id || summary.subagent_id || fallbackThreadID);
  if (!threadID) return null;
  const title = trimString(summary.title) || trimString(summary.task_name) || trimString(fallbackTitle) || threadID;
  const messages: FlowerChatMessage[] = [];
  const decorations: FlowerTimelineDecoration[] = [];
  let lastMessageID = '';
  for (const row of [...detail.timeline].sort((left, right) => left.ordinal - right.ordinal)) {
    if (row.kind === 'compaction') {
      const decoration = compactionDecoration(threadID, row, lastMessageID);
      if (decoration) decorations.push(decoration);
      continue;
    }
    const message = row.kind === 'user_message' || row.kind === 'assistant_message' || row.kind === 'error'
      ? messageForTextRow(threadID, row)
      : null;
    if (message) {
      messages.push(message);
      lastMessageID = message.id;
      continue;
    }
    const activityMessage = messageForActivityRow(threadID, row);
    if (!activityMessage) continue;
    messages.push(activityMessage);
    lastMessageID = activityMessage.id;
  }
  if (messages.length === 0) {
    const summaryMessage = messageForSummaryOnlyDetail(threadID, detail);
    if (summaryMessage) messages.push(summaryMessage);
  }

  const status = subagentThreadStatus(summary.status);
  const updatedAt = Math.max(0, Math.floor(Number(summary.updated_at_ms ?? detail.generated_at_ms ?? 0)));
  const thread: FlowerThreadSnapshot = {
    thread_id: threadID,
    title,
    model_id: '',
    working_dir: '',
    created_at_ms: Math.max(0, Math.floor(Number(summary.created_at_ms ?? updatedAt))),
    updated_at_ms: updatedAt,
    status,
    source_label: trimString(summary.agent_type) || 'Subagent',
    target_labels: [],
    read_only_reason: 'Subagent details are managed by the parent Flower thread.',
    owner_kind: 'subagent_projection',
    owner_id: trimString(summary.subagent_id) || threadID,
    parent_thread_id: trimString(summary.parent_thread_id),
    messages,
    timeline_decorations: decorations,
    approval_actions: [],
    read_status: {
      is_unread: false,
      snapshot: {
        activity_revision: 1,
        last_message_at_unix_ms: updatedAt,
        activity_signature: '',
      },
      read_state: {
        last_seen_activity_revision: 1,
        last_read_message_at_unix_ms: updatedAt,
        last_seen_activity_signature: '',
      },
    },
  };
  return {
    ...thread,
    read_status: readStatus(thread),
  };
}
