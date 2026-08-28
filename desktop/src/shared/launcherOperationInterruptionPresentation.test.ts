import { describe, expect, it } from "vitest";

import { createDesktopI18n } from "./i18n/desktopI18n";
import { launcherOperationInterruptionPresentation } from "./launcherOperationInterruptionPresentation";

describe("launcherOperationInterruptionPresentation", () => {
  it.each([
    {
      action: "open_ssh_environment" as const,
      labelKey: "progress.interruptStopOpening",
      detailKey: "progress.interruptStopOpeningDetail",
      cancelingTitleKey: "progress.titleStoppingOpen",
      cancelingDetailKey: "progress.detailStoppingOpen",
      cancelingPhase: "open_connection_canceling" as const,
    },
    {
      action: "start_environment_runtime" as const,
      labelKey: "progress.interruptStopStartup",
      detailKey: "progress.interruptStopStartupDetail",
      cancelingTitleKey: "progress.titleStoppingRuntimeStartup",
      cancelingDetailKey: "progress.detailStoppingRuntimeStartup",
      cancelingPhase: "runtime_lifecycle_canceling" as const,
    },
    {
      action: "update_environment_runtime" as const,
      labelKey: "progress.interruptCancelRuntimeUpdate",
      detailKey: "progress.interruptCancelRuntimeUpdateDetail",
      cancelingTitleKey: "progress.titleStoppingRuntimeUpdate",
      cancelingDetailKey: "progress.detailStoppingRuntimeUpdate",
      cancelingPhase: "runtime_lifecycle_canceling" as const,
    },
    {
      action: "restart_environment_runtime" as const,
      labelKey: "progress.interruptCancelRuntimeRestart",
      detailKey: "progress.interruptCancelRuntimeRestartDetail",
      cancelingTitleKey: "progress.titleStoppingRuntimeRestart",
      cancelingDetailKey: "progress.detailStoppingRuntimeRestart",
      cancelingPhase: "runtime_lifecycle_canceling" as const,
    },
    {
      action: "refresh_environment_runtime" as const,
      labelKey: "progress.cancelRuntimeOperation",
      detailKey: "progress.stopBackgroundTask",
      cancelingTitleKey: "progress.titleStoppingOperation",
      cancelingDetailKey: "progress.stopBackgroundTask",
      cancelingPhase: "canceling" as const,
    },
  ])(
    "uses one interruption presentation for $action",
    ({ action, ...presentation }) => {
      expect(launcherOperationInterruptionPresentation(action)).toEqual(
        presentation,
      );
    },
  );

  it("preserves the Gateway-specific interruption presentation", () => {
    expect(launcherOperationInterruptionPresentation("update_gateway")).toEqual(
      expect.objectContaining({
        labelKey: "progress.interruptStopGatewayAction",
        detailKey: "progress.interruptStopGatewayActionDetail",
      }),
    );
  });

  it("renders concise Simplified Chinese labels for update and restart", () => {
    const i18n = createDesktopI18n("zh-CN");

    expect(
      i18n.t(
        launcherOperationInterruptionPresentation("update_environment_runtime")
          .labelKey,
      ),
    ).toBe("取消更新");
    expect(
      i18n.t(
        launcherOperationInterruptionPresentation("restart_environment_runtime")
          .labelKey,
      ),
    ).toBe("取消重启");
    expect(
      i18n.t(
        launcherOperationInterruptionPresentation("start_environment_runtime")
          .labelKey,
      ),
    ).toBe("停止启动");
    expect(
      i18n.t(
        launcherOperationInterruptionPresentation("open_ssh_environment")
          .labelKey,
      ),
    ).toBe("停止打开");
  });
});
