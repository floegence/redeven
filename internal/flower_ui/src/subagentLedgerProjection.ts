import type { FlowerActivityStatus } from './contracts/flowerSurfaceContracts';
import type { FlowerTimelineEntry } from './flowerTimelineProjection';

export type SubagentLedgerEntryItem = Readonly<{
  type: 'entry';
  key: string;
  entry: FlowerTimelineEntry;
}>;

export type SubagentLedgerActivityBatch = Readonly<{
  type: 'activity_batch';
  key: string;
  entries: readonly Extract<FlowerTimelineEntry, { type: 'message' }>[];
  itemCount: number;
  status: FlowerActivityStatus;
  allSucceeded: boolean;
  firstTimestamp: number;
  lastTimestamp: number;
}>;

export type SubagentLedgerItem = SubagentLedgerEntryItem | SubagentLedgerActivityBatch;

type ActivityMessageEntry = Extract<FlowerTimelineEntry, { type: 'message' }>;

function pureActivityEntry(entry: FlowerTimelineEntry): entry is ActivityMessageEntry {
  return entry.type === 'message'
    && entry.blocks.length > 0
    && entry.blocks.every((block) => block.type === 'activity')
    && entry.blocks.some((block) => block.type === 'activity' && block.block.items.length > 0);
}

function activityItems(entry: ActivityMessageEntry) {
  return entry.blocks.flatMap((block) => block.type === 'activity' ? block.block.items : []);
}

function batchStatus(entries: readonly ActivityMessageEntry[]): FlowerActivityStatus {
  const statuses = new Set(entries.flatMap((entry) => activityItems(entry).map((item) => item.status)));
  if (statuses.has('error')) return 'error';
  if (statuses.has('waiting')) return 'waiting';
  if (statuses.has('running')) return 'running';
  if (statuses.has('pending')) return 'pending';
  if (statuses.has('canceled')) return 'canceled';
  return 'success';
}

function entryTimestamp(entry: ActivityMessageEntry): number {
  return Math.max(0, Number(entry.message.created_at_ms || 0));
}

function activityBatch(entries: readonly ActivityMessageEntry[]): SubagentLedgerActivityBatch {
  const items = entries.flatMap(activityItems);
  const timestamps = entries.map(entryTimestamp).filter((timestamp) => timestamp > 0);
  return {
    type: 'activity_batch',
    key: `activity-batch:${entries[0]?.key ?? 'empty'}`,
    entries,
    itemCount: items.length,
    status: batchStatus(entries),
    allSucceeded: items.length > 0 && items.every((item) => item.status === 'success'),
    firstTimestamp: timestamps[0] ?? 0,
    lastTimestamp: timestamps[timestamps.length - 1] ?? 0,
  };
}

export function projectSubagentLedgerItems(entries: readonly FlowerTimelineEntry[]): readonly SubagentLedgerItem[] {
  const items: SubagentLedgerItem[] = [];
  let pendingActivityEntries: ActivityMessageEntry[] = [];

  const flushActivityBatch = () => {
    if (pendingActivityEntries.length === 0) return;
    items.push(activityBatch(pendingActivityEntries));
    pendingActivityEntries = [];
  };

  for (const entry of entries) {
    if (pureActivityEntry(entry)) {
      pendingActivityEntries.push(entry);
      continue;
    }
    flushActivityBatch();
    items.push({ type: 'entry', key: entry.key, entry });
  }
  flushActivityBatch();
  return items;
}
