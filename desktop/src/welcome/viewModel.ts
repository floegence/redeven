import type { DesktopLauncherSurface, DesktopWelcomeSnapshot } from '../shared/desktopLauncherIPC';

export type DesktopWelcomeShellViewModel = Readonly<{
  shell_title: 'Redeven Desktop';
  surface_title: string;
  chooser_heading: 'Open a Redeven machine';
  utility_labels: readonly ['Switch Machine', 'Settings'];
  primary_action_label: 'Open This Device';
  settings_save_label: string | null;
}>;

export function capabilityUnavailableMessage(label: string): string {
  return `Choose a machine first to open ${label}.`;
}

export function surfaceTitle(surface: DesktopLauncherSurface): string {
  return surface === 'this_device_settings' ? 'This Device settings' : 'Choose a machine';
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
    label: 'No machine open',
  };
}

export function buildDesktopWelcomeShellViewModel(
  snapshot: DesktopWelcomeSnapshot,
  visibleSurface: DesktopLauncherSurface = snapshot.surface,
): DesktopWelcomeShellViewModel {
  return {
    shell_title: 'Redeven Desktop',
    surface_title: surfaceTitle(visibleSurface),
    chooser_heading: 'Open a Redeven machine',
    utility_labels: ['Switch Machine', 'Settings'],
    primary_action_label: 'Open This Device',
    settings_save_label: snapshot.settings_surface?.save_label ?? null,
  };
}
