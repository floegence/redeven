export const HOST_APPLICATION_WINDOW_ACTION_CHANNEL = 'redeven-desktop:host-application-window-action';
export const HOST_APPLICATION_WINDOW_STATE_CHANNEL = 'redeven-desktop:host-application-window-state';

export type HostApplicationWindowAction = 'state' | 'close' | 'minimize' | 'maximize' | 'unmaximize';
export type HostApplicationWindowState = Readonly<{ maximized: boolean; minimized: boolean }>;

export function isHostApplicationWindowAction(value: unknown): value is HostApplicationWindowAction {
  return value === 'state' || value === 'close' || value === 'minimize' || value === 'maximize' || value === 'unmaximize';
}

export function isHostApplicationWindowState(value: unknown): value is HostApplicationWindowState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return typeof state.maximized === 'boolean' && typeof state.minimized === 'boolean';
}
