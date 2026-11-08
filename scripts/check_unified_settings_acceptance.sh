#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
: "${REDEVEN_VITEST_BROWSER_PORT:?Select an isolated task-owned browser port}"
cd "$ROOT_DIR"
node scripts/check_unified_settings.mjs
cd internal/envapp/ui_src
npx vitest run --environment=node --maxWorkers=2 src/ui/pages/settings/unifiedSettingsContract.test.ts src/ui/pages/settings/FlowerSettingsPanel.test.tsx src/ui/pages/EnvSettingsPage.test.tsx src/ui/pages/EnvPortForwardsPage.test.tsx src/ui/pages/EnvHostApplicationsPage.test.tsx src/ui/EnvAppShell.localAccess.e2e.test.tsx src/ui/MobileShellTools.test.tsx src/ui/plugins/PluginCenterView.test.tsx src/ui/i18n/i18n.test.ts
npm run test:browser -- src/ui/pages/settings/EnvSettingsDialog.browser.test.tsx src/ui/pages/settings/UnifiedSettings.browser.test.tsx src/ui/pages/ManagedServiceSettingsDesign.browser.test.tsx src/ui/pages/settings/CodeRuntimeSettingsCard.browser.test.tsx src/ui/FlowerComputerConnections.browser.test.tsx src/ui/flower/FlowerExtensions.browser.test.tsx src/ui/widgets/TerminalSettingsDialog.browser.test.tsx src/ui/widgets/TerminalHistorySettings.browser.test.tsx src/ui/plugins/PluginConnectionsDialog.browser.test.tsx
cd "$ROOT_DIR/desktop"
npx vitest run --maxWorkers=2 src/main/runtimeSettingsTarget.test.ts src/main/mainRouting.test.ts src/welcome/environmentSettingsSession.test.ts src/welcome/App.test.tsx ../internal/flower_ui/src/browserInstallationController.test.ts
npx vitest run --config vitest.client.config.mts --maxWorkers=2 src/welcome/DesktopSettingsDialog.client.test.tsx src/welcome/EnvironmentSettingsEntry.client.test.tsx src/welcome/flower/localEnvironmentFlowerSurfaceAdapter.client.test.tsx src/welcome/DesktopThemePicker.client.test.tsx
