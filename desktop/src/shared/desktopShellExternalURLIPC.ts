export const DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL = 'redeven-desktop:shell-open-external-url';
export const DESKTOP_SHELL_OPEN_DASHBOARD_CHANNEL = 'redeven-desktop:shell-open-dashboard';

const REDEVEN_PUBLIC_INSTALL_SCRIPT_URL = 'https://redeven.com/install.sh';

export const DESKTOP_DASHBOARD_URL = new URL('/dashboard', REDEVEN_PUBLIC_INSTALL_SCRIPT_URL).toString();

export type DesktopShellOpenExternalURLRequest = Readonly<{
  url: string;
}>;

export type DesktopShellOpenExternalURLResponse = Readonly<{
  ok: boolean;
  message?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeAbsoluteHTTPURL(value: unknown): string {
  const raw = compact(value);
  if (!raw || raw === 'about:blank') {
    return '';
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }
    return url.toString();
  } catch {
    return '';
  }
}

export function normalizeDesktopShellOpenExternalURLRequest(value: unknown): DesktopShellOpenExternalURLRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopShellOpenExternalURLRequest>;
  const url = normalizeAbsoluteHTTPURL(candidate.url);
  if (!url) {
    return null;
  }

  return { url };
}

export function normalizeDesktopShellOpenExternalURLResponse(value: unknown): DesktopShellOpenExternalURLResponse {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      message: 'Desktop failed to open the system browser.',
    };
  }

  const candidate = value as Partial<DesktopShellOpenExternalURLResponse>;
  const message = compact(candidate.message);
  return {
    ok: candidate.ok === true,
    message: message || undefined,
  };
}
