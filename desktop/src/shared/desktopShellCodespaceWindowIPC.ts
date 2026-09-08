export const DESKTOP_SHELL_OPEN_CODESPACE_WINDOW_CHANNEL =
  'redeven-desktop:shell-open-codespace-window';

export type DesktopShellOpenCodespaceWindowLoadingRequest = Readonly<{
  mode: 'loading';
  code_space_id: string;
  state?: 'loading' | 'error';
  title?: string;
  detail?: string;
}>;

export type DesktopShellOpenCodespaceWindowOpenRequest = Readonly<{
  mode: 'open';
  code_space_id: string;
  password?: string;
}>;

export type DesktopShellOpenCodespaceWindowRequest =
  | DesktopShellOpenCodespaceWindowLoadingRequest
  | DesktopShellOpenCodespaceWindowOpenRequest;

export type DesktopShellOpenCodespaceWindowResponse = Readonly<{
  ok: boolean;
  message?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeDesktopShellOpenCodespaceWindowRequest(
  value: unknown,
): DesktopShellOpenCodespaceWindowRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const codeSpaceID = compact(candidate.code_space_id);
  const mode = compact(candidate.mode);
  if (
    !/^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/u.test(codeSpaceID) ||
    'url' in candidate ||
    'host' in candidate ||
    'port' in candidate ||
    'route' in candidate
  ) {
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

  if (mode === 'open') {
    if (
      candidate.password !== undefined &&
      (typeof candidate.password !== 'string' ||
        candidate.password.length > 1024)
    )
      return null;
    return {
      mode: 'open',
      code_space_id: codeSpaceID,
      ...(typeof candidate.password === 'string'
        ? { password: candidate.password }
        : {}),
    };
  }

  return null;
}

export function normalizeDesktopShellOpenCodespaceWindowResponse(
  value: unknown,
): DesktopShellOpenCodespaceWindowResponse {
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
