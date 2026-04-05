export type NoteColorToken = 'graphite' | 'sage' | 'amber' | 'azure' | 'coral' | 'rose';
export type TopicIconKey = 'fox' | 'crane' | 'otter' | 'lynx' | 'whale' | 'hare';
export type TopicAccentToken = 'ember' | 'sea' | 'moss' | 'ink' | 'gold' | 'berry';

export type NotesTopic = Readonly<{
  topic_id: string;
  name: string;
  icon_key: TopicIconKey;
  icon_accent: TopicAccentToken;
  sort_order: number;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
  deleted_at_unix_ms: number;
}>;

export type NotesItem = Readonly<{
  note_id: string;
  topic_id: string;
  body: string;
  preview_text: string;
  character_count: number;
  size_bucket: number;
  style_version: string;
  color_token: NoteColorToken;
  x: number;
  y: number;
  z_index: number;
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
}>;

export type NotesTrashItem = Readonly<NotesItem & {
  topic_name: string;
  topic_icon_key: TopicIconKey;
  topic_icon_accent: TopicAccentToken;
  topic_sort_order: number;
  deleted_at_unix_ms: number;
}>;

export type NotesSnapshot = Readonly<{
  seq: number;
  retention_hours: number;
  topics: NotesTopic[];
  items: NotesItem[];
  trash_items: NotesTrashItem[];
}>;

export type NotesEvent = Readonly<{
  seq: number;
  type: string;
  entity_kind: string;
  entity_id: string;
  topic_id?: string;
  created_at_unix_ms: number;
  payload?: Record<string, unknown> | null;
}>;

export type NotesViewport = Readonly<{
  x: number;
  y: number;
  scale: number;
}>;

export type NotesPoint = Readonly<{
  x: number;
  y: number;
}>;

export type NotesRect = Readonly<{
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}>;

export type NotesTrashGroup = Readonly<{
  topic_id: string;
  topic_name: string;
  topic_icon_key: TopicIconKey;
  topic_icon_accent: TopicAccentToken;
  topic_sort_order: number;
  latest_deleted_at_unix_ms: number;
  items: NotesTrashItem[];
}>;

export type NotesItemMetrics = Readonly<{
  width: number;
  height: number;
  preview_lines: number;
}>;

export const NOTES_SCALE_MIN = 0.42;
export const NOTES_SCALE_MAX = 2.1;

export const NOTE_COLOR_TOKENS = ['graphite', 'sage', 'amber', 'azure', 'coral', 'rose'] as const;
export const TOPIC_ICON_KEYS = ['fox', 'crane', 'otter', 'lynx', 'whale', 'hare'] as const;
export const TOPIC_ACCENT_TOKENS = ['ember', 'sea', 'moss', 'ink', 'gold', 'berry'] as const;

export const NOTE_BUCKET_METRICS: Readonly<Record<1 | 2 | 3 | 4 | 5, NotesItemMetrics>> = Object.freeze({
  1: { width: 184, height: 126, preview_lines: 4 },
  2: { width: 202, height: 142, preview_lines: 5 },
  3: { width: 220, height: 160, preview_lines: 6 },
  4: { width: 238, height: 180, preview_lines: 7 },
  5: { width: 256, height: 198, preview_lines: 8 },
});

const DEFAULT_BOARD_BOUNDS: NotesRect = Object.freeze({
  minX: -320,
  minY: -220,
  maxX: 360,
  maxY: 260,
});

function normalizeBucket(bucket: number): 1 | 2 | 3 | 4 | 5 {
  const rounded = Math.round(Number(bucket) || 1);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as 1 | 2 | 3 | 4 | 5;
}

function sortTopics(topics: readonly NotesTopic[]): NotesTopic[] {
  return [...topics].sort((left, right) => {
    if (left.sort_order !== right.sort_order) return left.sort_order - right.sort_order;
    return left.name.localeCompare(right.name);
  });
}

function sortItems(items: readonly NotesItem[]): NotesItem[] {
  return [...items].sort((left, right) => {
    if (left.z_index !== right.z_index) return left.z_index - right.z_index;
    if (left.updated_at_unix_ms !== right.updated_at_unix_ms) return left.updated_at_unix_ms - right.updated_at_unix_ms;
    return left.note_id.localeCompare(right.note_id);
  });
}

function sortTrashItems(items: readonly NotesTrashItem[]): NotesTrashItem[] {
  return [...items].sort((left, right) => {
    if (left.deleted_at_unix_ms !== right.deleted_at_unix_ms) return right.deleted_at_unix_ms - left.deleted_at_unix_ms;
    if (left.topic_sort_order !== right.topic_sort_order) return left.topic_sort_order - right.topic_sort_order;
    return right.updated_at_unix_ms - left.updated_at_unix_ms;
  });
}

function upsertByID<T extends { [key in K]: string }, K extends keyof T>(
  entries: readonly T[],
  key: K,
  nextEntry: T,
): T[] {
  const next = [...entries];
  const index = next.findIndex((entry) => entry[key] === nextEntry[key]);
  if (index >= 0) {
    next[index] = nextEntry;
    return next;
  }
  next.push(nextEntry);
  return next;
}

export function noteBucketMetrics(bucket: number): NotesItemMetrics {
  return NOTE_BUCKET_METRICS[normalizeBucket(bucket)];
}

export function createDefaultNotesSnapshot(): NotesSnapshot {
  return {
    seq: 0,
    retention_hours: 72,
    topics: [],
    items: [],
    trash_items: [],
  };
}

export function normalizeNotesSnapshot(snapshot: NotesSnapshot): NotesSnapshot {
  return {
    seq: Number(snapshot.seq) || 0,
    retention_hours: Number(snapshot.retention_hours) || 72,
    topics: sortTopics(snapshot.topics ?? []),
    items: sortItems(snapshot.items ?? []),
    trash_items: sortTrashItems(snapshot.trash_items ?? []),
  };
}

export function clampScale(scale: number): number {
  const numeric = Number(scale);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(NOTES_SCALE_MIN, Math.min(NOTES_SCALE_MAX, numeric));
}

export function worldToScreen(viewport: NotesViewport, world: NotesPoint): NotesPoint {
  return {
    x: viewport.x + world.x * viewport.scale,
    y: viewport.y + world.y * viewport.scale,
  };
}

export function screenToWorld(viewport: NotesViewport, point: NotesPoint): NotesPoint {
  const scale = viewport.scale || 1;
  return {
    x: (point.x - viewport.x) / scale,
    y: (point.y - viewport.y) / scale,
  };
}

export function visibleWorldRect(viewport: NotesViewport, width: number, height: number): NotesRect {
  const topLeft = screenToWorld(viewport, { x: 0, y: 0 });
  const bottomRight = screenToWorld(viewport, { x: width, y: height });
  return {
    minX: Math.min(topLeft.x, bottomRight.x),
    minY: Math.min(topLeft.y, bottomRight.y),
    maxX: Math.max(topLeft.x, bottomRight.x),
    maxY: Math.max(topLeft.y, bottomRight.y),
  };
}

export function zoomViewportAtPoint(
  viewport: NotesViewport,
  requestedScale: number,
  anchorX: number,
  anchorY: number,
): NotesViewport {
  const nextScale = clampScale(requestedScale);
  const anchorWorld = screenToWorld(viewport, { x: anchorX, y: anchorY });
  return {
    x: anchorX - anchorWorld.x * nextScale,
    y: anchorY - anchorWorld.y * nextScale,
    scale: nextScale,
  };
}

export function centerViewportOnWorldPoint(
  viewport: NotesViewport,
  worldX: number,
  worldY: number,
  width: number,
  height: number,
): NotesViewport {
  return {
    x: width / 2 - worldX * viewport.scale,
    y: height / 2 - worldY * viewport.scale,
    scale: viewport.scale,
  };
}

export function computeBoardBounds(items: readonly NotesItem[]): NotesRect {
  if (items.length === 0) {
    return DEFAULT_BOARD_BOUNDS;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const metrics = noteBucketMetrics(item.size_bucket);
    minX = Math.min(minX, item.x);
    minY = Math.min(minY, item.y);
    maxX = Math.max(maxX, item.x + metrics.width);
    maxY = Math.max(maxY, item.y + metrics.height);
  }

  return {
    minX: minX - 120,
    minY: minY - 120,
    maxX: maxX + 120,
    maxY: maxY + 120,
  };
}

export function mergeBoardBounds(base: NotesRect, extra: NotesRect): NotesRect {
  return {
    minX: Math.min(base.minX, extra.minX),
    minY: Math.min(base.minY, extra.minY),
    maxX: Math.max(base.maxX, extra.maxX),
    maxY: Math.max(base.maxY, extra.maxY),
  };
}

export function groupTrashItems(items: readonly NotesTrashItem[]): NotesTrashGroup[] {
  const buckets = new Map<string, NotesTrashGroup>();
  for (const item of sortTrashItems(items)) {
    const current = buckets.get(item.topic_id);
    if (current) {
      current.items.push(item);
      continue;
    }
    buckets.set(item.topic_id, {
      topic_id: item.topic_id,
      topic_name: item.topic_name,
      topic_icon_key: item.topic_icon_key,
      topic_icon_accent: item.topic_icon_accent,
      topic_sort_order: item.topic_sort_order,
      latest_deleted_at_unix_ms: item.deleted_at_unix_ms,
      items: [item],
    });
  }

  return [...buckets.values()].sort((left, right) => {
    if (left.latest_deleted_at_unix_ms !== right.latest_deleted_at_unix_ms) {
      return right.latest_deleted_at_unix_ms - left.latest_deleted_at_unix_ms;
    }
    return left.topic_sort_order - right.topic_sort_order;
  });
}

export function nextLocalZIndex(snapshot: NotesSnapshot): number {
  return snapshot.items.reduce((highest, item) => Math.max(highest, item.z_index), 0) + 1;
}

export function promoteLocalItem(snapshot: NotesSnapshot, noteID: string): NotesSnapshot {
  const target = snapshot.items.find((item) => item.note_id === noteID);
  if (!target) return snapshot;
  return replaceSnapshotItem(snapshot, {
    ...target,
    z_index: nextLocalZIndex(snapshot),
    updated_at_unix_ms: Date.now(),
  });
}

export function replaceSnapshotTopic(snapshot: NotesSnapshot, topic: NotesTopic): NotesSnapshot {
  return {
    ...snapshot,
    topics: sortTopics(upsertByID(snapshot.topics, 'topic_id', topic)),
  };
}

export function replaceSnapshotItem(snapshot: NotesSnapshot, item: NotesItem): NotesSnapshot {
  return {
    ...snapshot,
    items: sortItems(upsertByID(snapshot.items, 'note_id', item)),
    trash_items: snapshot.trash_items.filter((candidate) => candidate.note_id !== item.note_id),
  };
}

export function removeSnapshotItem(snapshot: NotesSnapshot, noteID: string): NotesSnapshot {
  return {
    ...snapshot,
    items: snapshot.items.filter((item) => item.note_id !== noteID),
  };
}

export function replaceSnapshotTrashItem(snapshot: NotesSnapshot, trashItem: NotesTrashItem): NotesSnapshot {
  return {
    ...snapshot,
    items: snapshot.items.filter((candidate) => candidate.note_id !== trashItem.note_id),
    trash_items: sortTrashItems(upsertByID(snapshot.trash_items, 'note_id', trashItem)),
  };
}

export function removeSnapshotTopic(snapshot: NotesSnapshot, topicID: string): NotesSnapshot {
  return {
    ...snapshot,
    topics: snapshot.topics.filter((topic) => topic.topic_id !== topicID),
    items: snapshot.items.filter((item) => item.topic_id !== topicID),
  };
}

function asTopic(value: unknown): NotesTopic | null {
  if (!value || typeof value !== 'object') return null;
  return value as NotesTopic;
}

function asItem(value: unknown): NotesItem | null {
  if (!value || typeof value !== 'object') return null;
  return value as NotesItem;
}

function asTrashItem(value: unknown): NotesTrashItem | null {
  if (!value || typeof value !== 'object') return null;
  return value as NotesTrashItem;
}

function asTrashItems(value: unknown): NotesTrashItem[] {
  return Array.isArray(value) ? value.map(asTrashItem).filter(Boolean) as NotesTrashItem[] : [];
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    : [];
}

export function applyNotesEvent(snapshot: NotesSnapshot, event: NotesEvent): NotesSnapshot {
  const payload = event.payload ?? {};
  let next = snapshot;

  switch (event.type) {
    case 'topic.created':
    case 'topic.updated':
    case 'topic.restored': {
      const topic = asTopic(payload.topic);
      if (topic) next = replaceSnapshotTopic(next, topic);
      break;
    }
    case 'topic.deleted': {
      const topic = asTopic(payload.topic);
      const topicID = topic?.topic_id || String(event.topic_id ?? '').trim();
      if (topicID) {
        next = removeSnapshotTopic(next, topicID);
      }
      for (const trashItem of asTrashItems(payload.trash_items)) {
        next = replaceSnapshotTrashItem(next, trashItem);
      }
      break;
    }
    case 'topic.removed': {
      const topicID = String((payload as { topic_id?: unknown }).topic_id ?? event.topic_id ?? '').trim();
      if (topicID) {
        next = removeSnapshotTopic(next, topicID);
        next = {
          ...next,
          trash_items: next.trash_items.filter((item) => item.topic_id !== topicID),
        };
      }
      break;
    }
    case 'item.created':
    case 'item.updated':
    case 'item.fronted':
    case 'item.restored': {
      const item = asItem(payload.item);
      if (item) next = replaceSnapshotItem(next, item);
      break;
    }
    case 'item.deleted': {
      const trashItem = asTrashItem(payload.trash_item);
      if (trashItem) next = replaceSnapshotTrashItem(next, trashItem);
      break;
    }
    case 'trash.topic_cleared': {
      const topicID = String((payload as { topic_id?: unknown }).topic_id ?? event.topic_id ?? '').trim();
      const deletedIDs = asStringArray((payload as { deleted_ids?: unknown }).deleted_ids);
      const topicRemoved = Boolean((payload as { topic_removed?: unknown }).topic_removed);
      next = {
        ...next,
        trash_items: next.trash_items.filter((item) => {
          if (deletedIDs.includes(item.note_id)) return false;
          if (!deletedIDs.length && topicID && item.topic_id === topicID) return false;
          return true;
        }),
      };
      if (topicRemoved && topicID) {
        next = {
          ...next,
          topics: next.topics.filter((topic) => topic.topic_id !== topicID),
        };
      }
      break;
    }
    default:
      break;
  }

  return {
    ...next,
    seq: Math.max(Number(snapshot.seq) || 0, Number(event.seq) || 0),
  };
}
