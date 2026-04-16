import type { BrowserWindow } from 'electron';

import type {
  DesktopShellWindowCommand,
  DesktopShellWindowCommandResponse,
  DesktopShellWindowState,
} from '../shared/desktopShellWindowCommandIPC';

type DesktopShellWindowCommandTarget = Pick<
  BrowserWindow,
  | 'isDestroyed'
  | 'isMinimized'
  | 'isMaximized'
  | 'isFullScreen'
  | 'isMinimizable'
  | 'isMaximizable'
  | 'isFullScreenable'
  | 'minimize'
  | 'maximize'
  | 'unmaximize'
  | 'setFullScreen'
>;

function failure(message: string): DesktopShellWindowCommandResponse {
  return {
    ok: false,
    performed: false,
    state: null,
    message,
  };
}

export function captureDesktopShellWindowState(
  win: DesktopShellWindowCommandTarget | null | undefined,
): DesktopShellWindowState | null {
  if (!win || win.isDestroyed()) {
    return null;
  }

  return {
    minimized: win.isMinimized(),
    maximized: win.isMaximized(),
    full_screen: win.isFullScreen(),
    minimizable: win.isMinimizable(),
    maximizable: win.isMaximizable(),
    full_screenable: win.isFullScreenable(),
  };
}

export function performDesktopShellWindowCommand(
  win: DesktopShellWindowCommandTarget | null | undefined,
  command: DesktopShellWindowCommand,
): DesktopShellWindowCommandResponse {
  const state = captureDesktopShellWindowState(win);
  if (!win || !state) {
    return failure('Desktop could not resolve the current window.');
  }

  if (command === 'minimize') {
    if (!state.minimizable) {
      return {
        ok: false,
        performed: false,
        state,
        message: 'Desktop cannot minimize this window.',
      };
    }
    if (!state.minimized) {
      win.minimize();
    }
    return {
      ok: true,
      performed: !state.minimized,
      state: captureDesktopShellWindowState(win),
    };
  }

  if (command === 'toggle_maximize') {
    if (!state.maximizable) {
      return {
        ok: false,
        performed: false,
        state,
        message: 'Desktop cannot maximize this window.',
      };
    }
    if (state.maximized) {
      win.unmaximize();
    } else {
      win.maximize();
    }
    return {
      ok: true,
      performed: true,
      state: captureDesktopShellWindowState(win),
    };
  }

  if (!state.full_screenable) {
    return {
      ok: false,
      performed: false,
      state,
      message: 'Desktop cannot toggle full screen for this window.',
    };
  }

  win.setFullScreen(!state.full_screen);
  return {
    ok: true,
    performed: true,
    state: captureDesktopShellWindowState(win),
  };
}
