import { getLocalRuntime } from './controlplaneApi';
import { AccessUnlockError, isKnownAccessUnlockErrorCode, normalizeRetryAfterMs } from './accessUnlockError';
import { applyLocalAccessResumeHeader } from './localAccessAuth';

export type EnvAppAccessStatus = {
  password_required: boolean;
  unlocked: boolean;
};

export type EnvAppAccessUnlockResult = {
  unlocked: boolean;
  resume_token?: string;
  resume_expires_at_unix_ms?: number;
};

export type LocalUploadResponse = {
  url?: string;
};

export type LocalStagedAttachmentResponse = {
  attachment_id?: string;
  display_name?: string;
  detected_media_type?: string;
  size_bytes?: number;
  content_sha256?: string;
  unicode_code_points?: number;
  logical_line_count?: number;
  source?: string;
  capability_revision?: string;
  created_at_unix_ms?: number;
  logical_locator?: string;
  download_url?: string;
};

export type LocalAttachmentUploadRequest = Readonly<{
  file: File;
  source: 'uploaded_file' | 'long_text';
  requestID: string;
  stagingScopeID: string;
  stagingCapability: string;
  contentSHA256: string;
  displayNameSHA256: string;
  signal: AbortSignal;
  onProgress: (loaded: number, total?: number) => void;
}>;

export class LocalApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly data: unknown;

  constructor(args: Readonly<{ message: string; status?: number; code?: string; data?: unknown }>) {
    super(String(args.message ?? 'Local API request failed'));
    this.name = 'LocalApiError';
    this.status = Number.isFinite(args.status) ? Math.max(0, Math.floor(args.status!)) : 0;
    this.code = String(args.code ?? '').trim();
    this.data = args.data;
  }
}

function localApiErrorMessage(data: any, status: number): string {
  const nested = String(data?.error?.message ?? '').trim();
  if (nested) return nested;
  const flat = String(data?.error ?? '').trim();
  if (flat && flat !== '[object Object]') return flat;
  return `HTTP ${status}`;
}

function localApiErrorCode(data: any): string {
  return String(data?.error_code ?? data?.error?.code ?? '').trim();
}

function localApiRetryAfterMs(data: any): number {
  return normalizeRetryAfterMs(data?.error?.retry_after_ms ?? data?.data?.retry_after_ms);
}

function shouldSetJSONContentType(body: BodyInit | null | undefined): boolean {
  if (body == null) return false;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return false;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return false;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return false;
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return false;
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) return false;
  return true;
}

export async function localApiRequestCredentials(): Promise<RequestCredentials> {
  try {
    return (await getLocalRuntime()) ? 'same-origin' : 'omit';
  } catch {
    return 'omit';
  }
}

export async function prepareLocalApiRequestInit(init: RequestInit): Promise<RequestInit> {
  const headers = new Headers(init.headers);
  if (shouldSetJSONContentType(init.body) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  let localRuntimeAvailable = false;
  try {
    localRuntimeAvailable = Boolean(await getLocalRuntime());
    if (localRuntimeAvailable) {
      applyLocalAccessResumeHeader(headers);
    }
  } catch {
    // ignore
  }

  return {
    ...init,
    headers,
    credentials: init.credentials ?? (localRuntimeAvailable ? 'same-origin' : 'omit'),
    cache: 'no-store',
  };
}

export async function fetchLocalApiJSON<T>(url: string, init: RequestInit): Promise<T> {
  return (await fetchLocalApiJSONResponse<T>(url, init)).data;
}

export type LocalApiJSONResponse<T> = Readonly<{
  data: T;
  headers: Headers;
  status: number;
}>;

export async function fetchLocalApiJSONResponse<T>(url: string, init: RequestInit): Promise<LocalApiJSONResponse<T>> {
  const resp = await fetch(url, await prepareLocalApiRequestInit(init));
  const text = await resp.text();
  let data: any = null;
  let parsedJSON = false;
  try {
    if (text) {
      data = JSON.parse(text);
      parsedJSON = true;
    }
  } catch {
    // Error responses still use their HTTP status below without exposing the body.
  }
  if (!resp.ok) {
    const message = localApiErrorMessage(data, resp.status);
    const code = localApiErrorCode(data) || 'HTTP_ERROR';
    const retryAfterMs = localApiRetryAfterMs(data);
    if (retryAfterMs > 0 || isKnownAccessUnlockErrorCode(code)) {
      throw new AccessUnlockError({ message, status: resp.status, code, retryAfterMs });
    }
    throw new LocalApiError({ message, status: resp.status, code, data: data?.data });
  }
  if (data?.ok === false) {
    const message = localApiErrorMessage(data, resp.status || 400);
    const code = localApiErrorCode(data) || 'REQUEST_FAILED';
    const retryAfterMs = localApiRetryAfterMs(data);
    if (retryAfterMs > 0 || isKnownAccessUnlockErrorCode(code)) {
      throw new AccessUnlockError({ message, status: resp.status || 400, code, retryAfterMs });
    }
    throw new LocalApiError({ message, status: resp.status || 400, code, data: data?.data });
  }
  if (resp.status !== 204 && !parsedJSON) {
    throw new LocalApiError({
      message: 'Local API returned an invalid JSON response.',
      status: resp.status,
      code: 'INVALID_JSON_RESPONSE',
    });
  }
  return {
    data: (data?.data ?? data) as T,
    headers: resp.headers,
    status: resp.status,
  };
}

export async function uploadLocalApiFile(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);

  const out = await fetchLocalApiJSON<LocalUploadResponse>('/_redeven_proxy/api/ai/uploads', {
    method: 'POST',
    body: form,
  });

  const url = String(out?.url ?? '').trim();
  if (!url) {
    throw new Error('Upload response missing url');
  }
  return url;
}

export async function uploadLocalApiAttachment(request: LocalAttachmentUploadRequest): Promise<LocalStagedAttachmentResponse> {
  if (request.signal.aborted) {
    const error = new Error('Attachment upload was cancelled.');
    error.name = 'AbortError';
    throw error;
  }
  const form = new FormData();
  form.append('source', request.source);
  form.append('file', request.file, request.file.name);
  const init = await prepareLocalApiRequestInit({
    method: 'POST',
    body: form,
    headers: {
      'Idempotency-Key': request.requestID,
      'Upload-Staging-Scope-ID': request.stagingScopeID,
      'Upload-Staging-Capability': request.stagingCapability,
      'Upload-Content-SHA256': request.contentSHA256,
      'Upload-Content-Length': String(request.file.size),
      'Upload-Display-Name-SHA256': request.displayNameSHA256,
    },
  });
  return new Promise<LocalStagedAttachmentResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = () => request.signal.removeEventListener('abort', abort);
    xhr.open('POST', '/_redeven_proxy/api/ai/uploads', true);
    xhr.withCredentials = init.credentials !== 'omit';
    new Headers(init.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
    xhr.upload.onprogress = (event) => {
      request.onProgress(event.loaded, event.lengthComputable ? event.total : undefined);
    };
    xhr.onerror = () => {
      finish();
      reject(new LocalApiError({ message: 'Attachment upload transport failed.', status: xhr.status }));
    };
    xhr.onabort = () => {
      finish();
      const error = new Error('Attachment upload was cancelled.');
      error.name = 'AbortError';
      reject(error);
    };
    xhr.onload = () => {
      finish();
      let data: any = null;
      let parsedJSON = false;
      try {
        if (xhr.responseText) {
          data = JSON.parse(xhr.responseText);
          parsedJSON = true;
        }
      } catch {
        // The typed error below intentionally omits an untrusted response body.
      }
      if (xhr.status < 200 || xhr.status >= 300 || data?.ok === false) {
        const message = localApiErrorMessage(data, xhr.status || 400);
        const code = localApiErrorCode(data) || 'REQUEST_FAILED';
        const retryAfterMs = localApiRetryAfterMs(data);
        if (retryAfterMs > 0 || isKnownAccessUnlockErrorCode(code)) {
          reject(new AccessUnlockError({ message, status: xhr.status || 400, code, retryAfterMs }));
          return;
        }
        reject(new LocalApiError({ message, status: xhr.status || 400, code, data: data?.data }));
        return;
      }
      if (xhr.status !== 204 && !parsedJSON) {
        reject(new LocalApiError({
          message: 'Attachment upload returned an invalid JSON response.',
          status: xhr.status,
          code: 'INVALID_JSON_RESPONSE',
        }));
        return;
      }
      resolve((data?.data ?? data) as LocalStagedAttachmentResponse);
    };
    request.signal.addEventListener('abort', abort, { once: true });
    if (request.signal.aborted) {
      finish();
      const error = new Error('Attachment upload was cancelled.');
      error.name = 'AbortError';
      reject(error);
      return;
    }
    xhr.send(form);
  });
}

export async function getEnvAppAccessStatus(): Promise<EnvAppAccessStatus> {
  const out = await fetchLocalApiJSON<EnvAppAccessStatus>('/_redeven_proxy/api/access/status', { method: 'GET', credentials: 'omit' });
  if (typeof out?.password_required !== 'boolean' || typeof out?.unlocked !== 'boolean') {
    throw new Error('Invalid access status response');
  }
  return out;
}

export async function unlockEnvAppAccess(password: string): Promise<EnvAppAccessUnlockResult> {
  const out = await fetchLocalApiJSON<EnvAppAccessUnlockResult>('/_redeven_proxy/api/access/unlock', {
    method: 'POST',
    credentials: 'omit',
    body: JSON.stringify({ password: String(password ?? '') }),
  });
  const unlocked = Boolean(out?.unlocked) || Boolean(String(out?.resume_token ?? '').trim());
  if (!unlocked) throw new Error('Unlock failed');
  return { ...out, unlocked: true };
}
