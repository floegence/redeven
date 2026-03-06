export type FollowupLane = 'queued' | 'draft';

export type FollowupAttachmentItem = {
  name: string;
  mime_type?: string;
  url?: string;
};

export type FollowupItem = {
  followup_id: string;
  lane: FollowupLane;
  message_id: string;
  text: string;
  model_id?: string;
  execution_mode?: 'act' | 'plan';
  position: number;
  created_at_unix_ms: number;
  attachments?: FollowupAttachmentItem[];
};

export type ListFollowupsResponse = {
  revision?: number;
  paused_reason?: string;
  queued?: FollowupItem[];
  drafts?: FollowupItem[];
};

export type ComposerDraftSnapshot<TAttachment = unknown> = {
  text: string;
  attachments: TAttachment[];
};

export function reindexFollowups<T extends { position: number }>(items: T[]): T[] {
  return items.map((item, index) => ({ ...item, position: index + 1 }));
}

export function moveFollowupByDelta<T extends { position: number }>(items: T[], index: number, delta: number): T[] {
  const fromIndex = Math.max(0, Math.min(items.length - 1, index));
  const toIndex = Math.max(0, Math.min(items.length - 1, fromIndex + delta));
  if (fromIndex === toIndex) return reindexFollowups(items);
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return reindexFollowups(next);
}

export function reorderFollowupsByIDs<T extends { followup_id: string; position: number }>(items: T[], orderedIDs: string[]): T[] {
  if (items.length !== orderedIDs.length) {
    return reindexFollowups(items);
  }
  const byID = new Map(items.map((item) => [item.followup_id, item] as const));
  const reordered = orderedIDs
    .map((followupID) => byID.get(followupID))
    .filter((item): item is T => !!item);
  if (reordered.length !== items.length) {
    return reindexFollowups(items);
  }
  return reindexFollowups(reordered);
}

export function composeFollowupOrder(items: Array<{ followup_id: string }>): string[] {
  return items.map((item) => String(item.followup_id ?? '').trim()).filter(Boolean);
}

export function composerSnapshotHasContent<TAttachment>(snapshot: ComposerDraftSnapshot<TAttachment> | null | undefined): boolean {
  if (!snapshot) return false;
  if (String(snapshot.text ?? '').trim()) return true;
  return Array.isArray(snapshot.attachments) && snapshot.attachments.length > 0;
}

export function shouldAutoloadRecoveredFollowup<TAttachment>(
  recovered: Array<unknown>,
  snapshot: ComposerDraftSnapshot<TAttachment> | null | undefined,
): boolean {
  return Array.isArray(recovered) && recovered.length > 0 && !composerSnapshotHasContent(snapshot);
}
