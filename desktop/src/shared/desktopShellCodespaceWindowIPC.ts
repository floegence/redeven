export const DESKTOP_SHELL_OPEN_CODESPACE_WINDOW_CHANNEL = 'redeven-desktop:shell-open-codespace-window';

export type DesktopShellOpenCodespaceWindowRequest = Readonly<{
  url: string;
  code_space_id: string;
}>;

export type DesktopShellOpenCodespaceWindowResponse = Readonly<{
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

export function normalizeDesktopShellOpenCodespaceWindowRequest(value: unknown): DesktopShellOpenCodespaceWindowRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopShellOpenCodespaceWindowRequest>;
  const url = normalizeAbsoluteHTTPURL(candidate.url);
  const codeSpaceID = compact(candidate.code_space_id);
  if (!url || !codeSpaceID) {
    return null;
  }

  return {
    url,
    code_space_id: codeSpaceID,
  };
}

export function normalizeDesktopShellOpenCodespaceWindowResponse(value: unknown): DesktopShellOpenCodespaceWindowResponse {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      message: 'Desktop failed to open the codespace window.',
    };
  }

  const candidate = value as Partial<DesktopShellOpenCodespaceWindowResponse>;
  const message = compact(candidate.message);
  return {
    ok: candidate.ok === true,
    message: message || undefined,
  };
}
