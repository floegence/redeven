import type {
  FlowerActivityItem,
  FlowerActivityTimelineBlock,
  FlowerThreadSnapshot,
} from './contracts/flowerSurfaceContracts';
import { trimString } from './flowerSurfaceModel';

export type FlowerSubagentPanelStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'canceled'
  | 'timed_out'
  | 'unknown';

export type FlowerSubagentPanelItem = Readonly<{
  key: string;
  threadID: string;
  subagentID: string;
  taskName: string;
  title: string;
  agentType: string;
  status: FlowerSubagentPanelStatus;
  lastMessage: string;
  action: string;
  canOpen: boolean;
  updatedAtMs: number;
  itemStatus: FlowerActivityItem['status'];
}>;

type SnapshotSource = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): SnapshotSource {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SnapshotSource : {};
}

function scalarText(value: unknown): string {
  if (typeof value === 'string') return trimString(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
}

function numberValue(value: unknown): number {
  const raw = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

function payloadString(payload: SnapshotSource, ...keys: readonly string[]): string {
  for (const key of keys) {
    const value = scalarText(payload[key]);
    if (value) return value;
  }
  return '';
}

function normalizeStatus(value: unknown, itemStatus: FlowerActivityItem['status']): FlowerSubagentPanelStatus {
  const raw = trimString(scalarText(value)).toLowerCase();
  switch (raw) {
    case 'queued':
    case 'running':
    case 'waiting_input':
    case 'completed':
    case 'failed':
    case 'canceled':
    case 'timed_out':
      return raw;
    case 'waiting':
    case 'interrupted':
      return 'waiting_input';
    case 'cancelled':
    case 'closed':
      return 'canceled';
    case '':
      break;
    default:
      return 'unknown';
  }
  switch (itemStatus) {
    case 'running':
      return 'running';
    case 'waiting':
    case 'pending':
      return 'queued';
    case 'success':
      return 'completed';
    case 'error':
      return 'failed';
    case 'canceled':
      return 'canceled';
  }
}

function isTerminalStatus(status: FlowerSubagentPanelStatus): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'canceled'
    || status === 'timed_out';
}

function statusRank(status: FlowerSubagentPanelStatus): number {
  switch (status) {
    case 'failed':
    case 'timed_out':
      return 7;
    case 'completed':
    case 'canceled':
      return 6;
    case 'waiting_input':
      return 3;
    case 'running':
      return 2;
    case 'queued':
      return 1;
    default:
      return 0;
  }
}

function isSubagentsActivityItem(item: FlowerActivityItem): boolean {
  if (trimString(item.tool_name) === 'subagents') return true;
  const payload = item.payload ?? {};
  const operation = payloadString(payload, 'operation');
  if (operation === 'subagents') return true;
  if (payloadString(payload, 'delegation_runtime') === 'floret') return true;
  return payloadString(payload, 'subagent_id') !== '' && payloadString(payload, 'thread_id') !== '';
}

function nestedSnapshots(payload: SnapshotSource): readonly SnapshotSource[] {
  const out: SnapshotSource[] = [];
  const pushRecord = (value: unknown) => {
    const record = asRecord(value);
    if (Object.keys(record).length > 0) out.push(record);
  };
  for (const key of ['snapshot', 'subagent', 'item']) {
    pushRecord(payload[key]);
  }
  for (const key of ['items', 'subagents']) {
    const list = Array.isArray(payload[key]) ? payload[key] as readonly unknown[] : [];
    list.forEach(pushRecord);
  }
  for (const key of ['snapshots', 'snapshots_by_id']) {
    const record = asRecord(payload[key]);
    Object.values(record).forEach(pushRecord);
  }
  return out;
}

function itemFromSnapshot(
  source: SnapshotSource,
  activityItem: FlowerActivityItem,
  activityPayload: SnapshotSource,
  fallbackUpdatedAtMs: number,
  ownerThreadID: string,
): FlowerSubagentPanelItem | null {
  const threadID = payloadString(source, 'thread_id', 'subagent_id');
  const subagentID = payloadString(source, 'subagent_id', 'thread_id');
  if (!threadID && !subagentID) return null;
  if (threadID && threadID === ownerThreadID) return null;
  const action = payloadString(activityPayload, 'action') || payloadString(source, 'action');
  const taskName = payloadString(source, 'task_name', 'title', 'path');
  const title = payloadString(source, 'title', 'task_name', 'path') || payloadString(activityPayload, 'task_name', 'title') || 'Subagent';
  const updatedAtMs = numberValue(source.updated_at_ms ?? source.updatedAtMs)
    || numberValue(source.ended_at_ms)
    || numberValue(source.created_at_ms ?? source.started_at_ms)
    || fallbackUpdatedAtMs;
  const status = normalizeStatus(source.status ?? source.subagent_status, activityItem.status);
  return {
    key: threadID || subagentID,
    threadID,
    subagentID: subagentID || threadID,
    taskName,
    title,
    agentType: payloadString(source, 'agent_type') || payloadString(activityPayload, 'agent_type'),
    status,
    lastMessage: payloadString(source, 'last_message', 'result', 'objective', 'waiting_prompt'),
    action,
    canOpen: Boolean(threadID),
    updatedAtMs,
    itemStatus: activityItem.status,
  };
}

function directItemFromActivity(item: FlowerActivityItem, fallbackUpdatedAtMs: number, ownerThreadID: string): FlowerSubagentPanelItem | null {
  const payload = item.payload ?? {};
  const nested = nestedSnapshots(payload);
  if (nested.length > 0) {
    return null;
  }
  return itemFromSnapshot(payload, item, payload, fallbackUpdatedAtMs, ownerThreadID);
}

function mergeItem(current: FlowerSubagentPanelItem | undefined, incoming: FlowerSubagentPanelItem): FlowerSubagentPanelItem {
  if (!current) return incoming;
  const incomingWins = incoming.updatedAtMs > current.updatedAtMs
    || (incoming.updatedAtMs === current.updatedAtMs && statusRank(incoming.status) >= statusRank(current.status));
  const base = incomingWins ? incoming : current;
  const patch = incomingWins ? current : incoming;
  return {
    ...base,
    threadID: base.threadID || patch.threadID,
    subagentID: base.subagentID || patch.subagentID,
    taskName: base.taskName || patch.taskName,
    title: base.title || patch.title,
    agentType: base.agentType || patch.agentType,
    lastMessage: base.lastMessage || patch.lastMessage,
    action: base.action || patch.action,
    canOpen: base.canOpen || patch.canOpen,
  };
}

export function buildFlowerSubagentPanelItems(thread: FlowerThreadSnapshot | null | undefined): readonly FlowerSubagentPanelItem[] {
  if (!thread) return [];
  const ownerThreadID = trimString(thread.thread_id);
  const byKey = new Map<string, FlowerSubagentPanelItem>();
  for (const message of thread.messages) {
    for (const block of message.blocks ?? []) {
      if (block.type !== 'activity-timeline') continue;
      collectSubagentItemsFromTimeline(block, message.created_at_ms, ownerThreadID).forEach((item) => {
        byKey.set(item.key, mergeItem(byKey.get(item.key), item));
      });
    }
  }
  return Array.from(byKey.values()).sort((left, right) => {
    const activeDelta = Number(!isTerminalStatus(left.status)) - Number(!isTerminalStatus(right.status));
    if (activeDelta !== 0) return -activeDelta;
    if (right.updatedAtMs !== left.updatedAtMs) return right.updatedAtMs - left.updatedAtMs;
    return left.title.localeCompare(right.title);
  });
}

function collectSubagentItemsFromTimeline(timeline: FlowerActivityTimelineBlock, messageCreatedAtMs: number, ownerThreadID: string): readonly FlowerSubagentPanelItem[] {
  const out: FlowerSubagentPanelItem[] = [];
  for (const item of timeline.items) {
    if (!isSubagentsActivityItem(item)) continue;
    const payload = item.payload ?? {};
    const fallbackUpdatedAtMs = numberValue(item.ended_at_unix_ms)
      || numberValue(item.started_at_unix_ms)
      || numberValue(timeline.summary.duration_ms ? messageCreatedAtMs + timeline.summary.duration_ms : 0)
      || messageCreatedAtMs;
    const nested = nestedSnapshots(payload);
    if (nested.length > 0) {
      nested.forEach((snapshot) => {
        const panelItem = itemFromSnapshot(snapshot, item, payload, fallbackUpdatedAtMs, ownerThreadID);
        if (panelItem) out.push(panelItem);
      });
      continue;
    }
    const panelItem = directItemFromActivity(item, fallbackUpdatedAtMs, ownerThreadID);
    if (panelItem) out.push(panelItem);
  }
  return out;
}
