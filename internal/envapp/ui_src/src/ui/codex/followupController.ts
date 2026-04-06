import { createEffect, createSignal, type Accessor } from 'solid-js';

import {
  readUIStorageJSON,
  removeUIStorageItem,
  writeUIStorageJSON,
} from '../services/uiStorage';
import type {
  CodexComposerAttachmentDraft,
  CodexComposerMentionDraft,
  CodexQueuedFollowup,
  CodexQueuedFollowupRuntimeConfig,
} from './types';

const CODEX_FOLLOWUP_STORAGE_KEY = 'redeven:codex:queued-followups:v1';

type CodexQueuedFollowupMap = Record<string, CodexQueuedFollowup[]>;

function cloneAttachmentDraft(attachment: CodexComposerAttachmentDraft): CodexComposerAttachmentDraft {
  return { ...attachment };
}

function cloneMentionDraft(mention: CodexComposerMentionDraft): CodexComposerMentionDraft {
  return { ...mention };
}

function cloneQueuedFollowupRuntimeConfig(config: CodexQueuedFollowupRuntimeConfig): CodexQueuedFollowupRuntimeConfig {
  return { ...config };
}

function cloneQueuedFollowup(followup: CodexQueuedFollowup): CodexQueuedFollowup {
  return {
    ...followup,
    attachments: followup.attachments.map(cloneAttachmentDraft),
    mentions: followup.mentions.map(cloneMentionDraft),
    runtime_config: cloneQueuedFollowupRuntimeConfig(followup.runtime_config),
  };
}

function normalizeAttachmentDraft(raw: unknown): CodexComposerAttachmentDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<CodexComposerAttachmentDraft>;
  const id = String(value.id ?? '').trim();
  const name = String(value.name ?? '').trim();
  const mimeType = String(value.mime_type ?? '').trim();
  const dataURL = String(value.data_url ?? '').trim();
  const previewURL = String(value.preview_url ?? '').trim() || dataURL;
  if (!id || !name || !mimeType || !dataURL || !previewURL) return null;
  return {
    id,
    name,
    mime_type: mimeType,
    size_bytes: Math.max(0, Number(value.size_bytes ?? 0) || 0),
    data_url: dataURL,
    preview_url: previewURL,
  };
}

function normalizeMentionDraft(raw: unknown): CodexComposerMentionDraft | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<CodexComposerMentionDraft>;
  const id = String(value.id ?? '').trim();
  const name = String(value.name ?? '').trim();
  const path = String(value.path ?? '').trim();
  if (!id || !name || !path) return null;
  return {
    id,
    name,
    path,
    kind: 'file',
    is_image: Boolean(value.is_image),
  };
}

function normalizeQueuedFollowupRuntimeConfig(raw: unknown): CodexQueuedFollowupRuntimeConfig {
  const value = raw && typeof raw === 'object'
    ? raw as Partial<CodexQueuedFollowupRuntimeConfig>
    : {};
  return {
    cwd: String(value.cwd ?? '').trim(),
    model: String(value.model ?? '').trim(),
    effort: String(value.effort ?? '').trim(),
    approval_policy: String(value.approval_policy ?? '').trim(),
    sandbox_mode: String(value.sandbox_mode ?? '').trim(),
    approvals_reviewer: String(value.approvals_reviewer ?? '').trim(),
  };
}

function normalizeQueuedFollowup(raw: unknown): CodexQueuedFollowup | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Partial<CodexQueuedFollowup>;
  const id = String(value.id ?? '').trim();
  const threadID = String(value.thread_id ?? '').trim();
  if (!id || !threadID) return null;
  const attachments = Array.isArray(value.attachments)
    ? value.attachments.map(normalizeAttachmentDraft).filter((entry): entry is CodexComposerAttachmentDraft => !!entry)
    : [];
  const mentions = Array.isArray(value.mentions)
    ? value.mentions.map(normalizeMentionDraft).filter((entry): entry is CodexComposerMentionDraft => !!entry)
    : [];
  return {
    id,
    thread_id: threadID,
    text: String(value.text ?? ''),
    attachments,
    mentions,
    runtime_config: normalizeQueuedFollowupRuntimeConfig(value.runtime_config),
    created_at_unix_ms: Math.max(0, Number(value.created_at_unix_ms ?? 0) || 0),
    source: (
      value.source === 'rejected_steer' ||
      value.source === 'auto_send'
    )
      ? value.source
      : 'queued',
  };
}

function normalizeQueuedFollowupMap(raw: unknown): CodexQueuedFollowupMap {
  if (!raw || typeof raw !== 'object') return {};
  const entries = Object.entries(raw as Record<string, unknown>);
  const next: CodexQueuedFollowupMap = {};
  for (const [threadID, value] of entries) {
    const normalizedThreadID = String(threadID ?? '').trim();
    if (!normalizedThreadID || !Array.isArray(value)) continue;
    const items = value
      .map(normalizeQueuedFollowup)
      .filter((item): item is CodexQueuedFollowup => !!item && item.thread_id === normalizedThreadID);
    if (items.length > 0) {
      next[normalizedThreadID] = items.map(cloneQueuedFollowup);
    }
  }
  return next;
}

function normalizeThreadID(threadID: string | null | undefined): string {
  return String(threadID ?? '').trim();
}

export function createCodexFollowupController(args?: {
  storageKey?: string;
}) {
  const storageKey = String(args?.storageKey ?? CODEX_FOLLOWUP_STORAGE_KEY).trim() || CODEX_FOLLOWUP_STORAGE_KEY;
  const [queuedByThread, setQueuedByThread] = createSignal<CodexQueuedFollowupMap>(
    normalizeQueuedFollowupMap(readUIStorageJSON(storageKey, {})),
  );

  createEffect(() => {
    const snapshot = queuedByThread();
    const hasQueued = Object.values(snapshot).some((items) => items.length > 0);
    if (!hasQueued) {
      removeUIStorageItem(storageKey);
      return;
    }
    writeUIStorageJSON(storageKey, snapshot);
  });

  const replaceThreadQueue = (threadID: string, nextItems: readonly CodexQueuedFollowup[]) => {
    const normalizedThreadID = normalizeThreadID(threadID);
    if (!normalizedThreadID) return;
    setQueuedByThread((current) => {
      const clonedItems = nextItems.map(cloneQueuedFollowup);
      if (clonedItems.length === 0) {
        if (!(normalizedThreadID in current)) return current;
        const next = { ...current };
        delete next[normalizedThreadID];
        return next;
      }
      return {
        ...current,
        [normalizedThreadID]: clonedItems,
      };
    });
  };

  const queuedForThread = (threadID: string | null | undefined): CodexQueuedFollowup[] => {
    const normalizedThreadID = normalizeThreadID(threadID);
    if (!normalizedThreadID) return [];
    return (queuedByThread()[normalizedThreadID] ?? []).map(cloneQueuedFollowup);
  };

  const queueFollowup = (followup: CodexQueuedFollowup): void => {
    const normalizedThreadID = normalizeThreadID(followup.thread_id);
    if (!normalizedThreadID) return;
    replaceThreadQueue(normalizedThreadID, [
      ...(queuedByThread()[normalizedThreadID] ?? []),
      cloneQueuedFollowup({
        ...followup,
        thread_id: normalizedThreadID,
      }),
    ]);
  };

  const prependFollowup = (followup: CodexQueuedFollowup): void => {
    const normalizedThreadID = normalizeThreadID(followup.thread_id);
    if (!normalizedThreadID) return;
    replaceThreadQueue(normalizedThreadID, [
      cloneQueuedFollowup({
        ...followup,
        thread_id: normalizedThreadID,
      }),
      ...(queuedByThread()[normalizedThreadID] ?? []),
    ]);
  };

  const removeFollowup = (threadID: string, followupID: string): void => {
    const normalizedThreadID = normalizeThreadID(threadID);
    const normalizedFollowupID = String(followupID ?? '').trim();
    if (!normalizedThreadID || !normalizedFollowupID) return;
    replaceThreadQueue(
      normalizedThreadID,
      (queuedByThread()[normalizedThreadID] ?? []).filter((item) => item.id !== normalizedFollowupID),
    );
  };

  const moveFollowup = (threadID: string, followupID: string, delta: number): void => {
    const normalizedThreadID = normalizeThreadID(threadID);
    const normalizedFollowupID = String(followupID ?? '').trim();
    if (!normalizedThreadID || !normalizedFollowupID || delta === 0) return;
    const items = [...(queuedByThread()[normalizedThreadID] ?? [])];
    const fromIndex = items.findIndex((item) => item.id === normalizedFollowupID);
    if (fromIndex < 0) return;
    const toIndex = Math.max(0, Math.min(items.length - 1, fromIndex + delta));
    if (fromIndex === toIndex) return;
    const [moved] = items.splice(fromIndex, 1);
    items.splice(toIndex, 0, moved);
    replaceThreadQueue(normalizedThreadID, items);
  };

  const pullFollowup = (threadID: string, followupID: string): CodexQueuedFollowup | null => {
    const normalizedThreadID = normalizeThreadID(threadID);
    const normalizedFollowupID = String(followupID ?? '').trim();
    if (!normalizedThreadID || !normalizedFollowupID) return null;
    const items = queuedByThread()[normalizedThreadID] ?? [];
    const target = items.find((item) => item.id === normalizedFollowupID) ?? null;
    if (!target) return null;
    replaceThreadQueue(
      normalizedThreadID,
      items.filter((item) => item.id !== normalizedFollowupID),
    );
    return cloneQueuedFollowup(target);
  };

  const shiftNextFollowup = (threadID: string): CodexQueuedFollowup | null => {
    const normalizedThreadID = normalizeThreadID(threadID);
    if (!normalizedThreadID) return null;
    const items = queuedByThread()[normalizedThreadID] ?? [];
    const [nextItem, ...rest] = items;
    if (!nextItem) return null;
    replaceThreadQueue(normalizedThreadID, rest);
    return cloneQueuedFollowup(nextItem);
  };

  const clearThread = (threadID: string): void => {
    replaceThreadQueue(threadID, []);
  };

  return {
    queuedByThread: queuedByThread as Accessor<CodexQueuedFollowupMap>,
    queuedForThread,
    queueFollowup,
    prependFollowup,
    removeFollowup,
    moveFollowup,
    pullFollowup,
    shiftNextFollowup,
    clearThread,
    replaceThreadQueue,
  };
}
