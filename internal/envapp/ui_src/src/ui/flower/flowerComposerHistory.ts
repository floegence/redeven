import { readUIStorageJSON, writeUIStorageJSON } from '../services/uiStorage';

export type FlowerComposerHistoryEntry = Readonly<{
  text: string;
  createdAtUnixMs: number;
}>;

export type FlowerComposerHistoryState = Readonly<{
  version: 1;
  entries: readonly FlowerComposerHistoryEntry[];
}>;

export type FlowerComposerDraftSnapshot<TAttachment> = Readonly<{
  text: string;
  attachments: readonly TAttachment[];
}>;

export type FlowerComposerHistorySession<TAttachment> = Readonly<{
  index: number;
  savedDraft: FlowerComposerDraftSnapshot<TAttachment>;
}>;

const FLOWER_COMPOSER_HISTORY_STORAGE_KEY_PREFIX = 'redeven_ai_flower_composer_history:';
const FLOWER_COMPOSER_HISTORY_VERSION = 1 as const;
export const FLOWER_COMPOSER_HISTORY_LIMIT = 40;

function compactText(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeHistoryScopeKey(value: unknown): string {
  const normalized = compactText(value).replace(/\s+/g, ' ');
  return normalized || 'global';
}

function historyStorageKey(scopeKey: string): string {
  return `${FLOWER_COMPOSER_HISTORY_STORAGE_KEY_PREFIX}${normalizeHistoryScopeKey(scopeKey)}`;
}

function normalizeHistoryEntry(value: unknown): FlowerComposerHistoryEntry | null {
  const text = compactText((value as { text?: unknown } | null)?.text);
  if (!text) return null;
  const createdAtUnixMsRaw = Number((value as { createdAtUnixMs?: unknown } | null)?.createdAtUnixMs);
  return {
    text,
    createdAtUnixMs: Number.isFinite(createdAtUnixMsRaw) && createdAtUnixMsRaw > 0 ? Math.round(createdAtUnixMsRaw) : Date.now(),
  };
}

function normalizeHistoryState(value: unknown): FlowerComposerHistoryState {
  const rawEntries = Array.isArray((value as { entries?: unknown[] } | null)?.entries)
    ? (value as { entries: unknown[] }).entries
    : [];
  const entries = rawEntries
    .map(normalizeHistoryEntry)
    .filter((entry): entry is FlowerComposerHistoryEntry => !!entry)
    .slice(0, FLOWER_COMPOSER_HISTORY_LIMIT);
  return {
    version: FLOWER_COMPOSER_HISTORY_VERSION,
    entries,
  };
}

export function readFlowerComposerHistory(scopeKey: string): FlowerComposerHistoryEntry[] {
  const storageKey = historyStorageKey(scopeKey);
  return [...normalizeHistoryState(readUIStorageJSON(storageKey, null)).entries];
}

export function writeFlowerComposerHistory(scopeKey: string, entries: readonly FlowerComposerHistoryEntry[]): void {
  const storageKey = historyStorageKey(scopeKey);
  writeUIStorageJSON(storageKey, normalizeHistoryState({
    version: FLOWER_COMPOSER_HISTORY_VERSION,
    entries: [...entries],
  }));
}

export function pushFlowerComposerHistoryEntry(args: {
  scopeKey: string;
  text: string;
  createdAtUnixMs?: number;
}): FlowerComposerHistoryEntry[] {
  const text = compactText(args.text);
  if (!text) {
    return readFlowerComposerHistory(args.scopeKey);
  }

  const createdAtUnixMsRaw = Number(args.createdAtUnixMs);
  const nextEntry: FlowerComposerHistoryEntry = {
    text,
    createdAtUnixMs: Number.isFinite(createdAtUnixMsRaw) && createdAtUnixMsRaw > 0 ? Math.round(createdAtUnixMsRaw) : Date.now(),
  };
  const nextEntries = [
    nextEntry,
    ...readFlowerComposerHistory(args.scopeKey).filter((entry) => entry.text !== text),
  ].slice(0, FLOWER_COMPOSER_HISTORY_LIMIT);
  writeFlowerComposerHistory(args.scopeKey, nextEntries);
  return nextEntries;
}

export function navigateFlowerComposerHistoryUp<TAttachment>(args: {
  entries: readonly FlowerComposerHistoryEntry[];
  session: FlowerComposerHistorySession<TAttachment> | null;
  currentDraft: FlowerComposerDraftSnapshot<TAttachment>;
}): Readonly<{
  session: FlowerComposerHistorySession<TAttachment>;
  draft: FlowerComposerDraftSnapshot<TAttachment>;
}> | null {
  if (args.entries.length <= 0) return null;
  const nextIndex = Math.min(args.entries.length, (args.session?.index ?? 0) + 1);
  if (args.session && nextIndex === args.session.index) {
    return null;
  }

  const historyEntry = args.entries[nextIndex - 1];
  if (!historyEntry) return null;

  return {
    session: {
      index: nextIndex,
      savedDraft: args.session?.savedDraft ?? args.currentDraft,
    },
    draft: {
      text: historyEntry.text,
      attachments: [],
    },
  };
}

export function navigateFlowerComposerHistoryDown<TAttachment>(args: {
  entries: readonly FlowerComposerHistoryEntry[];
  session: FlowerComposerHistorySession<TAttachment> | null;
}): Readonly<{
  session: FlowerComposerHistorySession<TAttachment> | null;
  draft: FlowerComposerDraftSnapshot<TAttachment>;
}> | null {
  const session = args.session;
  if (!session) return null;

  const nextIndex = session.index - 1;
  if (nextIndex <= 0) {
    return {
      session: null,
      draft: session.savedDraft,
    };
  }

  const historyEntry = args.entries[nextIndex - 1];
  if (!historyEntry) {
    return {
      session: null,
      draft: session.savedDraft,
    };
  }

  return {
    session: {
      ...session,
      index: nextIndex,
    },
    draft: {
      text: historyEntry.text,
      attachments: [],
    },
  };
}
