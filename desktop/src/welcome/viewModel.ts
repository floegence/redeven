import type { DesktopLauncherSurface, DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';

export type DesktopWelcomeShellViewModel = Readonly<{
  shell_title: 'Redeven Desktop';
  surface_title: string;
  connect_heading: 'Connect Environment';
  primary_action_label: 'Open This Device';
  settings_save_label: string;
}>;

export function capabilityUnavailableMessage(label: string): string {
  return `Connect to an Environment first to open ${label}.`;
}

export function surfaceTitle(surface: DesktopLauncherSurface): string {
  return surface === 'this_device_settings' ? 'This Device Settings' : 'Connect Environment';
}

export function shellStatus(snapshot: DesktopWelcomeSnapshot): Readonly<{
  tone: 'connected' | 'disconnected' | 'connecting' | 'error';
  label: string;
}> {
  if (snapshot.issue) {
    return {
      tone: 'error',
      label: snapshot.issue.title,
    };
  }
  if (snapshot.current_session_target_kind) {
    return {
      tone: 'connected',
      label: snapshot.current_session_label,
    };
  }
  return {
    tone: 'disconnected',
    label: 'No environment open',
  };
}

export function buildDesktopWelcomeShellViewModel(
  snapshot: DesktopWelcomeSnapshot,
  visibleSurface: DesktopLauncherSurface = snapshot.surface,
): DesktopWelcomeShellViewModel {
  return {
    shell_title: 'Redeven Desktop',
    surface_title: surfaceTitle(visibleSurface),
    connect_heading: 'Connect Environment',
    primary_action_label: 'Open This Device',
    settings_save_label: snapshot.settings_surface.save_label,
  };
}
