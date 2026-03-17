import { getLocalRuntime } from './controlplaneApi';
import { applyLocalAccessResumeHeader } from './localAccessAuth';

export type GatewayAccessStatus = {
  password_required: boolean;
  unlocked: boolean;
};

export type GatewayAccessUnlockResult = {
  unlocked: boolean;
  resume_token?: string;
  resume_expires_at_unix_ms?: number;
};

export type GatewayUploadResponse = {
  url?: string;
};

function gatewayErrorMessage(data: any, status: number): string {
  const nested = String(data?.error?.message ?? '').trim();
  if (nested) return nested;
  const flat = String(data?.error ?? '').trim();
  if (flat && flat !== '[object Object]') return flat;
  return `HTTP ${status}`;
}

function shouldSetJSONContentType(body: BodyInit | null | undefined): boolean {
  if (body == null) return false;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return false;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return false;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return false;
  return true;
}

export async function gatewayRequestCredentials(): Promise<RequestCredentials> {
  try {
    return (await getLocalRuntime()) ? 'same-origin' : 'omit';
  } catch {
    return 'omit';
  }
}

export async function prepareGatewayRequestInit(init: RequestInit): Promise<RequestInit> {
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
    credentials: init.credentials ?? (await gatewayRequestCredentials()),
    cache: 'no-store',
  };
}

export async function fetchGatewayJSON<T>(url: string, init: RequestInit): Promise<T> {
  const resp = await fetch(url, await prepareGatewayRequestInit(init));
  const text = await resp.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }
  if (!resp.ok) throw new Error(gatewayErrorMessage(data, resp.status));
  if (data?.ok === false) throw new Error(gatewayErrorMessage(data, resp.status || 400));
  return (data?.data ?? data) as T;
}

export async function uploadGatewayFile(file: File): Promise<string> {
  const form = new FormData();
  form.append('file', file);

  const out = await fetchGatewayJSON<GatewayUploadResponse>('/_redeven_proxy/api/ai/uploads', {
    method: 'POST',
    body: form,
  });

  const url = String(out?.url ?? '').trim();
  if (!url) {
    throw new Error('Upload response missing url');
  }
  return url;
}

export async function getGatewayAccessStatus(): Promise<GatewayAccessStatus> {
  const out = await fetchGatewayJSON<GatewayAccessStatus>('/_redeven_proxy/api/access/status', { method: 'GET', credentials: 'omit' });
  if (typeof out?.password_required !== 'boolean' || typeof out?.unlocked !== 'boolean') {
    throw new Error('Invalid access status response');
  }
  return out;
}

export async function unlockGatewayAccess(password: string): Promise<GatewayAccessUnlockResult> {
  const out = await fetchGatewayJSON<GatewayAccessUnlockResult>('/_redeven_proxy/api/access/unlock', {
    method: 'POST',
    credentials: 'omit',
    body: JSON.stringify({ password: String(password ?? '') }),
  });
  const unlocked = Boolean(out?.unlocked) || Boolean(String(out?.resume_token ?? '').trim());
  if (!unlocked) throw new Error('Unlock failed');
  return { ...out, unlocked: true };
}
