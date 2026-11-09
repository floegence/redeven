import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
describe('unified settings ownership gate', () => {
  it('opens above the work surface without navigating or dismissing plugins', () => {
    const shell = source('../../EnvAppShell.tsx');
    const open = shell.slice(shell.indexOf('const openSettings ='), shell.indexOf('const openDebugConsole ='));
    for (const forbidden of ['navigation.commit', 'setViewMode(', 'activateActivitySurface(', 'updatePluginPanel(', 'openSurface(']) expect(open).not.toContain(forbidden);
    expect(shell).not.toContain("component: EnvSettingsPage, sidebar:");
    expect(shell).toContain('<EnvSettingsDialog');
  });
  it('routes container configuration to the discoverable global owner', () => {
    expect(source('./settingsStructure.ts')).toContain("id: 'containers'");
    expect(source('../EnvContainersPage.tsx')).toContain("env.openSettings('containers', { resource: service.service_id })");
    expect(source('../EnvContainersPage.tsx')).not.toContain('container-service-configuration-dialog');
    expect(source('./EnvSettingsDialog.tsx')).toContain('ContainerSettingsPanel');
  });
  it('uses one provider editor and makes storage discoverable', () => {
    const section = source('./sections/FlowerSection.tsx');
    expect(section).toContain('FlowerSettingsSurface');
    expect(section).not.toContain('FlowerProviderDialog');
    expect(source('./settingsStructure.ts')).toContain("id: 'storage'");
  });
});
