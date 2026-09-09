import type { FlowerSubagentDetail, FlowerThreadReadStatus, FlowerThreadSnapshot } from './contracts/flowerSurfaceContracts';
import { threadTitleSnapshot } from './threadTitleSnapshot';
import { trimString } from './flowerSurfaceModel';
import { applyFlowerRuntimeCurrentView } from './runtimeCurrentView';
import { retainThreadPresentation } from './presentationIdentity';

function readStatus(thread: FlowerThreadSnapshot): FlowerThreadReadStatus {
  const revision = Math.max(1, thread.messages.length);
  return {
    is_unread: false,
    snapshot: { activity_revision: revision },
    read_state: { last_seen_activity_revision: revision },
  };
}

export function projectSubagentDetailThread(detail: FlowerSubagentDetail | null, previous?: FlowerThreadSnapshot | null): FlowerThreadSnapshot | null {
  if (!detail) return null;
  const summary = detail.summary;
  const threadID = trimString(summary.thread_id);
  const title = trimString(summary.task_name);
  if (!threadID || !title) return null;

  if (trimString(detail.current.thread_id) !== threadID) return null;
  const updatedAt = Math.max(0, Math.floor(Number(summary.updated_at_ms ?? 0)));
  const base: FlowerThreadSnapshot = {
    thread_id: threadID,
    ...threadTitleSnapshot(summary),
    model_id: '',
    working_dir: '',
    settings_revision: 0,
    created_at_ms: Math.max(0, Math.floor(Number(summary.created_at_ms ?? updatedAt))),
    updated_at_ms: updatedAt,
    status: 'idle',
    source_label: trimString(summary.agent_type) || 'Subagent',
    target_labels: [],
    read_only_reason: 'Subagent details are managed by the parent Flower thread.',
    parent_thread_id: trimString(summary.parent_thread_id),
    messages: [],
    approval_actions: [],
    read_status: {
      is_unread: false,
      snapshot: { activity_revision: 1 },
      read_state: { last_seen_activity_revision: 1 },
    },
  };
  const thread = applyFlowerRuntimeCurrentView(base, detail.current);
  return retainThreadPresentation(previous ?? undefined, { ...thread, read_status: readStatus(thread) });
}
