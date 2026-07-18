import type {
  FlowerChatMessage,
  FlowerChatMessageRole,
  FlowerChatMessageStatus,
  FlowerActivityAttentionReason,
  FlowerActivityItem,
  FlowerActivityStatus,
  FlowerActivitySeverity,
  FlowerActivityTimelineBlock,
  FlowerSubagentDetail,
  FlowerSubagentTimelineRow,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerThreadStatus,
} from './contracts/flowerSurfaceContracts';
import { trimString } from './flowerSurfaceModel';

type OrderedMessage = {
  message: FlowerChatMessage;
  ordinal: number;
  sequence: number;
};

type ActivityAnchor = {
  ordinal: number;
  createdAtMs: number;
  key: string;
};

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

function rowOrdinal(row: FlowerSubagentTimelineRow): number {
  const ordinal = Number(row.ordinal ?? 0);
  return Number.isFinite(ordinal) ? ordinal : 0;
}

function messageForTextRow(threadID: string, row: FlowerSubagentTimelineRow): FlowerChatMessage | null {
  const text = trimString(row.message?.text) || trimString(row.message?.preview) || trimString(row.error);
  if (!text) return null;
  if (row.kind === 'user_message' && isRawDelegatedMission(row.metadata)) return null;
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

function isRawDelegatedMission(metadata?: Readonly<Record<string, string>>): boolean {
  if (trimString(metadata?.raw_omitted) === 'true') return false;
  return trimString(metadata?.subagent_prompt_kind) === 'delegated_mission';
}

function activityItemAnchorID(item: FlowerActivityItem): string {
  const toolID = trimString(item.tool_id);
  if (toolID) return toolID;
  const itemID = trimString(item.item_id);
  if (itemID.startsWith('tool:')) return trimString(itemID.slice('tool:'.length));
  return itemID;
}

function rowActivityAnchorID(row: FlowerSubagentTimelineRow): string {
  switch (row.kind) {
    case 'tool_activity':
    case 'tool_call':
      return trimString(row.tool_call?.id);
    case 'tool_result':
      return trimString(row.tool_result?.call_id);
    case 'approval':
      return trimString(row.approval?.tool_id);
    case 'custom': {
      const eventType = trimString(row.type).replace(/_/g, '-');
      return eventType ? `event-${eventType}` : '';
    }
    default:
      return '';
  }
}

function isActivityAnchorRow(row: FlowerSubagentTimelineRow): boolean {
  return row.kind === 'tool_activity' || row.kind === 'tool_call' || row.kind === 'tool_result' || row.kind === 'approval' || row.kind === 'custom';
}

function activityAnchors(detail: FlowerSubagentDetail): ActivityAnchor[] {
  return detail.timeline
    .filter(isActivityAnchorRow)
    .map((row) => ({
      ordinal: rowOrdinal(row),
      createdAtMs: Math.max(0, Math.floor(Number(row.created_at_ms ?? 0))),
      key: rowActivityAnchorID(row),
    }))
    .filter((anchor) => anchor.ordinal > 0)
    .sort((left, right) => left.ordinal - right.ordinal);
}

function activitySeverityRank(severity: FlowerActivitySeverity): number {
  switch (severity) {
    case 'blocking':
      return 4;
    case 'error':
      return 3;
    case 'warning':
      return 2;
    case 'normal':
      return 1;
    case 'quiet':
    default:
      return 0;
  }
}

function maxActivitySeverity(left: FlowerActivitySeverity, right: FlowerActivitySeverity): FlowerActivitySeverity {
  return activitySeverityRank(right) > activitySeverityRank(left) ? right : left;
}

function summarizeActivityItems(items: readonly FlowerActivityItem[], fallbackStatus: FlowerActivityStatus, fallbackSeverity: FlowerActivitySeverity) {
  const counts: Record<string, number> = {};
  let needsAttention = false;
  let severity = fallbackSeverity;
  const attentionReasons = new Set<FlowerActivityAttentionReason>();
  for (const item of items) {
    counts[item.status] = (counts[item.status] ?? 0) + 1;
    if (item.requires_approval) counts.approval = (counts.approval ?? 0) + 1;
    if (item.needs_attention) needsAttention = true;
    severity = maxActivitySeverity(severity, item.severity);
    for (const reason of item.attention_reasons ?? []) {
      attentionReasons.add(reason);
    }
  }
  let status: FlowerActivityStatus = fallbackStatus;
  if ((counts.waiting ?? 0) > 0) status = 'waiting';
  else if ((counts.running ?? 0) > 0) status = 'running';
  else if ((counts.pending ?? 0) > 0) status = 'pending';
  else if ((counts.error ?? 0) > 0) status = 'error';
  else if ((counts.canceled ?? 0) > 0 && (counts.success ?? 0) === 0) status = 'canceled';
  else status = 'success';
  if ((counts.error ?? 0) > 0 && status !== 'waiting') status = 'error';
  const attention = [...attentionReasons];
  return {
    status,
    severity,
    needs_attention: needsAttention || attention.length > 0,
    ...(attention.length > 0 ? { attention_reasons: attention } : {}),
    total_items: items.length,
    counts,
  };
}

function activityBlockForItems(detail: FlowerSubagentDetail, items: readonly FlowerActivityItem[]): FlowerActivityTimelineBlock | null {
  const activity = detail.activity;
  if (!activity || items.length === 0) return null;
  return {
    ...activity,
    summary: summarizeActivityItems(items, activity.summary.status, activity.summary.severity),
    items,
  };
}

function messagesForCanonicalActivity(threadID: string, detail: FlowerSubagentDetail): OrderedMessage[] {
  const activity = detail.activity;
  if (!activity || activity.items.length === 0) return [];
  const anchors = activityAnchors(detail);
  const anchorsByID = new Map<string, ActivityAnchor>();
  for (const anchor of anchors) {
    if (anchor.key && !anchorsByID.has(anchor.key)) anchorsByID.set(anchor.key, anchor);
  }
  const fallbackAnchor: ActivityAnchor = {
    ordinal: Number.MAX_SAFE_INTEGER,
    createdAtMs: canonicalActivityCreatedAt(detail),
    key: 'canonical',
  };
  const grouped = new Map<number, { anchor: ActivityAnchor; items: FlowerActivityItem[] }>();
  for (const item of activity.items) {
    const anchorID = activityItemAnchorID(item);
    const anchor = anchorsByID.get(anchorID);
    if (!anchor && anchors.length > 0) continue;
    const targetAnchor = anchor ?? fallbackAnchor;
    const existing = grouped.get(targetAnchor.ordinal);
    if (existing) {
      existing.items.push(item);
    } else {
      grouped.set(targetAnchor.ordinal, { anchor: targetAnchor, items: [item] });
    }
  }
  const messages: OrderedMessage[] = [];
  [...grouped.values()]
    .sort((left, right) => left.anchor.ordinal - right.anchor.ordinal)
    .forEach((entry, index) => {
      const block = activityBlockForItems(detail, entry.items);
      if (!block) return;
      messages.push({
        ordinal: entry.anchor.ordinal,
        sequence: index,
        message: {
          id: `${safeIDPart(threadID)}:activity:${entry.anchor.ordinal}:${safeIDPart(entry.anchor.key || String(index))}`,
          role: 'assistant',
          content: '',
          status: 'complete',
          created_at_ms: entry.anchor.createdAtMs || canonicalActivityCreatedAt(detail),
          blocks: [block],
        },
      });
    });
  return messages;
}

function canonicalActivityCreatedAt(detail: FlowerSubagentDetail): number {
  const toolRows = detail.timeline
    .filter((row) => row.kind === 'tool_activity' || row.kind === 'tool_call' || row.kind === 'tool_result' || row.kind === 'approval')
    .map((row) => Math.max(0, Math.floor(Number(row.created_at_ms ?? 0))))
    .filter((value) => value > 0);
  if (toolRows.length > 0) return Math.min(...toolRows);
  return Math.max(0, Math.floor(Number(detail.generated_at_ms ?? detail.summary.updated_at_ms ?? 0)));
}

function orderedMessageSort(left: OrderedMessage, right: OrderedMessage): number {
  if (left.ordinal !== right.ordinal) return left.ordinal - right.ordinal;
  const leftCreatedAt = Math.max(0, Math.floor(Number(left.message.created_at_ms ?? 0)));
  const rightCreatedAt = Math.max(0, Math.floor(Number(right.message.created_at_ms ?? 0)));
  if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
  return left.sequence - right.sequence;
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

export function projectSubagentDetailThread(detail: FlowerSubagentDetail | null): FlowerThreadSnapshot | null {
  if (!detail) return null;
  const summary = detail.summary;
  const threadID = trimString(summary.thread_id);
  const title = trimString(summary.task_name);
  if (!threadID || !title) return null;
  const orderedMessages: OrderedMessage[] = [];
  let messageSequence = 0;
  for (const row of [...detail.timeline].sort((left, right) => rowOrdinal(left) - rowOrdinal(right))) {
    const message = row.kind === 'user_message' || row.kind === 'assistant_message' || row.kind === 'error'
      ? messageForTextRow(threadID, row)
      : null;
    if (message) {
      orderedMessages.push({ message, ordinal: rowOrdinal(row), sequence: messageSequence++ });
      continue;
    }
  }
  const activityMessages = messagesForCanonicalActivity(threadID, detail);
  for (const entry of activityMessages) {
    orderedMessages.push({ ...entry, sequence: messageSequence++ });
  }
  orderedMessages.sort(orderedMessageSort);
  const messages = orderedMessages.map((entry) => entry.message);
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
    parent_thread_id: trimString(summary.parent_thread_id),
    messages,
    model_io_status: detail.model_io_status ?? null,
    context_usage: detail.context_usage ?? null,
    context_compactions: detail.context_compactions ?? [],
    timeline_decorations: detail.timeline_decorations ?? [],
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
