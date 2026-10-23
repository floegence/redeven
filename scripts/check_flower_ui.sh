#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)
ROOT_DIR=$(cd -- "$SCRIPT_DIR/.." &> /dev/null && pwd)

source "$SCRIPT_DIR/ui_package_common.sh"

# Node 26 exposes an experimental global localStorage getter that throws when
# no backing file is configured. Give the gate an isolated temporary backing
# file so Node's storage API remains available without requiring hidden caller
# configuration, while preserving caller-provided Node options.
flower_localstorage_file=""
case " ${NODE_OPTIONS:-} " in
  *" --localstorage-file="*|*" --localstorage-file "*) ;;
  *)
    flower_localstorage_file=$(mktemp "${TMPDIR:-/tmp}/redeven-flower-localstorage.XXXXXX")
    trap 'rm -f -- "$flower_localstorage_file" "$flower_localstorage_file-wal" "$flower_localstorage_file-shm"' EXIT HUP INT TERM
    export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--localstorage-file=$flower_localstorage_file"
    ;;
esac

skip_browser=false
if [ "${1:-}" = "--skip-browser" ]; then
  skip_browser=true
  shift
fi
if [ "$#" -ne 0 ]; then
  echo "usage: ./scripts/check_flower_ui.sh [--skip-browser]" >&2
  exit 2
fi

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
    # EnvAppShell's integration fixtures intentionally share one module-level
    # Solid/Vitest harness; running files in parallel races those reset hooks.
    ui_pkg_run_pnpm exec vitest run --environment=node --maxWorkers=1 --testTimeout=10000 \
      src/ui/EnvAppShell.desktopFloatingSurfaces.e2e.test.tsx \
      src/ui/EnvAppShell.flowerSingleSurface.test.ts \
      src/ui/EnvAppShell.localAccess.e2e.test.tsx \
      src/ui/i18n/i18n.test.ts \
      src/ui/activityFlowerCompletionNotice.test.ts \
      src/ui/activityFlowerSummary.test.ts \
      src/ui/FlowerSurface.emptyStatePresentation.test.tsx \
      src/ui/FlowerSurface.uncertainRecovery.test.tsx \
      src/ui/FlowerSurface.navigation.test.tsx \
      src/ui/FlowerSurface.liveRecovery.test.tsx \
      src/ui/FlowerComposerContextIndicator.test.tsx \
      src/ui/FlowerContextCompactionDivider.test.tsx \
      src/ui/FlowerContextAccounting.test.ts \
      src/ui/FlowerSurface.settingsLifecycle.test.tsx \
      src/ui/FlowerSurface.providerReadiness.test.tsx \
      src/ui/FlowerSurface.modelMenu.test.tsx \
      src/ui/FlowerSurface.approvalMode.test.tsx \
      src/ui/modelMenu.test.ts \
      src/ui/FlowerSurface.directoryActions.test.tsx \
      src/ui/FlowerSurface.directoryPicker.test.tsx \
      src/ui/FlowerSurface.parentEventRecovery.test.tsx \
      src/ui/FlowerSurface.fork.test.tsx \
      src/ui/FlowerSurface.title.test.tsx \
      src/ui/FlowerSurface.orderedPresentation.test.tsx \
      src/ui/FlowerSurface.webSearch.test.tsx \
      src/ui/FlowerSurface.composerReferences.test.tsx \
      src/ui/FlowerSurface.inputHistory.test.tsx \
      src/ui/FlowerSurface.desktopModelSource.e2e.test.tsx \
      src/ui/FlowerSurface.visibility.shared.test.tsx \
      src/ui/FlowerThreadSwitcher.shared.test.tsx \
      src/ui/FlowerThreadCard.performance.test.tsx \
      src/ui/FlowerModelStatusIndicator.test.tsx \
      src/ui/FlowerProgressIndicator.test.tsx \
      src/ui/FlowerThreadList.delete.test.tsx \
      src/ui/FlowerSurface.navigation.structuredInput.test.tsx \
      src/ui/FlowerSurface.canonicalReferences.test.tsx \
      src/ui/flower/FlowerChatContextChips.test.tsx \
      src/ui/flower/FlowerAttachmentLane.test.tsx \
      src/ui/FlowerSurface.attachmentCapability.test.tsx \
      src/ui/FlowerToolIcon.test.tsx \
      src/ui/FlowerActivityPreview.test.tsx \
      src/ui/flower/AIReadinessBoundary.test.tsx \
      src/ui/flower/aiReadiness.test.ts \
      src/ui/flower/aiReadinessPresentation.test.ts \
      src/ui/flower/activityDisclosure.test.ts \
      src/ui/flower/flowerScrollInteraction.test.ts \
      src/ui/flower/SubagentDetailWindow.test.tsx \
      src/ui/flower/FlowerThinkingDisclosure.test.tsx \
      src/ui/flower/envLocalFlowerSurfaceAdapter.test.ts \
      src/ui/pages/settings/modelSelection.test.ts \
      src/ui/pages/settings/FlowerProviderDialog.test.tsx \
      src/ui/pages/settings/AIProviderDialog.test.tsx \
      src/ui/pages/settings/aiCatalog.test.ts \
      src/ui/flower/linkedContextNavigation.test.ts \
      src/ui/flower/workingDirectoryNavigation.test.ts \
      src/ui/plugins/ActivityPluginSurfaceWindow.test.tsx \
      src/ui/plugins/ExternalPluginInstallDialog.test.tsx \
      src/ui/plugins/PluginCenterView.test.tsx \
      src/ui/plugins/PluginConfirmationQueue.test.tsx \
      src/ui/plugins/PluginPanel.test.tsx \
      src/ui/plugins/PluginSurfaceFrame.test.tsx \
      src/ui/plugins/pluginPlatform.test.ts \
      src/ui/plugins/pluginPresentation.test.ts \
      src/ui/workbench/redevenWorkbenchWidgets.test.tsx \
      src/ui/widgets/FlowerTurnLauncherWindow.test.tsx \
      src/ui/pages/EnvAIPage.send.e2e.test.tsx \
      src/ui/chat/blocks/ShellBlock.test.tsx \
      src/ui/chat/message-list/VirtualMessageList.test.tsx

    ui_pkg_log ""
    ui_pkg_log "Flower UI: shared timeline projection contracts..."
    ui_pkg_run_pnpm exec vitest run --root "$ROOT_DIR" --config "$dir/vite.config.ts" --environment=node --maxWorkers=2 --testTimeout=10000 \
      internal/flower_ui/src/requestDeadline.test.ts \
      internal/flower_ui/src/historyBodyLoader.test.ts \
      internal/flower_ui/src/conversationPreferences.test.ts \
      internal/flower_ui/src/providerRequestProgress.test.ts \
      internal/flower_ui/src/flowerToolMotion.test.ts \
      internal/flower_ui/src/webSearchCapability.test.ts \
      internal/flower_ui/src/threadCache.test.ts \
      internal/flower_ui/src/threadReadSync.test.ts \
      internal/flower_ui/src/threadTitleSnapshot.test.ts \
      internal/flower_ui/src/flowerThreadTitle.test.ts \
      internal/flower_ui/src/transportOutbox.test.ts \
      internal/flower_ui/src/parentEventPage.test.ts \
      internal/flower_ui/src/runtimeCurrentView.test.ts \
      internal/flower_ui/src/runtimeCurrentView.stability.test.ts \
      internal/flower_ui/src/flowerDecisionCurrent.test.ts \
      internal/flower_ui/src/flowerLiveFrameQueue.test.ts \
      internal/flower_ui/src/liveTransport.test.ts \
      internal/flower_ui/src/inputResponse.test.ts \
      internal/flower_ui/src/flowerApprovalPresentation.test.ts \
      internal/flower_ui/src/flowerSurfaceModel.test.ts \
      internal/flower_ui/src/approvalAction.test.ts \
      internal/flower_ui/src/attachments/flowerAttachmentModel.test.ts \
      internal/flower_ui/src/attachments/createFlowerAttachmentController.client.test.ts \
      internal/flower_ui/src/composer/createFlowerComposerDraftCoordinator.test.ts \
      internal/flower_ui/src/composer/createFlowerComposerAutosizeController.test.ts \
      internal/flower_ui/src/composer/flowerComposerReferenceToken.test.ts \
      internal/flower_ui/src/composer/flowerInputHistory.test.ts \
      internal/flower_ui/src/composer/flowerComposerReferenceIndex.test.ts \
      internal/flower_host_ui/src/flowerAttachmentStaging.test.ts \
      internal/flower_ui/src/contextActionWire.test.ts \
      internal/flower_ui/src/flowerActivityPresentation.test.ts \
      internal/flower_ui/src/flowerSubagentDetailThread.test.ts \
      internal/flower_ui/src/flowerSubagentProjection.test.ts \
      internal/flower_ui/src/flowerThreadListRefresh.test.ts \
      internal/flower_ui/src/flowerThreadTitle.test.ts \
      internal/flower_ui/src/flowerCompanionPresence.test.ts \
      internal/flower_ui/src/flowerCompanionLiveTail.test.ts \
      internal/flower_ui/src/flowerCompanionRunTracker.test.ts \
      internal/flower_ui/src/flowerCompanionTailMotion.test.ts \
      internal/flower_ui/src/flowerScrollTail.test.ts \
      internal/flower_ui/src/flowerTurnPresentation.test.ts \
      internal/flower_ui/src/flowerTurnDisclosure.test.ts \
      internal/flower_ui/src/subagentAvatarCatalog.test.ts \
      internal/flower_ui/src/flowerPendingTurns.test.ts \
      internal/flower_ui/src/flowerTerminalOutput.test.ts \
      internal/flower_ui/src/FlowerSurface.references.test.ts \
      internal/flower_ui/src/FlowerSurface.warmup.test.ts \
      internal/flower_ui/src/runtimeFlowerSurfaceAdapter.test.ts \
      internal/flower_ui/src/filePicker/filesystemPicker.test.ts \
      internal/flower_ui/src/threads/FlowerThreadList.test.ts \
      internal/flower_ui/src/flowerTimelineProjection.test.ts \
      internal/flower_ui/src/flowerLiveMapper.test.ts \
      internal/flower_ui/src/chat/flowerContextPresentation.test.ts \
      internal/flower_ui/src/chat/flowerChatContextModel.test.ts \
      internal/flower_ui/src/chat/markdown/streamingMarkdownModel.test.ts \
      internal/flower_ui/src/chat/markdown/markedConfig.test.ts \
      internal/flower_ui/src/chat/markdown/flowerCitations.test.ts \
      internal/flower_ui/src/chat/markdown/flowerSourceCards.test.ts \
      internal/flower_ui/src/FlowerSurface.activityRunningSheen.test.ts \
      internal/flower_ui/src/FlowerSurface.approvalCommand.test.ts \
      internal/flower_ui/src/FlowerSurface.modelStatusIndicator.test.ts \
      internal/flower_ui/src/FlowerSurface.markdownRendering.test.ts \
      internal/flower_ui/src/FlowerSurface.markdownReadability.test.ts \
      internal/flower_ui/src/FlowerSurface.terminalConvergence.test.ts \
      internal/flower_ui/src/shellCommandHighlight.test.ts

    (
      cd "$ROOT_DIR/internal/flower_host_ui"
      NODE_PATH="$dir/node_modules" "$dir/node_modules/.bin/eslint" \
        -c eslint.config.mjs "src/**/*.{ts,tsx}" --max-warnings=0
    )

    if [ "$skip_browser" = false ]; then
      ui_pkg_log ""
      ui_pkg_log "Flower UI: Chromium interaction contracts..."
      (cd "$ROOT_DIR" && REDEVEN_FORK_PARENT_EVENTS_UI=1 GOWORK=off go test ./internal/ai -run '^TestFlowerForkParentEventsUI$' -count=1)
      # Restart Chromium between bounded groups so large suites do not retain
      # every transformed module and mock graph in one browser process.
      local browser_tests=(
        src/ui/FlowerContextCompactionDivider.browser.test.tsx
        src/ui/EnvAppShell.flowerCompanion.browser.test.tsx
        src/ui/flowerCompanionTailMotion.browser.test.tsx
        src/ui/FlowerSurface.toolPresentation.browser.test.tsx
        src/ui/FlowerSurface.finalArchitecture.browser.test.tsx
        src/ui/FlowerSurface.streamingStability.browser.test.tsx
        src/ui/FlowerSurface.liveRecovery.browser.test.tsx
        src/ui/FlowerSurface.goal.browser.test.tsx
        src/ui/FlowerSurface.turnProcess.browser.test.tsx
        src/ui/FlowerSurface.thinkingDisclosure.browser.test.tsx
        src/ui/FlowerMarkdown.streamingStability.browser.test.tsx
        src/ui/FlowerMarkdown.readingThemes.browser.test.tsx
        src/ui/FlowerMarkdown.citations.browser.test.tsx
        src/ui/FlowerMarkdown.tables.browser.test.tsx
        src/ui/FlowerMarkdown.emphasis.browser.test.tsx
        src/ui/FlowerMarkdown.highlight.browser.test.tsx
        src/ui/FlowerStatusAndThreadMenu.browser.test.tsx
        src/ui/FlowerCompactPresentation.browser.test.tsx
        src/ui/FlowerDirectoryMenus.browser.test.tsx
        src/ui/FlowerWorkingDirectory.browser.test.tsx
        src/ui/FlowerSurface.directoryPicker.browser.test.tsx
        src/ui/FlowerSurface.fork.browser.test.tsx
        src/ui/FlowerSurface.canonicalReferences.browser.test.tsx
        src/ui/FlowerSurface.composerAttachments.browser.test.tsx
        src/ui/FlowerSurface.composerReferences.browser.test.tsx
        src/ui/FlowerSurface.threadReferences.browser.test.tsx
        src/ui/FlowerSurface.inputHistory.browser.test.tsx
        src/ui/FlowerSurface.companionEntry.browser.test.tsx
        src/ui/FlowerSurface.decisionSurface.browser.test.tsx
        src/ui/FlowerSurface.inputSubmission.browser.test.tsx
        src/ui/FlowerSurface.inputResponse.browser.test.tsx
        src/ui/FlowerSurface.queuedSendNow.browser.test.tsx
        src/ui/FlowerSurface.setupGuide.browser.test.tsx
        src/ui/FlowerSurface.providerReadiness.browser.test.tsx
        src/ui/FlowerSurface.providerRetry.browser.test.tsx
        src/ui/FlowerSurface.providerRecovery.browser.test.tsx
        src/ui/FlowerSurface.modelMenu.browser.test.tsx
        src/ui/FlowerProviderDialog.selection.browser.test.tsx
        src/ui/FlowerProviderDialog.continuation.browser.test.tsx
        src/ui/FlowerSurface.settingsLifecycle.browser.test.tsx
        src/ui/FlowerSurface.conversationPreferences.browser.test.tsx
        src/ui/pages/EnvAIPage.send.browser.test.tsx
        src/ui/FlowerSurface.settings.browser.test.tsx
        src/ui/FlowerSettingsSurface.presentation.browser.test.tsx
        src/ui/FlowerSurface.subagentDisclosure.browser.test.tsx
        src/ui/FlowerSurface.activityTiming.browser.test.tsx
        src/ui/FlowerSurface.subagentAppearance.browser.test.tsx
        src/ui/FlowerSurface.parentEvents.browser.test.tsx
        src/ui/FlowerSurface.subagentHeader.browser.test.tsx
        src/ui/FlowerSurface.reasoningSelection.browser.test.tsx
        src/ui/FlowerSurface.terminalActivity.browser.test.tsx
        src/ui/FlowerSurface.toolFailures.browser.test.tsx
        src/ui/FlowerSurface.webSearch.browser.test.tsx
        src/ui/flower/WebSearchActivity.browser.test.tsx
        src/ui/FlowerSurface.disclosureInteraction.browser.test.tsx
        src/ui/widgets/FlowerTurnLauncherWindow.browser.test.tsx
        src/ui/widgets/TerminalSessionRuntime.semantic.browser.test.tsx
        src/ui/plugins/PluginManagement.browser.test.tsx
        src/ui/flower/AIReadinessBoundary.browser.test.tsx
        src/ui/pages/settings/FlowerStorageSettings.browser.test.tsx
        src/ui/FlowerSurface.storageRecovery.browser.test.tsx
        src/ui/flower/SubagentDetailWindow.boundary.browser.test.tsx
      )
      local browser_offset
      for ((browser_offset = 0; browser_offset < ${#browser_tests[@]}; browser_offset += 12)); do
        ui_pkg_run_pnpm run test:browser -- "${browser_tests[@]:browser_offset:12}"
      done
    fi
  )

  ui_pkg_log "Flower UI behavior checks passed."
}

main "$@"
