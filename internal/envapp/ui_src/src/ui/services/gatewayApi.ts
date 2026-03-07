export type GatewayAccessStatus = {
  password_required: boolean;
  unlocked: boolean;
};

export type GatewayAccessUnlockResult = {
  unlocked: boolean;
  resume_token?: string;
  resume_expires_at_unix_ms?: number;
};

function gatewayErrorMessage(data: any, status: number): string {
  const nested = String(data?.error?.message ?? '').trim();
  if (nested) return nested;
  const flat = String(data?.error ?? '').trim();
  if (flat && flat !== '[object Object]') return flat;
  return `HTTP ${status}`;
}

export function gatewayRequestCredentialsForHost(hostname: string): RequestCredentials {
  const host = String(hostname ?? '').trim().toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' ? 'same-origin' : 'omit';
}

export function gatewayRequestCredentials(): RequestCredentials {
  try {
    return gatewayRequestCredentialsForHost(window.location.hostname);
  } catch {
    return 'omit';
  }
}

export async function fetchGatewayJSON<T>(url: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  const resp = await fetch(url, {
    ...init,
    headers,
    credentials: init.credentials ?? gatewayRequestCredentials(),
    cache: 'no-store',
  });
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
