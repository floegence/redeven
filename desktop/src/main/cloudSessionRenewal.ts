type RenewalOptions = Readonly<{
  origin: string;
  envPublicID: string;
  isCurrent: () => boolean;
  requestOpenSession: () => Promise<string>;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
}>;

export function isCloudSessionRenewalDocument(rawURL: string, origin: string): boolean {
  try {
    const url = new URL(rawURL);
    return url.origin === origin && !url.username && !url.password && url.pathname === '/_redeven_boot/';
  } catch { return false; }
}

// The native owner selects the saved Cloud account and environment. Renderers
// receive only completion, never the account token or one-shot boot ticket.
export function createCloudSessionRenewal(options: RenewalOptions): () => Promise<boolean> {
  let pending: Promise<boolean> | undefined;
  const renew = async (): Promise<boolean> => {
    if (!options.isCurrent()) return false;
    const url = new URL(await options.requestOpenSession());
    if (!options.isCurrent() || url.origin !== options.origin || url.username || url.password
      || url.pathname !== '/_redeven_boot/' || url.search || url.hash.length > 16 * 1024) return false;
    const encoded = /^#redeven=([A-Za-z0-9_-]+)$/u.exec(url.hash)?.[1];
    if (!encoded) return false;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (payload.v !== 2 || payload.env_public_id !== options.envPublicID
      || payload.floe_app !== 'com.floegence.redeven.agent' || payload.code_space_id !== 'env-ui'
      || payload.app_path !== '/_redeven_proxy/env/' || typeof payload.boot_ticket !== 'string'
      || !payload.boot_ticket.trim()) return false;
    const response = await options.fetch(`${options.origin}/api/srv/v1/floeproxy/boot/exchange`, {
      method: 'POST', credentials: 'include', redirect: 'error', cache: 'no-store',
      headers: { Origin: options.origin, Authorization: `Bearer ${payload.boot_ticket}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || !options.isCurrent()) return false;
    const body = await response.json() as { success?: boolean; data?: Record<string, unknown> };
    return body.success === true && body.data?.env_public_id === options.envPublicID
      && body.data.floe_app === 'com.floegence.redeven.agent' && body.data.code_space_id === 'env-ui';
  };
  return () => {
    pending ??= renew().catch(() => false).finally(() => { pending = undefined; });
    return pending;
  };
}
