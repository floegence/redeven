import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
// IMPORTANT: Protect product ownership without implementing Floe modal mechanics.
// Browser qualification owns focus, geometry, drafts and late-result behavior.
const shell = read('internal/envapp/ui_src/src/ui/EnvAppShell.tsx');
const open = shell.slice(shell.indexOf('const openSettings ='), shell.indexOf('const openDebugConsole ='));
for (const forbidden of ['navigation.commit', 'setViewMode(', 'activateActivitySurface(', 'updatePluginPanel(', 'openSurface(']) assert.ok(!open.includes(forbidden), forbidden);
assert.match(shell, /transcriptVisible=\{[^\n]*!settingsSession.present\(\)/);
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
console.log('Unified settings ownership contract passed.');
