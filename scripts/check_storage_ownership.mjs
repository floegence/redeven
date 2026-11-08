import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
// IMPORTANT: This source-only gate protects host placement without examining
// upstream schemas. Behavioral tests own permissions, recovery and rendering.
const plugin = read('internal/redevpluginintegration/integration.go');
assert.match(plugin, /CheckPluginPlacement\(stateAbs\)/);
assert.match(plugin, /root := storagecontract.PluginRoot\(stateAbs\)/);
assert.doesNotMatch(plugin, /root := stateAbs/);
const desktop = read('desktop/src/main/main.ts');
assert.doesNotMatch(desktop, /path.join\(app.getPath\('userData'\), '(?:browser-package-cache|native-application-components|resource-cache)'\)/);
assert.doesNotMatch(desktop, /(?:runtimePackageCacheRoot|codeWorkspaceEnginePackageCacheRoot)\(app.getPath\('userData'\)\)/);
assert.match(desktop, /runtimePackageCacheRoot\(desktopProductCacheRoot\(\)\)/);
const skills = read('internal/ai/skill_manager.go');
assert.doesNotMatch(skills, /filepath.Join\([^\n]*"\.redeven", "skills"/);
assert.match(skills, /storagecontract.SkillsRoot\(stateDir\)/);
assert.match(read('internal/ai/service.go'), /CheckSkillsPlacement\(opts.StateDir\)/);
assert.doesNotMatch(read('internal/managedwebservice/builtin_templates.go'), /dataLocation = filepath.Join/);
assert.match(read('internal/config/config.go'), /IMPORTANT: Config is one atomic identity\/recovery transaction/);
console.log('Storage ownership contract passed.');
