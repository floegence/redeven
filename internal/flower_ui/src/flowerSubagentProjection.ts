import type {
  FlowerActivityItem,
  FlowerActivitySubagentAction,
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
  taskDescription: string;
  title: string;
  agentType: string;
  status: FlowerSubagentPanelStatus;
  action: string;
  canOpen: boolean;
  parentThreadID: string;
  startedAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
  itemStatus: FlowerActivityItem['status'];
}>;

type SnapshotSource = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): SnapshotSource {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as SnapshotSource : {};
}

function activitySubagentAction(timeline: FlowerActivityTimelineBlock, item: FlowerActivityItem): FlowerActivitySubagentAction | undefined {
  return timeline.subagent_actions?.[trimString(item.item_id)];
}

function subagentPayloadForItem(item: FlowerActivityItem, sidecar: FlowerActivitySubagentAction | undefined): SnapshotSource {
  const payload = item.payload ?? {};
  if (!sidecar) return payload;
  return {
    ...payload,
    ...asRecord(sidecar),
    operation: payloadString(payload, 'operation') || payloadString(asRecord(sidecar), 'operation') || 'subagents',
    action: payloadString(payload, 'action') || payloadString(asRecord(sidecar), 'action'),
    delegation_runtime: payloadString(payload, 'delegation_runtime') || payloadString(asRecord(sidecar), 'delegation_runtime') || 'floret',
  };
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

function isSubagentsActivityItem(item: FlowerActivityItem, sidecar: FlowerActivitySubagentAction | undefined): boolean {
  if (sidecar) return true;
  if (trimString(item.tool_name) === 'subagents') return true;
  const payload = item.payload ?? {};
  const operation = payloadString(payload, 'operation');
  if (operation === 'subagents') return true;
  if (payloadString(payload, 'delegation_runtime') === 'floret') return true;
  return false;
}

function nestedSnapshots(payload: SnapshotSource): readonly SnapshotSource[] {
  const out: SnapshotSource[] = [];
  const pushRecord = (value: unknown) => {
    const record = asRecord(value);
    if (Object.keys(record).length > 0) out.push(record);
  };
  for (const key of ['items']) {
    const list = Array.isArray(payload[key]) ? payload[key] as readonly unknown[] : [];
    list.forEach(pushRecord);
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
  const threadID = payloadString(source, 'thread_id', 'subagent_id') || payloadString(activityPayload, 'thread_id', 'subagent_id');
  const subagentID = payloadString(source, 'subagent_id', 'thread_id') || payloadString(activityPayload, 'subagent_id', 'thread_id');
  if (!threadID && !subagentID) return null;
  if (threadID && threadID === ownerThreadID) return null;
  const action = payloadString(activityPayload, 'action') || payloadString(source, 'action');
  const taskName = payloadString(source, 'task_name', 'title');
  const taskDescription = payloadString(source, 'task_description') || payloadString(activityPayload, 'task_description');
  const title = payloadString(source, 'title', 'task_name') || payloadString(activityPayload, 'task_name', 'title') || 'Subagent';
  const startedAtMs = numberValue(source.started_at_ms ?? source.created_at_ms);
  const createdAtMs = numberValue(source.created_at_ms ?? source.started_at_ms);
  const updatedAtMs = numberValue(source.updated_at_ms ?? source.updatedAtMs)
    || numberValue(source.ended_at_ms)
    || startedAtMs
    || fallbackUpdatedAtMs;
  const status = normalizeStatus(source.status, activityItem.status);
  return {
    key: threadID || subagentID,
    threadID,
    subagentID: subagentID || threadID,
    taskName,
    taskDescription,
    title,
    agentType: payloadString(source, 'agent_type') || payloadString(activityPayload, 'agent_type'),
    status,
    action,
    canOpen: Boolean(threadID),
    parentThreadID: payloadString(source, 'parent_thread_id', 'parentThreadID'),
    startedAtMs,
    createdAtMs,
    updatedAtMs,
    itemStatus: activityItem.status,
  };
}

function directItemFromActivity(item: FlowerActivityItem, payload: SnapshotSource, fallbackUpdatedAtMs: number, ownerThreadID: string): FlowerSubagentPanelItem | null {
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
    taskDescription: base.taskDescription || patch.taskDescription,
    title: base.title || patch.title,
    agentType: base.agentType || patch.agentType,
    action: base.action || patch.action,
    canOpen: base.canOpen || patch.canOpen,
    parentThreadID: base.parentThreadID || patch.parentThreadID,
    startedAtMs: base.startedAtMs || patch.startedAtMs,
    createdAtMs: base.createdAtMs || patch.createdAtMs,
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
    const sidecar = activitySubagentAction(timeline, item);
    if (!isSubagentsActivityItem(item, sidecar)) continue;
    const payload = subagentPayloadForItem(item, sidecar);
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
    const panelItem = directItemFromActivity(item, payload, fallbackUpdatedAtMs, ownerThreadID);
    if (panelItem) out.push(panelItem);
  }
  return out;
}
