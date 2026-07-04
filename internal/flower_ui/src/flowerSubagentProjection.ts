import type {
  FlowerActivityItem,
  FlowerSubagentSummary,
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

function numberValue(value: unknown): number {
  const raw = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
}

function normalizeStatus(value: unknown): FlowerSubagentPanelStatus {
  const raw = trimString(String(value ?? '')).toLowerCase();
  switch (raw) {
    case 'queued':
    case 'running':
    case 'waiting_input':
    case 'completed':
    case 'failed':
    case 'canceled':
    case 'timed_out':
      return raw;
    case 'idle':
    case 'pending':
      return 'queued';
    case 'waiting':
    case 'interrupted':
      return 'waiting_input';
    case 'cancelled':
    case 'closed':
      return 'canceled';
    default:
      return 'unknown';
  }
}

function isTerminalStatus(status: FlowerSubagentPanelStatus): boolean {
  return status === 'completed'
    || status === 'failed'
    || status === 'canceled'
    || status === 'timed_out';
}

function subagentUpdatedAtMs(summary: FlowerSubagentSummary): number {
  return numberValue(summary.updated_at_ms) || numberValue(summary.created_at_ms);
}

function itemFromSummary(summary: FlowerSubagentSummary, ownerThreadID: string): FlowerSubagentPanelItem | null {
  const threadID = trimString(summary.thread_id) || trimString(summary.subagent_id);
  const subagentID = trimString(summary.subagent_id) || threadID;
  if (!threadID || threadID === ownerThreadID) return null;
  const taskName = trimString(summary.task_name);
  const taskDescription = trimString(summary.task_description);
  const rawTitle = trimString(summary.title);
  const title = rawTitle && rawTitle !== threadID && rawTitle !== subagentID ? rawTitle : taskName;
  const createdAtMs = numberValue(summary.created_at_ms);
  const updatedAtMs = subagentUpdatedAtMs(summary);
  return {
    key: threadID,
    threadID,
    subagentID,
    taskName,
    taskDescription,
    title: title || threadID,
    agentType: trimString(summary.agent_type),
    status: normalizeStatus(summary.status),
    action: 'inspect',
    canOpen: true,
    parentThreadID: trimString(summary.parent_thread_id),
    startedAtMs: createdAtMs,
    createdAtMs,
    updatedAtMs,
    itemStatus: 'success',
  };
}

export function buildFlowerSubagentPanelItems(thread: FlowerThreadSnapshot | null | undefined): readonly FlowerSubagentPanelItem[] {
  if (!thread) return [];
  const ownerThreadID = trimString(thread.thread_id);
  return (thread.subagents ?? [])
    .map((summary) => itemFromSummary(summary, ownerThreadID))
    .filter((item): item is FlowerSubagentPanelItem => item !== null)
    .sort((left, right) => {
      const activeDelta = Number(!isTerminalStatus(left.status)) - Number(!isTerminalStatus(right.status));
      if (activeDelta !== 0) return -activeDelta;
      if (right.updatedAtMs !== left.updatedAtMs) return right.updatedAtMs - left.updatedAtMs;
      return left.title.localeCompare(right.title);
    });
}
