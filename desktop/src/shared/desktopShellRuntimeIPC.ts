export const DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL = 'redeven-desktop:shell-runtime-action';

export type DesktopShellRuntimeAction = 'restart_managed_runtime' | 'manage_desktop_update';

export type DesktopShellRuntimeActionRequest = Readonly<{
  action: DesktopShellRuntimeAction;
}>;

export type DesktopShellRuntimeActionResponse = Readonly<{
  ok: boolean;
  started: boolean;
  message?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeDesktopShellRuntimeAction(value: unknown): DesktopShellRuntimeAction | '' {
  const action = compact(value);
  if (action === 'restart_managed_runtime' || action === 'restart_runtime' || action === 'restart') {
    return 'restart_managed_runtime';
  }
  if (action === 'manage_desktop_update' || action === 'desktop_update' || action === 'update') {
    return 'manage_desktop_update';
  }
  return '';
}

export function normalizeDesktopShellRuntimeActionRequest(value: unknown): DesktopShellRuntimeActionRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopShellRuntimeActionRequest>;
  const action = normalizeDesktopShellRuntimeAction(candidate.action);
  if (!action) {
    return null;
  }

  return { action };
}

export function normalizeDesktopShellRuntimeActionResponse(value: unknown): DesktopShellRuntimeActionResponse {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      started: false,
      message: 'Desktop runtime action failed.',
    };
  }

  const candidate = value as Partial<DesktopShellRuntimeActionResponse>;
  const message = String(candidate.message ?? '').trim();
  return {
    ok: candidate.ok === true,
    started: candidate.started === true,
    message: message || undefined,
  };
}
