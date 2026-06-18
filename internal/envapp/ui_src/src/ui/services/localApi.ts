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

function localApiErrorMessage(data: any, status: number): string {
  const nested = String(data?.error?.message ?? '').trim();
  if (nested) return nested;
  const flat = String(data?.error ?? '').trim();
  if (flat && flat !== '[object Object]') return flat;
  return `HTTP ${status}`;
}

function localApiErrorCode(data: any): string {
  return String(data?.error?.code ?? '').trim();
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

  try {
    if (await getLocalRuntime()) {
      applyLocalAccessResumeHeader(headers);
    }
  } catch {
    // ignore
  }

  return {
    ...init,
    headers,
    credentials: init.credentials ?? (await localApiRequestCredentials()),
    cache: 'no-store',
  };
}

export async function fetchLocalApiJSON<T>(url: string, init: RequestInit): Promise<T> {
  const resp = await fetch(url, await prepareLocalApiRequestInit(init));
  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  if (!resp.ok) {
    const message = localApiErrorMessage(data, resp.status);
    const code = localApiErrorCode(data) || 'HTTP_ERROR';
    const retryAfterMs = localApiRetryAfterMs(data);
    if (retryAfterMs > 0 || isKnownAccessUnlockErrorCode(code)) {
      throw new AccessUnlockError({ message, status: resp.status, code, retryAfterMs });
    }
    throw new Error(message);
  }
  if (data?.ok === false) {
    const message = localApiErrorMessage(data, resp.status || 400);
    const code = localApiErrorCode(data) || 'REQUEST_FAILED';
    const retryAfterMs = localApiRetryAfterMs(data);
    if (retryAfterMs > 0 || isKnownAccessUnlockErrorCode(code)) {
      throw new AccessUnlockError({ message, status: resp.status || 400, code, retryAfterMs });
    }
    throw new Error(message);
  }
  return (data?.data ?? data) as T;
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
