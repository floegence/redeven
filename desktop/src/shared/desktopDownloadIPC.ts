export const DESKTOP_DOWNLOAD_PREPARE_CHANNEL = 'redeven-desktop:download-prepare';
export const DESKTOP_DOWNLOAD_WRITE_CHANNEL = 'redeven-desktop:download-write';
export const DESKTOP_DOWNLOAD_COMPLETE_CHANNEL = 'redeven-desktop:download-complete';
export const DESKTOP_DOWNLOAD_ABORT_CHANNEL = 'redeven-desktop:download-abort';
export const DESKTOP_DOWNLOAD_REVEAL_CHANNEL = 'redeven-desktop:download-reveal';
export const DESKTOP_DOWNLOAD_OPEN_CHANNEL = 'redeven-desktop:download-open';

export type DesktopDownloadPrepareRequest = Readonly<{
  task_id: string;
  suggested_name: string;
  total_bytes?: number;
}>;

export type DesktopDownloadDestination = Readonly<{
  token: string;
  file_name: string;
  display_path: string;
}>;

export type DesktopDownloadPrepareResponse = Readonly<{
  ok: boolean;
  destination?: DesktopDownloadDestination;
  canceled?: boolean;
  message?: string;
}>;

export type DesktopDownloadWriteRequest = Readonly<{
  token: string;
  chunk: ArrayBuffer | Uint8Array;
}>;

export type DesktopDownloadCompleteRequest = Readonly<{
  token: string;
}>;

export type DesktopDownloadCompleteResponse = Readonly<{
  ok: boolean;
  destination?: DesktopDownloadDestination;
  message?: string;
}>;

export type DesktopDownloadAbortRequest = Readonly<{
  token: string;
  reason: 'canceled' | 'failed';
}>;

export type DesktopDownloadActionRequest = Readonly<{
  token: string;
}>;

export type DesktopDownloadActionResponse = Readonly<{
  ok: boolean;
  message?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return Math.floor(numeric);
}

function normalizeToken(value: unknown): string {
  const token = compact(value);
  return token.length > 0 && token.length <= 160 ? token : '';
}

function normalizeChunk(value: unknown): Uint8Array<ArrayBuffer> | null {
  if (value instanceof Uint8Array && value.buffer instanceof ArrayBuffer) {
    return value as Uint8Array<ArrayBuffer>;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView;
    if (!(view.buffer instanceof ArrayBuffer)) {
      return null;
    }
    return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  return null;
}

export function normalizeDesktopDownloadPrepareRequest(value: unknown): DesktopDownloadPrepareRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopDownloadPrepareRequest>;
  const taskID = compact(candidate.task_id);
  const suggestedName = compact(candidate.suggested_name);
  if (!taskID || !suggestedName) {
    return null;
  }

  return {
    task_id: taskID.slice(0, 160),
    suggested_name: suggestedName.slice(0, 255),
    total_bytes: normalizePositiveInteger(candidate.total_bytes),
  };
}

export function normalizeDesktopDownloadWriteRequest(value: unknown): DesktopDownloadWriteRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopDownloadWriteRequest>;
  const token = normalizeToken(candidate.token);
  const chunk = normalizeChunk(candidate.chunk);
  if (!token || !chunk) {
    return null;
  }

  return { token, chunk };
}

export function normalizeDesktopDownloadCompleteRequest(value: unknown): DesktopDownloadCompleteRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const token = normalizeToken((value as Partial<DesktopDownloadCompleteRequest>).token);
  return token ? { token } : null;
}

export function normalizeDesktopDownloadAbortRequest(value: unknown): DesktopDownloadAbortRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopDownloadAbortRequest>;
  const token = normalizeToken(candidate.token);
  const reason = candidate.reason === 'failed' ? 'failed' : candidate.reason === 'canceled' ? 'canceled' : '';
  if (!token || !reason) {
    return null;
  }

  return { token, reason };
}

export function normalizeDesktopDownloadActionRequest(value: unknown): DesktopDownloadActionRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const token = normalizeToken((value as Partial<DesktopDownloadActionRequest>).token);
  return token ? { token } : null;
}

export function normalizeDesktopDownloadPrepareResponse(value: unknown): DesktopDownloadPrepareResponse {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: 'Desktop could not prepare the download.' };
  }

  const candidate = value as Partial<DesktopDownloadPrepareResponse>;
  const destination = normalizeDesktopDownloadDestination(candidate.destination);
  const message = compact(candidate.message);
  return {
    ok: candidate.ok === true,
    ...(destination ? { destination } : {}),
    canceled: candidate.canceled === true,
    message: message || undefined,
  };
}

export function normalizeDesktopDownloadCompleteResponse(value: unknown): DesktopDownloadCompleteResponse {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: 'Desktop could not finish the download.' };
  }

  const candidate = value as Partial<DesktopDownloadCompleteResponse>;
  const destination = normalizeDesktopDownloadDestination(candidate.destination);
  const message = compact(candidate.message);
  return {
    ok: candidate.ok === true,
    ...(destination ? { destination } : {}),
    message: message || undefined,
  };
}

export function normalizeDesktopDownloadActionResponse(value: unknown): DesktopDownloadActionResponse {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: 'Desktop download action failed.' };
  }

  const candidate = value as Partial<DesktopDownloadActionResponse>;
  const message = compact(candidate.message);
  return {
    ok: candidate.ok === true,
    message: message || undefined,
  };
}

function normalizeDesktopDownloadDestination(value: unknown): DesktopDownloadDestination | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Partial<DesktopDownloadDestination>;
  const token = normalizeToken(candidate.token);
  const fileName = compact(candidate.file_name);
  const displayPath = compact(candidate.display_path);
  if (!token || !fileName || !displayPath) {
    return undefined;
  }

  return {
    token,
    file_name: fileName,
    display_path: displayPath,
  };
}
