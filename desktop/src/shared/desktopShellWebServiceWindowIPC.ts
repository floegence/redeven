export const DESKTOP_SHELL_OPEN_WEB_SERVICE_WINDOW_CHANNEL = 'redeven-desktop:shell-open-web-service-window';

export type DesktopShellOpenWebServiceWindowRequest = Readonly<{
  url: string;
  forward_id: string;
}>;

export type DesktopShellOpenWebServiceWindowResponse = Readonly<{
  ok: boolean;
  message?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopShellOpenWebServiceWindowRequest(value: unknown): DesktopShellOpenWebServiceWindowRequest | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  const forwardID = compact(candidate.forward_id);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u.test(forwardID)) return null;

  try {
    const url = new URL(compact(candidate.url));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return { url: url.toString(), forward_id: forwardID };
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
