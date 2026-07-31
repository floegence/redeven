export const DESKTOP_SHELL_OPEN_WEB_SERVICE_WINDOW_CHANNEL = 'redeven-desktop:shell-open-web-service-window';

export type DesktopShellOpenWebServiceWindowRequest = Readonly<{
  url: string;
  forward_id: string;
  target_url: string;
}>;

export type DesktopShellOpenWebServiceWindowResponse = Readonly<{
  ok: boolean;
  message?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function isLoopbackTargetOrigin(targetURL: URL): boolean {
  if (!targetURL.port || targetURL.pathname !== '/' || targetURL.search || targetURL.hash) return false;
  const hostname = targetURL.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '[::1]') return true;
  const octets = hostname.split('.');
  return octets.length === 4
    && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) <= 255)
    && octets[0] === '127';
}

export function normalizeDesktopShellOpenWebServiceWindowRequest(value: unknown): DesktopShellOpenWebServiceWindowRequest | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const forwardID = compact(candidate.forward_id);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u.test(forwardID)) return null;

  try {
    const url = new URL(compact(candidate.url));
    const targetURL = new URL(compact(candidate.target_url));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (targetURL.protocol !== 'http:' && targetURL.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    if (targetURL.username || targetURL.password) return null;
    if (!isLoopbackTargetOrigin(targetURL)) return null;
    return { url: url.toString(), forward_id: forwardID, target_url: targetURL.toString() };
  } catch {
    return null;
  }
}

export function normalizeDesktopShellOpenWebServiceWindowResponse(value: unknown): DesktopShellOpenWebServiceWindowResponse {
  if (!value || typeof value !== 'object') {
    return { ok: false, message: 'Desktop failed to open the Web Service window.' };
  }
  const candidate = value as Partial<DesktopShellOpenWebServiceWindowResponse>;
  const message = compact(candidate.message);
  return { ok: candidate.ok === true, message: message || undefined };
}
