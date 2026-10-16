// IMPORTANT: Keep interaction continuity executable at commit and integration boundaries.
export const continuityTests = Object.freeze({
  state: [
    'src/shared/i18n/desktopI18n.test.ts',
    'src/welcome/viewModel.test.ts',
    'src/welcome/desktopOverlayPosition.test.ts',
    'src/welcome/environmentLifecycleDisclosure.test.ts',
    'src/welcome/environmentGuidanceSession.test.ts',
    'src/welcome/environmentLibraryOverlayState.test.ts',
    'src/welcome/environmentSettingsSession.test.ts',
    'src/welcome/gatewaySourceOverlayState.test.ts',
  ],
  client: [
    'src/welcome/EnvironmentRelation.client.test.tsx',
    'src/welcome/DesktopActionPopover.client.test.tsx',
    'src/welcome/RuntimeCloudConnections.client.test.tsx',
    'src/welcome/RuntimeGatewayJoinPanel.client.test.tsx',
    'src/welcome/RuntimeGatewayConnectionsDialog.client.test.tsx',
    'src/welcome/RuntimeGatewaySetupDialog.client.test.tsx',
    'src/welcome/EnvironmentSettingsEntry.client.test.tsx',
    'src/welcome/EnvironmentSettingsDialog.accessibility.client.test.tsx',
    'src/welcome/EnvironmentAccessSettingsForm.client.test.tsx',
    'src/welcome/TwoFactorSettings.client.test.tsx',
    'src/welcome/LocalCertificateSettings.client.test.tsx',
    'src/welcome/GatewaySetup.client.test.tsx',
    'src/welcome/GatewayMembersDialog.client.test.tsx',
    'src/welcome/GatewayClientsPanel.client.test.tsx',
    'src/welcome/GatewayCloudPanel.client.test.tsx',
  ],
});
export function continuityAffected(path) {
  return /^(desktop\/|internal\/flower_ui\/|scripts\/(?:interaction_continuity|check_interaction_continuity|local_gate|check_final_integration|check_desktop|check_quick_ci|quick_ci_policy)|\.githooks\/|\.github\/workflows\/interaction-continuity)/u.test(path);
}

export const continuityLocales = Object.freeze(['en-US', 'zh-CN', 'zh-TW', 'de-DE', 'es-ES', 'fr-FR', 'ja-JP', 'ko-KR', 'pt-BR', 'ru-RU']);
export const continuityViewports = Object.freeze([{ width: 1280, height: 740 }, { width: 430, height: 740 }, { width: 430, height: 520 }]);
export const continuityBrowserContracts = Object.freeze(['pointer-refresh', 'admission-retry', 'late-response', 'composition-selection', 'removed-owner-exit', 'settings-draft-scroll', 'nested-layer', 'inert-exit-reversal', 'short-window-recovery']);
export function assertContinuityBrowserCoverage(report) {
  if (report.status !== 'passed' || report.errors.length) throw new Error('Browser continuity failed');
  const expected = continuityLocales.flatMap(locale => continuityViewports.map(viewport => locale + '/' + viewport.width + 'x' + viewport.height));
  if (report.cases.length !== expected.length || new Set(report.cases.map(item => item.id)).size !== expected.length) throw new Error('Missing or duplicate browser cases');
  for (const id of expected) {
    const item = report.cases.find(item => item.id === id);
    if (!item || continuityBrowserContracts.some(contract => !item.contracts.includes(contract))) throw new Error('Missing browser continuity contract: ' + id);
  }
}
