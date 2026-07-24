export const PREPARE_RUNTIME_FLOWER_ATTACHMENT_CHANNEL = 'redeven-desktop:runtime-flower-attachment-prepare';
export const WRITE_RUNTIME_FLOWER_ATTACHMENT_CHUNK_CHANNEL = 'redeven-desktop:runtime-flower-attachment-chunk';
export const COMMIT_RUNTIME_FLOWER_ATTACHMENT_CHANNEL = 'redeven-desktop:runtime-flower-attachment-commit';
export const CANCEL_RUNTIME_FLOWER_ATTACHMENT_CHANNEL = 'redeven-desktop:runtime-flower-attachment-cancel';
export const RUNTIME_FLOWER_ATTACHMENT_PROGRESS_CHANNEL = 'redeven-desktop:runtime-flower-attachment-progress';
export const PREVIEW_RUNTIME_FLOWER_ATTACHMENT_CHANNEL = 'redeven-desktop:runtime-flower-attachment-preview';

export const RUNTIME_FLOWER_ATTACHMENT_CHUNK_SIZE_BYTES = 256 * 1024;

export type RuntimeFlowerAttachmentSource = 'uploaded_file' | 'long_text';

export type RuntimeFlowerAttachmentPrepareRequest = Readonly<{
  operation_id: string;
  upload_request_id: string;
  draft_id: string;
  source: RuntimeFlowerAttachmentSource;
  display_name: string;
  media_type: string;
  size_bytes: number;
  content_sha256: string;
  display_name_sha256: string;
}>;

export type RuntimeFlowerAttachmentPrepareResponse = Readonly<{
  ok: boolean;
  operation_id?: string;
  chunk_size_bytes?: number;
  message?: string;
}>;

export type RuntimeFlowerAttachmentChunkRequest = Readonly<{
  operation_id: string;
  offset_bytes: number;
  chunk: Uint8Array<ArrayBuffer>;
}>;

export type RuntimeFlowerAttachmentChunkResponse = Readonly<{
  ok: boolean;
  next_offset_bytes?: number;
  message?: string;
}>;

export type RuntimeFlowerAttachmentCommitRequest = Readonly<{
  operation_id: string;
}>;

export type RuntimeFlowerAttachmentCommitResponse = Readonly<{
  ok: boolean;
  data?: unknown;
  error?: Readonly<{
    code?: string;
    message: string;
    status?: number;
    retryAfterMs?: number;
    data?: unknown;
  }>;
  failureKind?: 'response' | 'transport_unknown' | 'local';
}>;

export type RuntimeFlowerAttachmentCancelRequest = Readonly<{
  operation_id: string;
}>;

export type RuntimeFlowerAttachmentCancelResponse = Readonly<{
  ok: boolean;
  cancelled: boolean;
  message?: string;
}>;

export type RuntimeFlowerAttachmentProgress = Readonly<{
  operation_id: string;
  loaded_bytes: number;
  total_bytes: number;
  state: 'uploading' | 'completed' | 'cancelled' | 'failed';
}>;

export type RuntimeFlowerAttachmentPreviewRequest = Readonly<{
  attachment_id: string;
  draft_id: string;
  display_name: string;
}>;

export type RuntimeFlowerAttachmentPreviewResponse = Readonly<{
  ok: boolean;
  message?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function boundedID(value: unknown): string {
  const id = compact(value);
  return id.length > 0 && id.length <= 160 ? id : '';
}

function nonNegativeInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function normalizeSHA256(value: unknown): string {
  const digest = compact(value).toLowerCase();
  return /^[0-9a-f]{64}$/u.test(digest) ? digest : '';
}

function containsASCIIControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function canonicalDisplayName(value: unknown): string {
  const name = String(value ?? '');
  if (!name || name !== name.normalize('NFC') || containsASCIIControl(name) || /[/\\]/u.test(name)) return '';
  for (let index = 0; index < name.length; index += 1) {
    const code = name.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = name.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return '';
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return '';
    }
  }
  return name;
}

function canonicalMediaType(value: unknown): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw.length > 512 || containsASCIIControl(raw)) return '';
  const segments = raw.split(';').map((segment) => segment.trim());
  if (segments.length > 2) return '';
  const [essence, parameter] = segments;
  const [type, subtype, ...extra] = (essence ?? '').split('/');
  const token = /^[a-z0-9!#$&^_.+-]+$/u;
  if (!type || !subtype || extra.length > 0 || !token.test(type) || !token.test(subtype)) return '';
  if (parameter !== undefined && parameter !== 'charset=utf-8') return '';
  return `${type}/${subtype}${parameter ? '; charset=utf-8' : ''}`;
}

function normalizeChunk(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (!(value instanceof Uint8Array) || value.byteLength <= 0 || value.byteLength > RUNTIME_FLOWER_ATTACHMENT_CHUNK_SIZE_BYTES) {
    return null;
  }
  return Uint8Array.from(value);
}

export function normalizeRuntimeFlowerAttachmentPrepareRequest(value: unknown): RuntimeFlowerAttachmentPrepareRequest | null {
  const record = value && typeof value === 'object' ? value as Partial<RuntimeFlowerAttachmentPrepareRequest> : {};
  const operationID = boundedID(record.operation_id);
  const uploadRequestID = boundedID(record.upload_request_id);
  const draftID = boundedID(record.draft_id);
  const source = compact(record.source);
  const displayName = canonicalDisplayName(record.display_name);
  const mediaType = canonicalMediaType(record.media_type);
  const sizeBytes = nonNegativeInteger(record.size_bytes);
  const contentSHA256 = normalizeSHA256(record.content_sha256);
  const displayNameSHA256 = normalizeSHA256(record.display_name_sha256);
  if (!operationID || !uploadRequestID || !draftID || (source !== 'uploaded_file' && source !== 'long_text') ||
      !displayName || displayName.length > 1024 || !mediaType || mediaType.length > 512 ||
      sizeBytes === undefined || !contentSHA256 || !displayNameSHA256) {
    return null;
  }
  return {
    operation_id: operationID,
    upload_request_id: uploadRequestID,
    draft_id: draftID,
    source,
    display_name: displayName,
    media_type: mediaType,
    size_bytes: sizeBytes,
    content_sha256: contentSHA256,
    display_name_sha256: displayNameSHA256,
  };
}

export function normalizeRuntimeFlowerAttachmentChunkRequest(value: unknown): RuntimeFlowerAttachmentChunkRequest | null {
  const record = value && typeof value === 'object' ? value as Partial<RuntimeFlowerAttachmentChunkRequest> : {};
  const operationID = boundedID(record.operation_id);
  const offsetBytes = nonNegativeInteger(record.offset_bytes);
  const chunk = normalizeChunk(record.chunk);
  return operationID && offsetBytes !== undefined && chunk
    ? { operation_id: operationID, offset_bytes: offsetBytes, chunk }
    : null;
}

export function normalizeRuntimeFlowerAttachmentOperationRequest(value: unknown): RuntimeFlowerAttachmentCommitRequest | null {
  const record = value && typeof value === 'object' ? value as Partial<RuntimeFlowerAttachmentCommitRequest> : {};
  const operationID = boundedID(record.operation_id);
  return operationID ? { operation_id: operationID } : null;
}

export function normalizeRuntimeFlowerAttachmentPreviewRequest(value: unknown): RuntimeFlowerAttachmentPreviewRequest | null {
  const record = value && typeof value === 'object' ? value as Partial<RuntimeFlowerAttachmentPreviewRequest> : {};
  const attachmentID = boundedID(record.attachment_id);
  const draftID = boundedID(record.draft_id);
  const displayName = canonicalDisplayName(record.display_name);
  return attachmentID && draftID && displayName && displayName.length <= 1024
    ? { attachment_id: attachmentID, draft_id: draftID, display_name: displayName }
    : null;
}

export function normalizeRuntimeFlowerAttachmentProgress(value: unknown): RuntimeFlowerAttachmentProgress | null {
  const record = value && typeof value === 'object' ? value as Partial<RuntimeFlowerAttachmentProgress> : {};
  const operationID = boundedID(record.operation_id);
  const loadedBytes = nonNegativeInteger(record.loaded_bytes);
  const totalBytes = nonNegativeInteger(record.total_bytes);
  const state = compact(record.state);
  if (!operationID || loadedBytes === undefined || totalBytes === undefined || loadedBytes > totalBytes ||
      (state !== 'uploading' && state !== 'completed' && state !== 'cancelled' && state !== 'failed')) {
    return null;
  }
  return { operation_id: operationID, loaded_bytes: loadedBytes, total_bytes: totalBytes, state };
}
