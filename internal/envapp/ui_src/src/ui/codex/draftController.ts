import { createSignal, type Accessor } from 'solid-js';

import type {
  CodexComposerAttachmentDraft,
  CodexComposerMentionDraft,
  CodexThreadRuntimeConfig,
} from './types';
import {
  resolveCodexApprovalPolicyValue,
  resolveCodexSandboxModeValue,
} from './runtimeDefaults';

export const CODEX_NEW_THREAD_OWNER = 'draft:new';

export type CodexRuntimeDraft = Readonly<{
  cwd: string;
  model: string;
  effort: string;
  approvalPolicy: string;
  sandboxMode: string;
}>;

export type CodexRuntimeDraftDirty = Readonly<{
  cwd: boolean;
  model: boolean;
  effort: boolean;
  approvalPolicy: boolean;
  sandboxMode: boolean;
}>;

export type CodexComposerDraft = Readonly<{
  text: string;
  attachments: CodexComposerAttachmentDraft[];
  mentions: CodexComposerMentionDraft[];
}>;

export type CodexOwnerDraftState = Readonly<{
  runtime: CodexRuntimeDraft;
  dirty: CodexRuntimeDraftDirty;
  composer: CodexComposerDraft;
}>;

const runtimeDirtyFieldMap: Record<keyof CodexRuntimeDraft, keyof CodexRuntimeDraftDirty> = {
  cwd: 'cwd',
  model: 'model',
  effort: 'effort',
  approvalPolicy: 'approvalPolicy',
  sandboxMode: 'sandboxMode',
};

function sameRuntimeDraft(left: CodexRuntimeDraft, right: CodexRuntimeDraft): boolean {
  return (
    left.cwd === right.cwd &&
    left.model === right.model &&
    left.effort === right.effort &&
    left.approvalPolicy === right.approvalPolicy &&
    left.sandboxMode === right.sandboxMode
  );
}

function sameAttachmentDraft(
  left: CodexComposerAttachmentDraft,
  right: CodexComposerAttachmentDraft,
): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.mime_type === right.mime_type &&
    left.size_bytes === right.size_bytes &&
    left.data_url === right.data_url &&
    left.preview_url === right.preview_url
  );
}

function sameAttachmentDraftList(
  left: readonly CodexComposerAttachmentDraft[],
  right: readonly CodexComposerAttachmentDraft[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => sameAttachmentDraft(entry, right[index]!));
}

function sameMentionDraft(
  left: CodexComposerMentionDraft,
  right: CodexComposerMentionDraft,
): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.path === right.path &&
    left.kind === right.kind &&
    left.is_image === right.is_image
  );
}

function sameMentionDraftList(
  left: readonly CodexComposerMentionDraft[],
  right: readonly CodexComposerMentionDraft[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => sameMentionDraft(entry, right[index]!));
}

export function codexOwnerIDForThread(threadID: string | null | undefined): string {
  const normalizedThreadID = String(threadID ?? '').trim();
  return normalizedThreadID ? `thread:${normalizedThreadID}` : CODEX_NEW_THREAD_OWNER;
}

function createRuntimeDraft(config: CodexThreadRuntimeConfig | null | undefined, fallbackCWD = ''): CodexRuntimeDraft {
  return {
    cwd: String(config?.cwd ?? fallbackCWD).trim(),
    model: String(config?.model ?? '').trim(),
    effort: String(config?.reasoning_effort ?? '').trim(),
    approvalPolicy: resolveCodexApprovalPolicyValue(config?.approval_policy),
    sandboxMode: resolveCodexSandboxModeValue(config?.sandbox_mode),
  };
}

function createDirtyState(): CodexRuntimeDraftDirty {
  return {
    cwd: false,
    model: false,
    effort: false,
    approvalPolicy: false,
    sandboxMode: false,
  };
}

function createComposerDraft(): CodexComposerDraft {
  return {
    text: '',
    attachments: [],
    mentions: [],
  };
}

function createOwnerDraftState(config: CodexThreadRuntimeConfig | null | undefined, fallbackCWD = ''): CodexOwnerDraftState {
  return {
    runtime: createRuntimeDraft(config, fallbackCWD),
    dirty: createDirtyState(),
    composer: createComposerDraft(),
  };
}

function withRuntimeField(
  state: CodexOwnerDraftState,
  field: keyof CodexRuntimeDraft,
  value: string,
  markDirty: boolean,
): CodexOwnerDraftState {
  const normalizedValue = String(value ?? '').trim();
  const dirtyField = runtimeDirtyFieldMap[field];
  const nextDirty = markDirty && !state.dirty[dirtyField]
    ? {
        ...state.dirty,
        [dirtyField]: true,
      }
    : state.dirty;
  if (state.runtime[field] === normalizedValue && nextDirty === state.dirty) {
    return state;
  }
  return {
    ...state,
    runtime: {
      ...state.runtime,
      [field]: normalizedValue,
    },
    dirty: nextDirty,
  };
}

function commitRuntimeField(
  state: CodexOwnerDraftState,
  field: keyof CodexRuntimeDraft,
  value: string,
): CodexOwnerDraftState {
  const normalizedValue = String(value ?? '').trim();
  const dirtyField = runtimeDirtyFieldMap[field];
  const nextRuntime = state.runtime[field] === normalizedValue
    ? state.runtime
    : {
        ...state.runtime,
        [field]: normalizedValue,
      };
  const nextDirty = state.dirty[dirtyField]
    ? {
        ...state.dirty,
        [dirtyField]: false,
      }
    : state.dirty;
  if (nextRuntime === state.runtime && nextDirty === state.dirty) {
    return state;
  }
  return {
    ...state,
    runtime: nextRuntime,
    dirty: nextDirty,
  };
}

function mergeRuntimeConfig(
  state: CodexOwnerDraftState,
  config: CodexThreadRuntimeConfig | null | undefined,
  fallbackCWD: string,
): CodexOwnerDraftState {
  const incoming = createRuntimeDraft(config, fallbackCWD);
  const nextRuntime = {
    cwd: state.dirty.cwd ? state.runtime.cwd : incoming.cwd,
    model: state.dirty.model ? state.runtime.model : incoming.model,
    effort: state.dirty.effort ? state.runtime.effort : incoming.effort,
    approvalPolicy: state.dirty.approvalPolicy ? state.runtime.approvalPolicy : incoming.approvalPolicy,
    sandboxMode: state.dirty.sandboxMode ? state.runtime.sandboxMode : incoming.sandboxMode,
  };
  if (sameRuntimeDraft(state.runtime, nextRuntime)) {
    return state;
  }
  return {
    ...state,
    runtime: nextRuntime,
  };
}

export function createCodexDraftController() {
  const [draftsByOwner, setDraftsByOwner] = createSignal<Record<string, CodexOwnerDraftState>>({});

  const draftForOwner = (
    ownerID: string,
    config: CodexThreadRuntimeConfig | null | undefined,
    fallbackCWD = '',
  ): CodexOwnerDraftState => draftsByOwner()[ownerID] ?? createOwnerDraftState(config, fallbackCWD);

  const ensureOwner = (
    ownerID: string,
    config: CodexThreadRuntimeConfig | null | undefined,
    fallbackCWD = '',
  ) => {
    const normalizedOwnerID = String(ownerID ?? '').trim();
    if (!normalizedOwnerID) return;
    setDraftsByOwner((current) => {
      if (current[normalizedOwnerID]) return current;
      return {
        ...current,
        [normalizedOwnerID]: createOwnerDraftState(config, fallbackCWD),
      };
    });
  };

  const mergeOwnerRuntimeConfig = (
    ownerID: string,
    config: CodexThreadRuntimeConfig | null | undefined,
    fallbackCWD = '',
  ) => {
    const normalizedOwnerID = String(ownerID ?? '').trim();
    if (!normalizedOwnerID) return;
    setDraftsByOwner((current) => {
      const existing = current[normalizedOwnerID] ?? createOwnerDraftState(config, fallbackCWD);
      const nextDraft = mergeRuntimeConfig(existing, config, fallbackCWD);
      if (nextDraft === existing && current[normalizedOwnerID]) {
        return current;
      }
      return {
        ...current,
        [normalizedOwnerID]: nextDraft,
      };
    });
  };

  const setRuntimeField = (
    ownerID: string,
    field: keyof CodexRuntimeDraft,
    value: string,
    markDirty = true,
    fallbackCWD = '',
  ) => {
    const normalizedOwnerID = String(ownerID ?? '').trim();
    if (!normalizedOwnerID) return;
    setDraftsByOwner((current) => {
      const existing = current[normalizedOwnerID] ?? createOwnerDraftState(null, fallbackCWD);
      const nextDraft = withRuntimeField(existing, field, value, markDirty);
      if (nextDraft === existing && current[normalizedOwnerID]) {
        return current;
      }
      return {
        ...current,
        [normalizedOwnerID]: nextDraft,
      };
    });
  };

  const commitOwnerRuntimeField = (
    ownerID: string,
    field: keyof CodexRuntimeDraft,
    value: string,
    fallbackCWD = '',
  ) => {
    const normalizedOwnerID = String(ownerID ?? '').trim();
    if (!normalizedOwnerID) return;
    setDraftsByOwner((current) => {
      const existing = current[normalizedOwnerID] ?? createOwnerDraftState(null, fallbackCWD);
      const nextDraft = commitRuntimeField(existing, field, value);
      if (nextDraft === existing && current[normalizedOwnerID]) {
        return current;
      }
      return {
        ...current,
        [normalizedOwnerID]: nextDraft,
      };
    });
  };

  const setComposerText = (ownerID: string, text: string) => {
    const normalizedOwnerID = String(ownerID ?? '').trim();
    if (!normalizedOwnerID) return;
    setDraftsByOwner((current) => {
      const existing = current[normalizedOwnerID] ?? createOwnerDraftState(null, '');
      if (existing.composer.text === text) {
        return current;
      }
      return {
        ...current,
        [normalizedOwnerID]: {
          ...existing,
          composer: {
            ...existing.composer,
            text,
          },
        },
      };
    });
  };

  const replaceAttachments = (ownerID: string, attachments: readonly CodexComposerAttachmentDraft[]) => {
    const normalizedOwnerID = String(ownerID ?? '').trim();
    if (!normalizedOwnerID) return;
    setDraftsByOwner((current) => {
      const existing = current[normalizedOwnerID] ?? createOwnerDraftState(null, '');
      if (sameAttachmentDraftList(existing.composer.attachments, attachments)) {
        return current;
      }
      return {
        ...current,
        [normalizedOwnerID]: {
          ...existing,
          composer: {
            ...existing.composer,
            attachments: [...attachments],
          },
        },
      };
    });
  };

  const appendAttachments = (ownerID: string, attachments: readonly CodexComposerAttachmentDraft[]) => {
    if (attachments.length === 0) return;
    const normalizedOwnerID = String(ownerID ?? '').trim();
    if (!normalizedOwnerID) return;
    setDraftsByOwner((current) => {
      const existing = current[normalizedOwnerID] ?? createOwnerDraftState(null, '');
      const nextAttachments = [...existing.composer.attachments, ...attachments];
      if (sameAttachmentDraftList(existing.composer.attachments, nextAttachments)) {
        return current;
      }
      return {
        ...current,
        [normalizedOwnerID]: {
          ...existing,
          composer: {
            ...existing.composer,
            attachments: nextAttachments,
          },
        },
      };
    });
  };

  const replaceMentions = (ownerID: string, mentions: readonly CodexComposerMentionDraft[]) => {
    const normalizedOwnerID = String(ownerID ?? '').trim();
    if (!normalizedOwnerID) return;
    setDraftsByOwner((current) => {
      const existing = current[normalizedOwnerID] ?? createOwnerDraftState(null, '');
      if (sameMentionDraftList(existing.composer.mentions, mentions)) {
        return current;
      }
      return {
        ...current,
        [normalizedOwnerID]: {
          ...existing,
          composer: {
            ...existing.composer,
            mentions: [...mentions],
          },
        },
      };
    });
  };

  const appendMentions = (ownerID: string, mentions: readonly CodexComposerMentionDraft[]) => {
    if (mentions.length === 0) return;
    const normalizedOwnerID = String(ownerID ?? '').trim();
    if (!normalizedOwnerID) return;
    setDraftsByOwner((current) => {
      const existing = current[normalizedOwnerID] ?? createOwnerDraftState(null, '');
      const seenPaths = new Set(existing.composer.mentions.map((entry) => entry.path));
      const nextMentions = [...existing.composer.mentions];
      for (const mention of mentions) {
        if (seenPaths.has(mention.path)) continue;
        seenPaths.add(mention.path);
        nextMentions.push(mention);
      }
      if (sameMentionDraftList(existing.composer.mentions, nextMentions)) {
        return current;
      }
      return {
        ...current,
        [normalizedOwnerID]: {
          ...existing,
          composer: {
            ...existing.composer,
            mentions: nextMentions,
          },
        },
      };
    });
  };

  const removeMention = (ownerID: string, mentionID: string) => {
    const normalizedOwnerID = String(ownerID ?? '').trim();
    const normalizedMentionID = String(mentionID ?? '').trim();
    if (!normalizedOwnerID || !normalizedMentionID) return;
    setDraftsByOwner((current) => {
      const existing = current[normalizedOwnerID];
      if (!existing) return current;
      const nextMentions = existing.composer.mentions.filter((mention) => mention.id !== normalizedMentionID);
      if (sameMentionDraftList(existing.composer.mentions, nextMentions)) {
        return current;
      }
      return {
        ...current,
        [normalizedOwnerID]: {
          ...existing,
          composer: {
            ...existing.composer,
            mentions: nextMentions,
          },
        },
      };
    });
  };

  const removeAttachment = (ownerID: string, attachmentID: string) => {
    const normalizedOwnerID = String(ownerID ?? '').trim();
    const normalizedAttachmentID = String(attachmentID ?? '').trim();
    if (!normalizedOwnerID || !normalizedAttachmentID) return;
    setDraftsByOwner((current) => {
      const existing = current[normalizedOwnerID];
      if (!existing) return current;
      const nextAttachments = existing.composer.attachments.filter((attachment) => attachment.id !== normalizedAttachmentID);
      if (sameAttachmentDraftList(existing.composer.attachments, nextAttachments)) {
        return current;
      }
      return {
        ...current,
        [normalizedOwnerID]: {
          ...existing,
          composer: {
            ...existing.composer,
            attachments: nextAttachments,
          },
        },
      };
    });
  };

  const resetComposer = (ownerID: string) => {
    const normalizedOwnerID = String(ownerID ?? '').trim();
    if (!normalizedOwnerID) return;
    setDraftsByOwner((current) => {
      const existing = current[normalizedOwnerID];
      if (!existing) return current;
      if (
        existing.composer.text === '' &&
        existing.composer.attachments.length === 0 &&
        existing.composer.mentions.length === 0
      ) {
        return current;
      }
      return {
        ...current,
        [normalizedOwnerID]: {
          ...existing,
          composer: createComposerDraft(),
        },
      };
    });
  };

  const transferOwner = (fromOwnerID: string, toOwnerID: string) => {
    const normalizedFromOwnerID = String(fromOwnerID ?? '').trim();
    const normalizedToOwnerID = String(toOwnerID ?? '').trim();
    if (!normalizedFromOwnerID || !normalizedToOwnerID || normalizedFromOwnerID === normalizedToOwnerID) return;
    setDraftsByOwner((current) => {
      const source = current[normalizedFromOwnerID];
      if (!source) return current;
      const next = { ...current, [normalizedToOwnerID]: source };
      delete next[normalizedFromOwnerID];
      return next;
    });
  };

  const removeOwner = (ownerID: string) => {
    const normalizedOwnerID = String(ownerID ?? '').trim();
    if (!normalizedOwnerID) return;
    setDraftsByOwner((current) => {
      if (!(normalizedOwnerID in current)) return current;
      const next = { ...current };
      delete next[normalizedOwnerID];
      return next;
    });
  };

  return {
    draftsByOwner: draftsByOwner as Accessor<Record<string, CodexOwnerDraftState>>,
    draftForOwner,
    ensureOwner,
    mergeOwnerRuntimeConfig,
    setRuntimeField,
    commitOwnerRuntimeField,
    setComposerText,
    replaceAttachments,
    appendAttachments,
    removeAttachment,
    replaceMentions,
    appendMentions,
    removeMention,
    resetComposer,
    transferOwner,
    removeOwner,
  };
}
