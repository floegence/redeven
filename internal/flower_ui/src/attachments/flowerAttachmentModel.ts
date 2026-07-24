import type {
  FlowerAttachmentCapability,
  FlowerAttachmentRoute,
  FlowerAttachmentUploadProgress,
  FlowerStagedAttachment,
} from '../contracts/flowerSurfaceContracts';

export const FLOWER_INLINE_TEXT_CODE_POINT_LIMIT = 50_000;
export const FLOWER_ATTACHMENT_UPLOAD_CONCURRENCY = 3;
export const FLOWER_LONG_TEXT_MIME_TYPE = 'text/plain; charset=utf-8';

type FlowerAttachmentCapabilityWire = Readonly<{
  model_id?: unknown;
  revision?: unknown;
  enabled?: unknown;
  max_count?: unknown;
  max_item_bytes?: unknown;
  max_turn_bytes?: unknown;
  media_types?: unknown;
  supports_long_text?: unknown;
}>;

export function normalizeFlowerAttachmentCapability(raw: unknown): FlowerAttachmentCapability {
  const value = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as FlowerAttachmentCapabilityWire
    : {};
  const modelID = String(value.model_id ?? '').trim();
  const revision = String(value.revision ?? '').trim();
  const maxAttachments = Math.floor(Number(value.max_count));
  const maxFileSizeBytes = Math.floor(Number(value.max_item_bytes));
  const maxTotalSizeBytes = Math.floor(Number(value.max_turn_bytes));
  const routes: Record<string, FlowerAttachmentRoute> = {};
  if (Array.isArray(value.media_types)) {
    for (const entry of value.media_types) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
      const record = entry as Readonly<{ media_type?: unknown; mode?: unknown }>;
      const mediaType = String(record.media_type ?? '').trim().toLowerCase();
      const mode = String(record.mode ?? '').trim();
      if (!mediaType || (mode !== 'native_full_content' && mode !== 'tool_read' && mode !== 'unsupported')) continue;
      routes[mediaType] = mode;
    }
  }
  const shapeValid = !!modelID && !!revision
    && Number.isSafeInteger(maxAttachments) && maxAttachments > 0
    && Number.isSafeInteger(maxFileSizeBytes) && maxFileSizeBytes > 0
    && Number.isSafeInteger(maxTotalSizeBytes) && maxTotalSizeBytes >= maxFileSizeBytes;
  return {
    model_id: modelID,
    revision,
    enabled: shapeValid && value.enabled === true,
    supports_long_text: shapeValid && value.supports_long_text === true,
    max_attachments: shapeValid ? maxAttachments : 0,
    max_file_size_bytes: shapeValid ? maxFileSizeBytes : 0,
    max_total_size_bytes: shapeValid ? maxTotalSizeBytes : 0,
    routes,
  };
}

export type FlowerTextInspection = Readonly<{
  codePoints: number;
  lines: number;
  sizeBytes: number;
}>;

export type FlowerPasteTextDecision =
  | Readonly<{ kind: 'reject_ill_formed'; value: string }>
  | Readonly<{
      kind: 'attach_payload';
      value: string;
      payload: string;
      selectionStart: number;
      selectionEnd: number;
      inspection: FlowerTextInspection;
    }>
  | Readonly<{
      kind: 'keep_editor';
      value: string;
      selectionStart: number;
      selectionEnd: number;
      overLimit: boolean;
      inspection: FlowerTextInspection;
    }>;

export function flowerStringHasIsolatedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
  }
  return false;
}

export function inspectFlowerText(value: string): FlowerTextInspection | null {
  if (flowerStringHasIsolatedSurrogate(value)) return null;
  let codePoints = 0;
  let lines = value.length === 0 ? 0 : 1;
  for (let index = 0; index < value.length;) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0x0d) {
      lines += 1;
      index += value.charCodeAt(index + 1) === 0x0a ? 2 : 1;
      codePoints += value.charCodeAt(index - 1) === 0x0a ? 2 : 1;
      continue;
    }
    if (codeUnit === 0x0a) lines += 1;
    const width = codeUnit >= 0xd800 && codeUnit <= 0xdbff ? 2 : 1;
    index += width;
    codePoints += 1;
  }
  return {
    codePoints,
    lines,
    sizeBytes: new TextEncoder().encode(value).byteLength,
  };
}

function clampSelectionOffset(value: string, raw: number): number {
  if (!Number.isFinite(raw)) return value.length;
  return Math.max(0, Math.min(value.length, Math.floor(raw)));
}

export function replaceFlowerTextSelection(
  value: string,
  replacement: string,
  selectionStart: number,
  selectionEnd: number,
): Readonly<{ value: string; selectionStart: number; selectionEnd: number }> {
  const start = clampSelectionOffset(value, Math.min(selectionStart, selectionEnd));
  const end = clampSelectionOffset(value, Math.max(selectionStart, selectionEnd));
  const next = `${value.slice(0, start)}${replacement}${value.slice(end)}`;
  const caret = start + replacement.length;
  return { value: next, selectionStart: caret, selectionEnd: caret };
}

export function decideFlowerTextPaste(input: Readonly<{
  value: string;
  payload: string;
  selectionStart: number;
  selectionEnd: number;
  limit?: number;
}>): FlowerPasteTextDecision {
  const payloadInspection = inspectFlowerText(input.payload);
  if (!payloadInspection) return { kind: 'reject_ill_formed', value: input.value };
  const limit = Math.max(0, Math.floor(input.limit ?? FLOWER_INLINE_TEXT_CODE_POINT_LIMIT));
  const start = clampSelectionOffset(input.value, Math.min(input.selectionStart, input.selectionEnd));
  const end = clampSelectionOffset(input.value, Math.max(input.selectionStart, input.selectionEnd));
  if (payloadInspection.codePoints > limit) {
    return {
      kind: 'attach_payload',
      value: `${input.value.slice(0, start)}${input.value.slice(end)}`,
      payload: input.payload,
      selectionStart: start,
      selectionEnd: start,
      inspection: payloadInspection,
    };
  }
  const replacement = replaceFlowerTextSelection(input.value, input.payload, start, end);
  const inspection = inspectFlowerText(replacement.value);
  if (!inspection) return { kind: 'reject_ill_formed', value: input.value };
  return {
    kind: 'keep_editor',
    ...replacement,
    overLimit: inspection.codePoints > limit,
    inspection,
  };
}

export function normalizeFlowerUploadProgress(
  progress: FlowerAttachmentUploadProgress,
): FlowerAttachmentUploadProgress | null {
  const loaded = Math.floor(Number(progress.loaded));
  if (!progress.attempt_id || !Number.isFinite(loaded) || loaded < 0) return null;
  if (progress.indeterminate) {
    if (progress.total !== undefined) return null;
    return { attempt_id: progress.attempt_id, loaded, indeterminate: true };
  }
  const total = Math.floor(Number(progress.total));
  if (!Number.isFinite(total) || total < 0 || loaded > total) return null;
  return { attempt_id: progress.attempt_id, loaded, total, indeterminate: false };
}

export function flowerAttachmentRoute(
  capability: FlowerAttachmentCapability,
  mimeType: string,
): FlowerAttachmentRoute {
  const canonical = mimeType.trim().toLowerCase();
  const essence = canonical.split(';', 1)[0]?.trim() ?? canonical;
  return capability.routes[canonical] ?? capability.routes[essence] ?? 'unsupported';
}

export function flowerStagedAttachmentCompatible(
  capability: FlowerAttachmentCapability,
  attachment: FlowerStagedAttachment,
): boolean {
  return capability.enabled
    && capability.revision === attachment.capability_revision
    && flowerAttachmentRoute(capability, attachment.mime_type) !== 'unsupported';
}

export function flowerAttachmentIDs(
  attachments: readonly Readonly<{ status: string; staged?: FlowerStagedAttachment }>[]
): readonly string[] {
  return attachments.flatMap((item) => (
    item.status === 'staged_ready' && item.staged?.attachment_id ? [item.staged.attachment_id] : []
  ));
}
