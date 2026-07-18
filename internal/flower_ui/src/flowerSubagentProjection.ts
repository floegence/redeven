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
  taskName: string;
  taskDescription: string;
  title: string;
  displayName: string;
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

const SUBAGENT_NAME_MAX_WORDS = 5;
const SUBAGENT_NAME_MAX_LENGTH = 48;
const SUBAGENT_NAME_INITIALISMS = new Map([
  'ai', 'api', 'cli', 'cpu', 'css', 'gpu', 'html', 'http', 'https', 'id', 'json',
  'llm', 'mcp', 'okf', 'oss', 'rpc', 'sdk', 'sql', 'ssh', 'ui', 'url', 'ux', 'wasm',
].map((value) => [value, value.toUpperCase()]));

function taskNameTokens(value: string): readonly string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .match(/[A-Za-z0-9]+/gu) ?? [];
}

function formatTaskNameToken(value: string): string {
  const initialism = SUBAGENT_NAME_INITIALISMS.get(value.toLowerCase());
  if (initialism) return initialism;
  if (/^[A-Z0-9]+$/u.test(value) && /[A-Z]/u.test(value)) return value;
  const lower = value.toLowerCase();
  return `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
}

export function presentSubagentTaskName(value: string): string {
  const raw = trimString(value);
  const tokens = taskNameTokens(raw);
  if (tokens.length === 0) return raw;

  const words: string[] = [];
  for (const token of tokens) {
    if (words.length >= SUBAGENT_NAME_MAX_WORDS) break;
    const word = formatTaskNameToken(token);
    const candidate = [...words, word].join(' ');
    if (candidate.length > SUBAGENT_NAME_MAX_LENGTH) {
      if (words.length === 0) words.push(word.slice(0, SUBAGENT_NAME_MAX_LENGTH));
      break;
    }
    words.push(word);
  }
  return words.join(' ') || raw;
}

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

function statusPriority(status: FlowerSubagentPanelStatus): number {
  switch (status) {
    case 'waiting_input': return 0;
    case 'running': return 1;
    case 'queued': return 2;
    case 'unknown': return 3;
    case 'failed': return 4;
    case 'timed_out': return 5;
    case 'completed': return 6;
    case 'canceled': return 7;
  }
}

function subagentUpdatedAtMs(summary: FlowerSubagentSummary): number {
  return numberValue(summary.updated_at_ms) || numberValue(summary.created_at_ms);
}

function itemFromSummary(summary: FlowerSubagentSummary, ownerThreadID: string): FlowerSubagentPanelItem | null {
  const threadID = trimString(summary.thread_id);
  if (!threadID || threadID === ownerThreadID) return null;
  const taskName = trimString(summary.task_name);
  if (!taskName) return null;
  const taskDescription = trimString(summary.task_description);
  const agentType = trimString(summary.agent_type);
  const displayName = presentSubagentTaskName(taskName);
  const createdAtMs = numberValue(summary.created_at_ms);
  const updatedAtMs = subagentUpdatedAtMs(summary);
  return {
    key: threadID,
    threadID,
    taskName,
    taskDescription,
    title: taskName,
    displayName,
    agentType,
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
      const statusDelta = statusPriority(left.status) - statusPriority(right.status);
      if (statusDelta !== 0) return statusDelta;
      if (right.updatedAtMs !== left.updatedAtMs) return right.updatedAtMs - left.updatedAtMs;
      return left.displayName.localeCompare(right.displayName);
    });
}
