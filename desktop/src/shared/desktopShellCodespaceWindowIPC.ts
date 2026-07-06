export const DESKTOP_SHELL_OPEN_CODESPACE_WINDOW_CHANNEL = 'redeven-desktop:shell-open-codespace-window';

export type DesktopShellOpenCodespaceWindowLoadingRequest = Readonly<{
  mode: 'loading';
  code_space_id: string;
  state?: 'loading' | 'error';
  title?: string;
  detail?: string;
}>;

export type DesktopShellOpenCodespaceWindowNavigateRequest = Readonly<{
  mode: 'navigate';
  url: string;
  code_space_id: string;
}>;

export type DesktopShellOpenCodespaceWindowRequest =
  | DesktopShellOpenCodespaceWindowLoadingRequest
  | DesktopShellOpenCodespaceWindowNavigateRequest;

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

  const candidate = value as Record<string, unknown>;
  const codeSpaceID = compact(candidate.code_space_id);
  const mode = compact(candidate.mode) || (compact(candidate.url) ? 'navigate' : '');
  if (!codeSpaceID) {
    return null;
  }

  if (mode === 'loading') {
    const state = compact(candidate.state);
    const title = compact(candidate.title);
    const detail = compact(candidate.detail);
    return {
      mode: 'loading',
      code_space_id: codeSpaceID,
      ...(state === 'error' ? { state } : {}),
      ...(title ? { title } : {}),
      ...(detail ? { detail } : {}),
    };
  }

  if (mode === 'navigate') {
    const url = normalizeAbsoluteHTTPURL(candidate.url);
    if (!url) {
      return null;
    }
    return {
      mode: 'navigate',
      url,
      code_space_id: codeSpaceID,
    };
  }

  return null;
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
