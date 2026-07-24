import type {
  FlowerAttachmentCapability,
  FlowerAttachmentSource,
  FlowerAttachmentUploadInput,
  FlowerStagedAttachment,
  FlowerStagedLongTextReadResult,
} from '../contracts/flowerSurfaceContracts';
import {
  FLOWER_ATTACHMENT_UPLOAD_CONCURRENCY,
  FLOWER_LONG_TEXT_MIME_TYPE,
  flowerStagedAttachmentCompatible,
  inspectFlowerText,
  normalizeFlowerUploadProgress,
} from './flowerAttachmentModel';

export type FlowerAttachmentItemStatus =
  | 'local_validating'
  | 'queued'
  | 'uploading'
  | 'staged_ready'
  | 'validation_error'
  | 'upload_error'
  | 'incompatible'
  | 'reselect_required';

export type FlowerAttachmentErrorCode =
  | 'attachment_unavailable'
  | 'attachment_too_large'
  | 'attachment_count_exceeded'
  | 'attachment_total_size_exceeded'
  | 'attachment_unsupported'
  | 'attachment_invalid_text_encoding'
  | 'attachment_upload_failed'
  | 'attachment_restore_failed';

export type FlowerAttachmentItem = Readonly<{
  local_id: string;
  request_id: string;
  attempt_id: string;
  source: FlowerAttachmentSource;
  name: string;
  mime_type: string;
  size_bytes: number;
  text_stats?: Readonly<{ code_points: number; lines: number }>;
  status: FlowerAttachmentItemStatus;
  loaded_bytes: number;
  total_bytes?: number;
  progress_indeterminate: boolean;
  error_code?: FlowerAttachmentErrorCode;
  staged?: FlowerStagedAttachment;
}>;

type MutableFlowerAttachmentItem = {
  local_id: string;
  request_id: string;
  attempt_id: string;
  source: FlowerAttachmentSource;
  name: string;
  mime_type: string;
  size_bytes: number;
  text_stats?: { code_points: number; lines: number };
  status: FlowerAttachmentItemStatus;
  loaded_bytes: number;
  total_bytes?: number;
  progress_indeterminate: boolean;
  error_code?: FlowerAttachmentErrorCode;
  staged?: FlowerStagedAttachment;
  file?: File;
  longText?: string;
  controller?: AbortController;
};

export type FlowerAttachmentControllerSnapshot = Readonly<{
  capability: FlowerAttachmentCapability | null;
  items: readonly FlowerAttachmentItem[];
  active_uploads: number;
  queued_uploads: number;
}>;

export type FlowerLongTextAddResult =
  | Readonly<{ kind: 'accepted'; local_id: string }>
  | Readonly<{ kind: 'rejected'; error_code: FlowerAttachmentErrorCode }>;

export type FlowerAttachmentController = Readonly<{
  snapshot: () => FlowerAttachmentControllerSnapshot;
  subscribe: (listener: (snapshot: FlowerAttachmentControllerSnapshot) => void) => () => void;
  setCapability: (capability: FlowerAttachmentCapability | null) => void;
  hydrateDraft: (items: readonly FlowerAttachmentDraftHydrationItem[]) => void;
  addFiles: (files: readonly File[], source: Extract<FlowerAttachmentSource, 'file' | 'paste' | 'drop'>) => readonly string[];
  addLongText: (text: string, name?: string) => FlowerLongTextAddResult;
  retry: (localID: string) => void;
  reselect: (localID: string, file: File) => void;
  cancel: (localID: string) => void;
  remove: (localID: string) => void;
  consumeReady: (localIDs: readonly string[]) => void;
  restoreLongText: (localID: string) => Promise<string>;
  waitForIdle: () => Promise<void>;
  dispose: () => void;
}>;

export type FlowerAttachmentDraftHydrationItem = Readonly<{
  local_id: string;
  request_id: string;
  source: FlowerAttachmentSource;
  name: string;
  mime_type: string;
  size_bytes: number;
  staged?: FlowerStagedAttachment;
}>;

export type FlowerAttachmentControllerOptions = Readonly<{
  draftID?: string;
  capability?: FlowerAttachmentCapability | null;
  upload?: (input: FlowerAttachmentUploadInput) => Promise<FlowerStagedAttachment>;
  deleteStaged?: (attachmentID: string, draftID: string) => Promise<void>;
  readStagedLongText?: (attachment: FlowerStagedAttachment, draftID: string) => Promise<FlowerStagedLongTextReadResult>;
  now?: () => number;
  createID?: (kind: 'local' | 'request' | 'attempt') => string;
  concurrency?: number;
}>;

function readonlyItem(item: MutableFlowerAttachmentItem): FlowerAttachmentItem {
  const { file: _file, longText: _longText, controller: _controller, ...visible } = item;
  return { ...visible };
}

function safeFileType(file: File): string {
  return file.type.trim().toLowerCase() || 'application/octet-stream';
}

function secureRandomID(kind: 'local' | 'request' | 'attempt'): string {
  const runtimeCrypto = globalThis.crypto;
  if (typeof runtimeCrypto?.randomUUID === 'function') {
    return `flower_attachment_${kind}_${runtimeCrypto.randomUUID()}`;
  }
  if (typeof runtimeCrypto?.getRandomValues !== 'function') {
    throw new Error('Secure randomness is required for Flower attachment identifiers.');
  }
  const bytes = runtimeCrypto.getRandomValues(new Uint8Array(16));
  return `flower_attachment_${kind}_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function uploadFailure(error: unknown): Readonly<{ code: FlowerAttachmentErrorCode; retryable: boolean }> {
  const record = error && typeof error === 'object'
    ? error as { code?: unknown; data?: unknown }
    : {};
  const code = String(record.code ?? '').trim();
  const data = record.data && typeof record.data === 'object'
    ? record.data as { retryable?: unknown }
    : {};
  switch (code) {
    case 'attachment_too_large':
      return { code: 'attachment_too_large', retryable: false };
    case 'attachment_invalid_text_encoding':
      return { code: 'attachment_invalid_text_encoding', retryable: false };
    case 'attachment_unsupported_media_type':
      return { code: 'attachment_unsupported', retryable: false };
    case 'attachment_quota_exceeded':
      return { code: 'attachment_total_size_exceeded', retryable: false };
    case 'upload_invalid_request':
    case 'upload_idempotency_conflict':
    case 'attachment_integrity_mismatch':
      return { code: 'attachment_unavailable', retryable: false };
    case 'upload_in_progress':
    case 'attachment_store_unavailable':
      return { code: 'attachment_upload_failed', retryable: true };
    default:
      return {
        code: 'attachment_upload_failed',
        retryable: data.retryable === undefined ? true : data.retryable === true,
      };
  }
}

export function createFlowerAttachmentController(
  options: FlowerAttachmentControllerOptions,
): FlowerAttachmentController {
  const draftID = options.draftID?.trim() || '__new_thread__';
  let capability = options.capability ?? null;
  let disposed = false;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? FLOWER_ATTACHMENT_UPLOAD_CONCURRENCY));
  const now = options.now ?? Date.now;
  let longTextOrdinal = 0;
  const items: MutableFlowerAttachmentItem[] = [];
  const listeners = new Set<(snapshot: FlowerAttachmentControllerSnapshot) => void>();
  const idleWaiters = new Set<() => void>();

  const createID = (kind: 'local' | 'request' | 'attempt') => options.createID?.(kind) ?? secureRandomID(kind);
  const invalidateAttempt = (item: MutableFlowerAttachmentItem) => {
    item.controller?.abort();
    item.controller = undefined;
    item.attempt_id = createID('attempt');
  };
  const snapshot = (): FlowerAttachmentControllerSnapshot => ({
    capability,
    items: items.map(readonlyItem),
    active_uploads: items.filter((item) => item.status === 'uploading').length,
    queued_uploads: items.filter((item) => item.status === 'queued').length,
  });
  const emit = () => {
    const next = snapshot();
    for (const listener of listeners) listener(next);
    if (next.active_uploads === 0 && next.queued_uploads === 0) {
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    }
  };

  const validationError = (file: File, excludedLocalID?: string): FlowerAttachmentErrorCode | null => {
    if (!capability?.enabled || !options.upload) return 'attachment_unavailable';
    const retainedItems = excludedLocalID
      ? items.filter((item) => item.local_id !== excludedLocalID)
      : items;
    if (retainedItems.length >= capability.max_attachments) return 'attachment_count_exceeded';
    if (file.size > capability.max_file_size_bytes) return 'attachment_too_large';
    const retainedBytes = retainedItems.reduce((total, item) => total + item.size_bytes, 0);
    if (retainedBytes + file.size > capability.max_total_size_bytes) return 'attachment_total_size_exceeded';
    return null;
  };

  const applyStagedMetadata = (
    item: MutableFlowerAttachmentItem,
    staged: FlowerStagedAttachment,
  ) => {
    item.name = staged.name;
    item.mime_type = staged.mime_type;
    item.size_bytes = staged.size_bytes;
    item.text_stats = staged.text_stats ? { ...staged.text_stats } : undefined;
    item.staged = staged;
    item.loaded_bytes = staged.size_bytes;
    item.total_bytes = staged.size_bytes;
    item.progress_indeterminate = false;
  };

  const pump = () => {
    if (disposed) return;
    let active = items.filter((item) => item.status === 'uploading').length;
    for (const item of items) {
      if (active >= concurrency) break;
      if (item.status !== 'queued' || !item.file || !capability || !options.upload) continue;
      active += 1;
      item.status = 'uploading';
      item.error_code = undefined;
      item.loaded_bytes = 0;
      item.total_bytes = item.file.size;
      item.progress_indeterminate = false;
      item.attempt_id = createID('attempt');
      const attemptID = item.attempt_id;
      const uploadRequestID = item.request_id;
      const controller = new AbortController();
      item.controller = controller;
      const upload = options.upload;
      const uploadCapability = capability;
      emit();
      void upload({
        attempt_id: attemptID,
        request_id: item.request_id,
        draft_id: draftID,
        model_id: uploadCapability.model_id,
        capability_revision: uploadCapability.revision,
        source: item.source,
        file: item.file,
        signal: controller.signal,
        on_progress: (rawProgress) => {
          const progress = normalizeFlowerUploadProgress(rawProgress);
          if (!progress || item.attempt_id !== attemptID || item.status !== 'uploading') return;
          item.loaded_bytes = progress.loaded;
          item.progress_indeterminate = progress.indeterminate;
          item.total_bytes = progress.total;
          emit();
        },
      }).then((staged) => {
        if (item.attempt_id !== attemptID || item.status !== 'uploading') {
          const current = items.find((candidate) => candidate.local_id === item.local_id);
          if (!current || current.request_id !== uploadRequestID) {
            if (staged.attachment_id) void options.deleteStaged?.(staged.attachment_id, draftID).catch(() => undefined);
            return;
          }
          if (current.staged?.attachment_id === staged.attachment_id) return;
          if (!current.staged && (current.status === 'queued' || current.status === 'uploading')) {
            invalidateAttempt(current);
            current.attempt_id = attemptID;
            applyStagedMetadata(current, staged);
            current.status = flowerStagedAttachmentCompatible(capability ?? uploadCapability, staged)
              ? 'staged_ready'
              : 'incompatible';
            current.error_code = undefined;
            return;
          }
          if (staged.attachment_id) void options.deleteStaged?.(staged.attachment_id, draftID).catch(() => undefined);
          return;
        }
        applyStagedMetadata(item, staged);
        item.status = flowerStagedAttachmentCompatible(capability ?? uploadCapability, staged)
          ? 'staged_ready'
          : 'incompatible';
      }).catch((error: unknown) => {
        if (item.attempt_id !== attemptID || item.status !== 'uploading') return;
        const failure = uploadFailure(error);
        item.status = failure.retryable ? 'upload_error' : 'validation_error';
        item.error_code = failure.code;
      }).finally(() => {
        if (item.attempt_id === attemptID) item.controller = undefined;
        emit();
        pump();
      });
    }
  };

  const enqueueFile = (
    file: File,
    source: FlowerAttachmentSource,
    longText?: string,
    textStats?: Readonly<{ code_points: number; lines: number }>,
  ): string => {
    const localID = createID('local');
    const error = validationError(file);
    items.push({
      local_id: localID,
      request_id: createID('request'),
      attempt_id: '',
      source,
      name: file.name || 'attachment',
      mime_type: safeFileType(file),
      size_bytes: file.size,
      text_stats: textStats ? { ...textStats } : undefined,
      status: error ? 'validation_error' : 'queued',
      loaded_bytes: 0,
      progress_indeterminate: false,
      error_code: error ?? undefined,
      file,
      longText,
    });
    emit();
    pump();
    return localID;
  };

  return {
    snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    setCapability: (next) => {
      capability = next;
      for (const item of items) {
        if (!item.staged) continue;
        item.status = next && flowerStagedAttachmentCompatible(next, item.staged)
          ? 'staged_ready'
          : 'incompatible';
      }
      emit();
      pump();
    },
    hydrateDraft: (draftItems) => {
      const incoming = new Set(draftItems.map((item) => item.local_id));
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (!item || incoming.has(item.local_id)) continue;
        invalidateAttempt(item);
        items.splice(index, 1);
      }
      for (const draftItem of draftItems) {
        const staged = draftItem.staged;
        const existing = items.find((item) => item.local_id === draftItem.local_id);
        const projected: MutableFlowerAttachmentItem = {
          local_id: draftItem.local_id,
          request_id: draftItem.request_id,
          attempt_id: '',
          source: draftItem.source,
          name: draftItem.name,
          mime_type: draftItem.mime_type,
          size_bytes: draftItem.size_bytes,
          text_stats: staged?.text_stats ? { ...staged.text_stats } : undefined,
          status: staged && capability && flowerStagedAttachmentCompatible(capability, staged)
            ? 'staged_ready'
            : staged
              ? 'incompatible'
              : 'reselect_required',
          loaded_bytes: staged?.size_bytes ?? 0,
          total_bytes: staged?.size_bytes,
          progress_indeterminate: false,
          staged,
          ...(existing?.file ? { file: existing.file } : {}),
          ...(existing?.longText !== undefined ? { longText: existing.longText } : {}),
          ...(existing?.controller ? { controller: existing.controller } : {}),
        };
        if (existing) Object.assign(existing, projected);
        else items.push(projected);
      }
      emit();
    },
    addFiles: (files, source) => files.map((file) => enqueueFile(file, source)),
    addLongText: (text, name) => {
      const inspection = inspectFlowerText(text);
      if (!inspection) return { kind: 'rejected', error_code: 'attachment_invalid_text_encoding' };
      const createdAt = new Date(now());
      const pad = (value: number) => String(value).padStart(2, '0');
      const generatedName = `long-message-${createdAt.getFullYear()}${pad(createdAt.getMonth() + 1)}${pad(createdAt.getDate())}-${pad(createdAt.getHours())}${pad(createdAt.getMinutes())}${pad(createdAt.getSeconds())}-${++longTextOrdinal}.txt`;
      let file: File;
      try {
        file = new File([new TextEncoder().encode(text)], name ?? generatedName, {
          type: FLOWER_LONG_TEXT_MIME_TYPE,
        });
      } catch {
        return { kind: 'rejected', error_code: 'attachment_unavailable' };
      }
      const error = validationError(file);
      if (error) return { kind: 'rejected', error_code: error };
      const localID = enqueueFile(file, 'long_text', text, {
        code_points: inspection.codePoints,
        lines: inspection.lines,
      });
      return { kind: 'accepted', local_id: localID };
    },
    retry: (localID) => {
      const item = items.find((candidate) => candidate.local_id === localID);
      if (!item || (item.status !== 'upload_error' && item.status !== 'validation_error' && item.status !== 'reselect_required')) return;
      if (!item.file) {
        item.status = 'reselect_required';
        emit();
        return;
      }
      const error = validationError(item.file, item.local_id);
      item.status = error ? 'validation_error' : 'queued';
      item.error_code = error ?? undefined;
      emit();
      pump();
    },
    reselect: (localID, file) => {
      const item = items.find((candidate) => candidate.local_id === localID);
      if (!item || item.status !== 'reselect_required') return;
      item.request_id = createID('request');
      item.attempt_id = '';
      item.source = 'file';
      item.name = file.name || 'attachment';
      item.mime_type = safeFileType(file);
      item.size_bytes = file.size;
      item.text_stats = undefined;
      item.staged = undefined;
      item.file = file;
      item.longText = undefined;
      const error = validationError(file, item.local_id);
      item.status = error ? 'validation_error' : 'queued';
      item.error_code = error ?? undefined;
      item.loaded_bytes = 0;
      item.total_bytes = undefined;
      item.progress_indeterminate = false;
      emit();
      pump();
    },
    cancel: (localID) => {
      const index = items.findIndex((candidate) => candidate.local_id === localID);
      if (index < 0) return;
      const item = items[index];
      if (item) invalidateAttempt(item);
      items.splice(index, 1);
      if (item?.staged?.attachment_id) {
        void options.deleteStaged?.(item.staged.attachment_id, draftID).catch(() => undefined);
      }
      emit();
      pump();
    },
    remove: (localID) => {
      const index = items.findIndex((candidate) => candidate.local_id === localID);
      if (index < 0) return;
      const item = items[index];
      if (item) invalidateAttempt(item);
      items.splice(index, 1);
      emit();
      pump();
    },
    consumeReady: (localIDs) => {
      const consumed = new Set(localIDs);
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        if (item?.status === 'staged_ready' && consumed.has(item.local_id)) items.splice(index, 1);
      }
      emit();
      pump();
    },
    restoreLongText: async (localID) => {
      const item = items.find((candidate) => candidate.local_id === localID);
      if (!item || item.source !== 'long_text') throw new Error('attachment_restore_failed');
      if (item.longText !== undefined) return item.longText;
      if (!item.staged?.attachment_id || !options.readStagedLongText) throw new Error('attachment_restore_failed');
      const restored = await options.readStagedLongText(item.staged, draftID);
      const inspection = inspectFlowerText(restored.text);
      if (
        !inspection
        || restored.attachment.attachment_id !== item.staged.attachment_id
        || restored.attachment.digest_sha256 !== item.staged.digest_sha256
        || inspection.sizeBytes !== item.staged.size_bytes
        || inspection.codePoints !== item.staged.text_stats?.code_points
      ) {
        throw new Error('attachment_restore_failed');
      }
      item.longText = restored.text;
      return restored.text;
    },
    waitForIdle: () => {
      const current = snapshot();
      if (current.active_uploads === 0 && current.queued_uploads === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.add(resolve));
    },
    dispose: () => {
      disposed = true;
      for (const item of items) invalidateAttempt(item);
      items.splice(0, items.length);
      listeners.clear();
      for (const resolve of idleWaiters) resolve();
      idleWaiters.clear();
    },
  };
}
