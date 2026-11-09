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
assert.match(shell, /visiblePluginWindows = createMemo\(\(\) => settingsSession.present\(\) \? \[\]/);
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
for (const panel of ['TerminalSettingsPanel', 'ContainerSettingsPanel', 'ConversationDefaultsSettings', 'BrowserDisplaySettings', 'WorkbenchAppearanceSettings', 'PluginSettingsPanel']) assert.match(settings, new RegExp('<' + panel + '[ >]'));
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
assert.match(read('internal/envapp/ui_src/src/ui/services/hostApplicationSettingsTarget.ts'), /event\.origin === owner\.origin/);
console.log('Unified settings ownership contract passed.');
