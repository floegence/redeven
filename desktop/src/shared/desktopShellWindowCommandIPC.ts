export const DESKTOP_SHELL_WINDOW_COMMAND_CHANNEL = 'redeven-desktop:shell-window-command';

export type DesktopShellWindowCommand = 'minimize' | 'toggle_maximize' | 'toggle_full_screen';

export type DesktopShellWindowCommandRequest = Readonly<{
  command: DesktopShellWindowCommand;
}>;

export type DesktopShellWindowState = Readonly<{
  minimized: boolean;
  maximized: boolean;
  full_screen: boolean;
  minimizable: boolean;
  maximizable: boolean;
  full_screenable: boolean;
}>;

export type DesktopShellWindowCommandResponse = Readonly<{
  ok: boolean;
  performed: boolean;
  state: DesktopShellWindowState | null;
  message?: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function normalizeDesktopShellWindowCommand(value: unknown): DesktopShellWindowCommand | '' {
  const command = compact(value);
  if (command === 'minimize' || command === 'minimize_window') {
    return 'minimize';
  }
  if (command === 'toggle_maximize' || command === 'toggle-maximize' || command === 'maximize') {
    return 'toggle_maximize';
  }
  if (
    command === 'toggle_full_screen'
    || command === 'togglefullscreen'
    || command === 'toggle_fullscreen'
    || command === 'fullscreen'
  ) {
    return 'toggle_full_screen';
  }
  return '';
}

export function normalizeDesktopShellWindowCommandRequest(value: unknown): DesktopShellWindowCommandRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopShellWindowCommandRequest>;
  const command = normalizeDesktopShellWindowCommand(candidate.command);
  if (!command) {
    return null;
  }

  return { command };
}

export function normalizeDesktopShellWindowState(value: unknown): DesktopShellWindowState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<DesktopShellWindowState>;
  return {
    minimized: candidate.minimized === true,
    maximized: candidate.maximized === true,
    full_screen: candidate.full_screen === true,
    minimizable: candidate.minimizable === true,
    maximizable: candidate.maximizable === true,
    full_screenable: candidate.full_screenable === true,
  };
}

export function normalizeDesktopShellWindowCommandResponse(value: unknown): DesktopShellWindowCommandResponse {
  if (!value || typeof value !== 'object') {
    return {
      ok: false,
      performed: false,
      state: null,
      message: 'Desktop window command failed.',
    };
  }

  const candidate = value as Partial<DesktopShellWindowCommandResponse>;
  const message = String(candidate.message ?? '').trim();
  return {
    ok: candidate.ok === true,
    performed: candidate.performed === true,
    state: normalizeDesktopShellWindowState(candidate.state),
    message: message || undefined,
  };
}
