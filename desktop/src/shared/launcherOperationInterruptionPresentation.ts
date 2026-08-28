import type { DesktopLauncherActionKind } from "./desktopLauncherIPC";
import type { DesktopTranslationKey } from "./i18n/desktopI18n";

export type LauncherOperationInterruptionPresentation = Readonly<{
  labelKey: DesktopTranslationKey;
  detailKey: DesktopTranslationKey;
  cancelingTitleKey: DesktopTranslationKey;
  cancelingDetailKey: DesktopTranslationKey;
  cancelingPhase:
    | "open_connection_canceling"
    | "runtime_lifecycle_canceling"
    | "canceling";
}>;

const OPEN_INTERRUPTION_PRESENTATION: LauncherOperationInterruptionPresentation =
  {
    labelKey: "progress.interruptStopOpening",
    detailKey: "progress.interruptStopOpeningDetail",
    cancelingTitleKey: "progress.titleStoppingOpen",
    cancelingDetailKey: "progress.detailStoppingOpen",
    cancelingPhase: "open_connection_canceling",
  };

const START_INTERRUPTION_PRESENTATION: LauncherOperationInterruptionPresentation =
  {
    labelKey: "progress.interruptStopStartup",
    detailKey: "progress.interruptStopStartupDetail",
    cancelingTitleKey: "progress.titleStoppingRuntimeStartup",
    cancelingDetailKey: "progress.detailStoppingRuntimeStartup",
    cancelingPhase: "runtime_lifecycle_canceling",
  };

const UPDATE_INTERRUPTION_PRESENTATION: LauncherOperationInterruptionPresentation =
  {
    labelKey: "progress.interruptCancelRuntimeUpdate",
    detailKey: "progress.interruptCancelRuntimeUpdateDetail",
    cancelingTitleKey: "progress.titleStoppingRuntimeUpdate",
    cancelingDetailKey: "progress.detailStoppingRuntimeUpdate",
    cancelingPhase: "runtime_lifecycle_canceling",
  };

const RESTART_INTERRUPTION_PRESENTATION: LauncherOperationInterruptionPresentation =
  {
    labelKey: "progress.interruptCancelRuntimeRestart",
    detailKey: "progress.interruptCancelRuntimeRestartDetail",
    cancelingTitleKey: "progress.titleStoppingRuntimeRestart",
    cancelingDetailKey: "progress.detailStoppingRuntimeRestart",
    cancelingPhase: "runtime_lifecycle_canceling",
  };

const GATEWAY_INTERRUPTION_PRESENTATION: LauncherOperationInterruptionPresentation =
  {
    labelKey: "progress.interruptStopGatewayAction",
    detailKey: "progress.interruptStopGatewayActionDetail",
    cancelingTitleKey: "progress.titleStoppingOperation",
    cancelingDetailKey: "progress.stopBackgroundTask",
    cancelingPhase: "canceling",
  };

const GENERIC_INTERRUPTION_PRESENTATION: LauncherOperationInterruptionPresentation =
  {
    labelKey: "progress.cancelRuntimeOperation",
    detailKey: "progress.stopBackgroundTask",
    cancelingTitleKey: "progress.titleStoppingOperation",
    cancelingDetailKey: "progress.stopBackgroundTask",
    cancelingPhase: "canceling",
  };

export function launcherOperationInterruptionPresentation(
  action: DesktopLauncherActionKind,
): LauncherOperationInterruptionPresentation {
  switch (action) {
    case "open_local_environment":
    case "open_provider_environment":
    case "open_gateway_environment":
    case "open_remote_environment":
    case "open_ssh_environment":
    case "prepare_environment_open":
      return OPEN_INTERRUPTION_PRESENTATION;
    case "start_environment_runtime":
      return START_INTERRUPTION_PRESENTATION;
    case "update_environment_runtime":
      return UPDATE_INTERRUPTION_PRESENTATION;
    case "restart_environment_runtime":
      return RESTART_INTERRUPTION_PRESENTATION;
    case "upsert_gateway":
    case "set_gateway_enabled":
    case "refresh_gateway":
    case "check_gateway":
    case "sync_gateway":
    case "pair_gateway":
    case "start_gateway":
    case "stop_gateway":
    case "restart_gateway":
    case "update_gateway":
    case "refresh_gateway_catalog":
    case "refresh_gateway_status":
    case "delete_gateway":
      return GATEWAY_INTERRUPTION_PRESENTATION;
    default:
      return GENERIC_INTERRUPTION_PRESENTATION;
  }
}
