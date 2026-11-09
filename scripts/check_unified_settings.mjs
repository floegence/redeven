import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
// IMPORTANT: Protect product ownership without implementing Floe modal mechanics.
// Browser qualification owns focus, geometry, drafts and late-result behavior.
const shell = read('internal/envapp/ui_src/src/ui/EnvAppShell.tsx');
const open = shell.slice(shell.indexOf('const openSettings ='), shell.indexOf('const openDebugConsole ='));
for (const forbidden of ['navigation.commit', 'setViewMode(', 'activateActivitySurface(', 'updatePluginPanel(', 'openSurface(']) assert.ok(!open.includes(forbidden), forbidden);
// IMPORTANT: Every shell Flower owner must stop read visibility under Settings.
const transcripts = [...shell.matchAll(/transcriptVisible=\{([^}]+)\}/g)];
assert.ok(transcripts.length > 0);
for (const [, expression] of transcripts) assert.ok(expression.includes('!settingsSession.present()'));
assert.match(shell, /workbenchPluginCenterBlocking = \(\) => settingsSession.present\(\) \|\| pluginCenterOpen\(\)/);
assert.match(shell, /visiblePluginWindows = createMemo\(\(\) => workbenchPluginCenterBlocking\(\) \? \[\]/);
const mobile = read('internal/envapp/ui_src/src/ui/MobileShellTools.tsx');
assert.doesNotMatch(mobile, /<EnvAppThemePicker|<LanguagePreferenceMenu/);
assert.match(mobile, /onClick: props.onSettings/);
const host = read('internal/settings_ui/src/SettingsDialog.tsx');
assert.match(host, /createRetainedContent/);
assert.match(host, /DialogPlacementProvider/);
assert.doesNotMatch(host, /document.addEventListener|keydown|focusTrap/);
const session = read('internal/settings_ui/src/settingsSession.ts');
// IMPORTANT: Floe owns restoration across successive overlays, including restart.
assert.doesNotMatch(session, /document\.activeElement|\.focus\(|restoreFocus/);
const flower = read('internal/envapp/ui_src/src/ui/pages/settings/sections/FlowerSection.tsx');
assert.match(flower, /<FlowerSettingsPanel/);
assert.doesNotMatch(flower, /<FlowerProviderDialog/);
assert.match(read('desktop/src/main/main.ts'), /resolveRunningSettingsTarget/);
assert.match(read('desktop/src/main/runtimeSettingsTarget.ts'), /expected !== target.record.startup.started_at_unix_ms/);
assert.match(read('desktop/src/main/runtimeSettingsTarget.ts'), /running\(request.environment_id\)/);
assert.match(read('desktop/src/welcome/App.tsx'), /browserTransferAvailable: \(\) => settingsTransferAvailable\(owner\)/);
assert.match(read('internal/envapp/ui_src/src/ui/widgets/TerminalHistorySettings.tsx'), /props.canManage !== false/);
assert.match(read('internal/envapp/ui_src/src/ui/pages/settings/sections/RuntimeConfigSection.tsx'), /presented\(\) && Boolean\(rootEditor\(\)\)/);
assert.match(read('internal/envapp/ui_src/src/ui/plugins/PluginCenterView.tsx'), /visible=\{props.visible\}/);
// IMPORTANT: This inventory enumerates product-owned durable configuration.
// Session actions and direct view shortcuts keep their established owner.
const settings = read('internal/envapp/ui_src/src/ui/pages/settings/EnvSettingsDialog.tsx');
assert.match(settings, /<SettingsDialog closeOnBackdropClick /);
assert.match(host, /closeOnBackdropClick=\{props.closeOnBackdropClick \?\? false\}/);
for (const panel of ['TerminalSettingsPanel', 'ContainerSettingsPanel', 'ConversationDefaultsSettings', 'BrowserDisplaySettings', 'AppearanceSettings', 'PluginSettingsPanel']) assert.match(settings, new RegExp('<' + panel + '[ >]'));
assert.match(read('internal/envapp/ui_src/src/ui/pages/settings/AppearanceSettings.tsx'), /<WorkbenchAppearanceSettings/);
const hostAccess = read('internal/envapp/ui_src/src/ui/pages/HostAccessControls.tsx');
assert.match(hostAccess, /<HostAccessManagement \{\.\.\.props\} compact/);
assert.match(hostAccess, /<SettingRow class="host-access-feature-row"/);
const picture = read('internal/envapp/ui_src/src/ui/pages/settings/ApplicationPictureSettings.tsx');
assert.doesNotMatch(picture, /common.actions.save|application-picture-save/);
assert.match(picture, /useSettingsPresentation\('applications'\)/);
assert.match(hostAccess, /open=\{presented\(\) && confirm\(\)\}/);
assert.match(hostAccess, /if \(!canManage\(\)\) return/);
const hostApplications = read('internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.tsx');
assert.match(hostApplications, /const canLaunch = \(\) => Boolean\(\(!props.settingsOnly \|\| presented\(\)\)/);
const authorization = read('internal/envapp/ui_src/src/ui/pages/settings/DesktopAuthorizationSettings.tsx');
assert.match(authorization, /useSettingsPresentation\('applications'\)/);
assert.match(authorization, /if \(!canChange\(\)\) return/);
// IMPORTANT: Category roots delegate closing to the host; domain refresh is scoped.
assert.match(settings, /<FlowerExtensionsSurface embedded/);
assert.doesNotMatch(settings, /onBack=\{\(\) => props\.session\.close/);
// IMPORTANT: Plugin management is an independent feature, not configuration.
// Only exact installed/author connection editors belong in Settings.
assert.match(shell, /<PluginPageViewport page="center"/);
assert.doesNotMatch(shell, /PluginCenterDrawer/);
const pluginCenterOpen = shell.slice(shell.indexOf('const openPluginCenter ='), shell.indexOf('const openPluginCenter =') + 1000);
assert.doesNotMatch(pluginCenterOpen, /openSettings\(['"]plugins/);
assert.doesNotMatch(settings, /PluginCenterView|renderPlugins|renderInstalled/);
assert.doesNotMatch(read('internal/envapp/ui_src/src/ui/plugins/PluginSettingsPanel.tsx'), /PluginCenterView|renderInstalled/);
const page = read('internal/envapp/ui_src/src/ui/pages/EnvSettingsPage.tsx');
assert.match(page, /role="alert" class="redeven-settings-read-error"/);
assert.match(page, /variant="outline" disabled=\{ctx.settings.loading\} onClick=\{\(\) => void ctx.refreshSettingsPage\(\)\}/);
assert.match(read('internal/envapp/ui_src/src/ui/pages/settings/SettingsPrimitives.tsx'), /host && props.variant === 'page' \? 'section' : props.variant/);
assert.match(read('internal/envapp/ui_src/src/ui/pages/settings/SettingsPrimitives.tsx'), /showHeading=\{!\(host && props.variant === 'page'\)\}/);
assert.match(read('internal/envapp/ui_src/src/ui/pages/settings/StorageSettings.tsx'), /<SettingsSection variant="page"/);
assert.doesNotMatch(read('internal/envapp/ui_src/src/ui/pages/settings/AppearanceSettings.tsx'), /settings.nav.appearance/);
for (const [file, fragment] of [
 ['internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx', "openSettings('terminal'"],
 ['internal/envapp/ui_src/src/ui/pages/EnvContainersPage.tsx', "openSettings('containers'"],
 ['internal/envapp/ui_src/src/ui/pages/RemoteDesktopPanel.tsx', "openSettings('applications'"],
 ['internal/envapp/ui_src/src/ui/pages/EnvHostApplicationsPage.tsx', '<ApplicationPictureSettings'],
 ['internal/envapp/ui_src/src/ui/plugins/PluginCreationWorkspace.tsx', 'pluginAuthorSettingsResource'],
]) assert.ok(read(file).includes(fragment), file + ': canonical settings route missing');
assert.doesNotMatch(read('internal/envapp/ui_src/src/ui/widgets/TerminalPanel.tsx'), /<TerminalSettingsDialog/);
assert.doesNotMatch(read('internal/envapp/ui_src/src/ui/pages/EnvContainersPage.tsx'), /setServiceConfigurationDrafts/);
for (const viewer of ['macos', 'linux', 'viewer']) assert.doesNotMatch(read('internal/codeapp/appserver/host_application_viewer/' + viewer + '.js'), /localStorage\.setItem/);
assert.match(read('internal/envapp/ui_src/src/ui/flower/envLocalFlowerSurfaceAdapter.ts'), /computerFrameRate: envComputerViewerFrameRate/);
assert.match(read('internal/envapp/ui_src/src/ui/workbench/EnvWorkbenchPage.tsx'), /subscribeWorkbenchLocalPreferences/);
const recovery = read('internal/envapp/ui_src/src/ui/pages/settings/ContainerSettingsPanel.tsx');
assert.match(recovery, /getContainerOperationByRequestID/); assert.doesNotMatch(recovery, /listContainerOperations/);
assert.match(recovery, /!selectedSourceDirty\(\) \|\| !canSave\(\)/);
assert.match(recovery, /!review\(\) && selectedSourceDirty\(\)/);
assert.match(read('internal/envapp/ui_src/src/ui/services/hostApplicationSettingsTarget.ts'), /event\.origin === owner\.origin/);

// IMPORTANT: A retained category cannot retain an actionable popup.
for (const file of ['AppearanceSettings', 'WorkbenchAppearanceSettings', 'BrowserDisplaySettings', 'ConversationDefaultsSettings', 'ContainerSettingsPanel', 'TerminalSettingsPanel']) {
  assert.match(read(`internal/envapp/ui_src/src/ui/pages/settings/${file}.tsx`), /SettingsSelect as Select/);
}
const selector = read('internal/settings_ui/src/SettingsSelect.tsx');
assert.match(selector, /open=\{presentedOpen\(\)\}/);
assert.match(selector, /onChange=\{value => \{ if \(admitted\(\)\)/);
for (const file of ['internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx', 'internal/envapp/ui_src/src/ui/plugins/PluginSettingsPanel.tsx', 'internal/envapp/ui_src/src/ui/pages/settings/sections/LoggingSection.tsx']) assert.match(read(file), /SettingsSelect as Select/);

// IMPORTANT: Both hosts use the published compact appearance view. Do not
// restore a page-local theme implementation or duplicate top-bar control.
for (const file of ['internal/envapp/ui_src/src/ui/EnvAppThemePicker.tsx', 'desktop/src/welcome/DesktopThemePicker.tsx']) {
  assert.match(read(file), /<ThemePicker /);
  assert.doesNotMatch(read(file), /TopBarIconButton|createFloatingPresence|DesktopAnchoredOverlaySurface|role="radio"/);
}
assert.doesNotMatch(shell, /<EnvAppThemePicker|<ThemeToggle/);
const welcome = read('desktop/src/welcome/DesktopSettingsDialog.tsx');
assert.doesNotMatch(welcome, /props\.flowerLabel|settings.languageTitle|onBack=\{props.session.close/);
assert.match(welcome, /header=\{/);
assert.match(welcome, /closeOnBackdropClick/);
assert.match(read('desktop/src/welcome/App.tsx'), /<SettingsSelect section="appearance"/);
console.log('Unified settings ownership contract passed.');

// IMPORTANT: Storage is a read-only overview; recovery and plugin lifecycle keep
// their own destinations, and ordinary row labels never acquire random indents.
const storage = read('internal/envapp/ui_src/src/ui/pages/settings/StorageSettings.tsx');
assert.doesNotMatch(storage, /AIReadinessSettingsSection|FlowerStorageSettings|method: ['"](?:POST|DELETE)['"]/);
assert.match(storage, /props.active/);
assert.match(storage, /abort\?\.abort\(\)/);
assert.match(read('internal/envapp/ui_src/src/ui/pages/settings/SettingsPrimitives.tsx'), /Omit<SettingRowProps, 'icon'>/);
assert.match(read('internal/envapp/ui_src/src/ui/pages/EnvAIPage.tsx'), /onReviewIssues=\{\(\) => env.openSettings\('flower_recovery'/);

// IMPORTANT: Resource indexes never repeat a picker above their grouped list.
for (const file of ['internal/envapp/ui_src/src/ui/pages/settings/ContainerSettingsPanel.tsx', 'internal/envapp/ui_src/src/ui/pages/EnvPortForwardsPage.tsx', 'internal/envapp/ui_src/src/ui/plugins/PluginSettingsPanel.tsx']) {
  const source = read(file);
  assert.match(source, /<SettingsResourceHeader/);
  assert.match(source, /<SettingsResourceList/);
  assert.doesNotMatch(source, /SettingsResourceToolbar/);
}
const managedSettings = read('internal/envapp/ui_src/src/ui/pages/ManagedServiceSettingsDrawer.tsx');
assert.doesNotMatch(managedSettings, /<select[ >]/);
assert.match(managedSettings, /const value = clone\(draft\(\)\)/);
assert.match(read('internal/envapp/ui_src/src/ui/plugins/PluginConnectionsDialog.tsx'), /<SettingsList>/);
