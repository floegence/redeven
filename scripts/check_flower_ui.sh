#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

source "$SCRIPT_DIR/ui_package_common.sh"

main() {
  local dir="$ROOT_DIR/internal/envapp/ui_src"
  if [ ! -d "$dir" ]; then
    ui_pkg_log "Flower UI: skipped (missing: $dir)"
    return 0
  fi

  ui_pkg_log "Checking Flower UI behavior contracts..."
  ui_pkg_log "ROOT_DIR: $ROOT_DIR"

  (
    cd "$dir"
    if ui_pkg_need_install "$dir"; then
      ui_pkg_run_pnpm install --frozen-lockfile
    fi
    ui_pkg_log ""
    ui_pkg_log "Flower UI: Env App interaction contracts..."
    ui_pkg_run_pnpm exec vitest run --environment=node --maxWorkers=2 --testTimeout=10000 \
      src/ui/FlowerSurface.navigation.context.test.tsx \
      src/ui/FlowerSurface.navigation.activity.test.tsx \
      src/ui/FlowerSurface.navigation.launchSend.test.tsx \
      src/ui/FlowerSurface.desktopModelSource.e2e.test.tsx \
      src/ui/FlowerSurface.navigation.threads.test.tsx \
      src/ui/FlowerSurface.navigation.structuredInput.test.tsx \
      src/ui/flower/FlowerChatContextChips.test.tsx \
      src/ui/flower/activityDisclosure.test.ts \
      src/ui/flower/SubagentDetailWindow.test.tsx \
      src/ui/flower/envLocalFlowerSurfaceAdapter.test.ts \
      src/ui/flower/linkedContextNavigation.test.ts \
      src/ui/chat/blocks/ActivityTimelineBlock.test.tsx \
      src/ui/chat/blocks/ShellBlock.test.tsx

    ui_pkg_log ""
    ui_pkg_log "Flower UI: shared timeline projection contracts..."
    ui_pkg_run_pnpm exec vitest run --root "$ROOT_DIR" --config "$dir/vite.config.ts" --environment=node --maxWorkers=2 --testTimeout=10000 \
      internal/flower_ui/src/flowerLiveProjection.test.ts \
      internal/flower_ui/src/flowerActivityPresentation.test.ts \
      internal/flower_ui/src/flowerSubagentDetailThread.test.ts \
      internal/flower_ui/src/flowerSubagentProjection.test.ts \
      internal/flower_ui/src/flowerThreadListRefresh.test.ts \
      internal/flower_ui/src/flowerPendingTurns.test.ts \
      internal/flower_ui/src/runtimeFlowerSurfaceAdapter.test.ts \
      internal/flower_ui/src/filePicker/directoryPickerTree.test.ts \
      internal/flower_ui/src/filePicker/createDirectoryPickerDataSource.test.ts \
      internal/flower_ui/src/threads/FlowerThreadList.test.ts \
      internal/flower_ui/src/flowerTimelineProjection.test.ts \
      internal/flower_ui/src/chat/flowerContextPresentation.test.ts \
      internal/flower_ui/src/chat/flowerChatContextModel.test.ts \
      internal/flower_ui/src/chat/markdown/streamingMarkdownModel.test.ts \
      internal/flower_ui/src/FlowerSurface.activityRunningSheen.test.ts \
      internal/flower_ui/src/FlowerSurface.approvalCommand.test.ts \
      internal/flower_ui/src/FlowerSurface.workingDirectory.test.ts \
      internal/flower_ui/src/FlowerSurface.modelStatusIndicator.test.ts \
      internal/flower_ui/src/FlowerSurface.markdownRendering.test.ts \
      internal/flower_ui/src/FlowerSurface.markdownReadability.test.ts \
      internal/flower_ui/src/shellCommandHighlight.test.ts

    ui_pkg_log ""
    ui_pkg_log "Flower UI: Chromium approval refresh contract..."
    ui_pkg_run_pnpm run test:browser -- \
      src/ui/FlowerSurface.approvalRefresh.browser.test.tsx \
      src/ui/FlowerSurface.activityDisclosure.browser.test.tsx \
      src/ui/flower/SubagentDetailWindow.boundary.browser.test.tsx
  )

  ui_pkg_log "Flower UI behavior checks passed."
}

main "$@"
