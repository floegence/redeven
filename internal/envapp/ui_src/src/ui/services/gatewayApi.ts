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
  if (!resp.ok) throw new Error(data?.error ?? `HTTP ${resp.status}`);
  if (data?.ok === false) throw new Error(String(data?.error ?? 'Request failed'));
  return (data?.data ?? data) as T;
}
