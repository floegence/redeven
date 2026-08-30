import type {
  FlowerChatMessage,
  FlowerSubagentDetail,
  FlowerThreadReadStatus,
  FlowerThreadSnapshot,
  FlowerThreadStatus,
} from './contracts/flowerSurfaceContracts';
import { trimString } from './flowerSurfaceModel';

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

function canonicalMessages(detail: FlowerSubagentDetail): FlowerChatMessage[] {
  return [...detail.messages];
}

function readStatus(thread: FlowerThreadSnapshot): FlowerThreadReadStatus {
  const revision = Math.max(1, thread.messages.length);
  return {
    is_unread: false,
    snapshot: { activity_revision: revision },
    read_state: { last_seen_activity_revision: revision },
  };
}

export function projectSubagentDetailThread(detail: FlowerSubagentDetail | null): FlowerThreadSnapshot | null {
  if (!detail) return null;
  const summary = detail.summary;
  const threadID = trimString(summary.thread_id);
  const title = trimString(summary.task_name);
  if (!threadID || !title) return null;

  // Typed Floret turns are the only transcript authority. Diagnostic rows and
  // aggregate activity remain available to the detail ledger only.
  const messages = canonicalMessages(detail);
  const status = subagentThreadStatus(summary.status);
  const updatedAt = Math.max(0, Math.floor(Number(summary.updated_at_ms ?? detail.generated_at_ms ?? 0)));
  const thread: FlowerThreadSnapshot = {
    thread_id: threadID,
    title,
    title_status: 'ready',
    model_id: '',
    working_dir: '',
    settings_revision: 0,
    created_at_ms: Math.max(0, Math.floor(Number(summary.created_at_ms ?? updatedAt))),
    updated_at_ms: updatedAt,
    status,
    source_label: trimString(summary.agent_type) || 'Subagent',
    target_labels: [],
    read_only_reason: 'Subagent details are managed by the parent Flower thread.',
    parent_thread_id: trimString(summary.parent_thread_id),
    messages,
    context_usage: detail.context_usage ?? null,
    context_compactions: detail.context_compactions ?? [],
    timeline_decorations: detail.timeline_decorations ?? [],
    approval_actions: [],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 1 },
      read_state: { last_seen_activity_revision: 1 },
    },
  };
  return { ...thread, read_status: readStatus(thread) };
}
