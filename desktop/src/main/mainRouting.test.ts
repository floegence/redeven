import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readMainSource(): string {
  return fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
}

describe('main routing', () => {
  it('opens the welcome renderer on cold launch instead of auto-connecting immediately', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("await openDesktopWelcomeWindow({ entryReason: 'app_launch' });");
    expect(mainSrc).toContain('resolveWelcomeRendererPath');
  });

  it('tracks the active session separately and restores it on settings cancellation', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('let currentSessionTarget: DesktopSessionTarget | null = null;');
    expect(mainSrc).toContain('returnMainWindowToCurrentTarget({ stealAppFocus: true })');
    expect(mainSrc).toContain('async function closeSettingsSurface(): Promise<void> {');
    expect(mainSrc).toContain("ipcMain.on(CANCEL_DESKTOP_SETTINGS_CHANNEL, () => {");
    expect(mainSrc).toContain('void closeSettingsSurface();');
    expect(mainSrc).toContain('if (currentSessionTarget) {');
    expect(mainSrc).toContain('void requestQuit();');
  });

  it('routes launcher actions and legacy shell entrypoints into the shared welcome flow', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("async function openAdvancedSettingsWindow(returnSurface: 'welcome' | 'current_target' = 'current_target'): Promise<void> {");
    expect(mainSrc).toContain("async function restartManagedRuntimeFromShell(): Promise<DesktopShellRuntimeActionResponse> {");
    expect(mainSrc).toContain("surface: 'this_device_settings'");
    expect(mainSrc).toContain("case 'upsert_saved_environment':");
    expect(mainSrc).toContain("case 'delete_saved_environment':");
    expect(mainSrc).not.toContain("case 'open_advanced_settings':");
    expect(mainSrc).toContain("if (normalized.kind === 'connection_center') {");
    expect(mainSrc).toContain("await openAdvancedSettingsWindow('current_target');");
    expect(mainSrc).toContain('ipcMain.handle(DESKTOP_SHELL_OPEN_EXTERNAL_URL_CHANNEL');
    expect(mainSrc).toContain('normalizeDesktopShellOpenExternalURLRequest');
    expect(mainSrc).toContain("message: 'Invalid external URL.'");
    expect(mainSrc).toContain('ipcMain.handle(DESKTOP_SHELL_RUNTIME_ACTION_CHANNEL');
    expect(mainSrc).toContain("if (normalized.action === 'restart_managed_runtime') {");
    expect(mainSrc).toContain('return restartManagedRuntimeFromShell();');
  });

  it('keeps settings saves renderer-local by persisting without closing the surface', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("ipcMain.handle(SAVE_DESKTOP_SETTINGS_CHANNEL, async (_event, draft: DesktopSettingsDraft): Promise<SaveDesktopSettingsResult> => {");
    expect(mainSrc).toContain('await persistDesktopPreferences(next);');
    expect(mainSrc).not.toContain('await closeSettingsSurface()');
  });

  it('builds launcher snapshots with active-session context', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('activeSessionTarget: currentSessionTarget');
    expect(mainSrc).toContain('surface: desktopWelcomeViewState.surface');
    expect(mainSrc).toContain('entryReason: overrides.entryReason ?? desktopWelcomeViewState.entryReason');
    expect(mainSrc).toContain('issue: overrides.issue ?? desktopWelcomeViewState.issue');
  });
});
