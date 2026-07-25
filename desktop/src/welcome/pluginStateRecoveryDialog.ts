import type {
  DesktopLauncherActionFailure,
  DesktopPluginStateRecoveryProposal,
} from '../shared/desktopLauncherIPC';

export type PluginStateRecoveryDialogState = Readonly<{
  proposal: DesktopPluginStateRecoveryProposal;
  error: string;
}>;

export function pluginStateRecoveryDialogAfterFailure(
  current: PluginStateRecoveryDialogState,
  failure: DesktopLauncherActionFailure,
  fallbackMessage: string,
): PluginStateRecoveryDialogState {
  if (failure.code === 'plugin_state_recovery_required' && failure.plugin_state_recovery) {
    return {
      proposal: failure.plugin_state_recovery,
      error: failure.message,
    };
  }
  return {
    ...current,
    error: failure.message || fallbackMessage,
  };
}
