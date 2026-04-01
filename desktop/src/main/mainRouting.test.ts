import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readMainSource(): string {
  return fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
}

describe('main routing', () => {
  it('opens the welcome launcher on cold launch instead of auto-connecting immediately', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("await openDesktopWelcomeWindow({ entryReason: 'app_launch' });");
    expect(mainSrc).toContain('resolveWelcomeRendererPath');
  });

  it('tracks the active session separately and restores it on launcher-owned cancellation', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('let currentSessionTarget: DesktopSessionTarget | null = null;');
    expect(mainSrc).toContain('returnMainWindowToCurrentTarget({ stealAppFocus: true })');
    expect(mainSrc).toContain('await closeSettingsSurface()');
    expect(mainSrc).toContain("ipcMain.on(CANCEL_DESKTOP_SETTINGS_CHANNEL, () => {");
    expect(mainSrc).toContain('if (currentSessionTarget) {');
    expect(mainSrc).toContain('void requestQuit();');
  });

  it('routes launcher and legacy menu entrypoints into the welcome-owned flow', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("async function openAdvancedSettingsWindow(returnSurface: 'welcome' | 'current_target' = 'current_target'): Promise<void> {");
    expect(mainSrc).toContain("case 'open_advanced_settings':");
    expect(mainSrc).toContain("await openAdvancedSettingsWindow('welcome');");
    expect(mainSrc).toContain("if (normalized.kind === 'connection_center') {");
    expect(mainSrc).toContain("await openAdvancedSettingsWindow('current_target');");
  });

  it('builds launcher snapshots with active-session context', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('activeSessionTarget: currentSessionTarget');
    expect(mainSrc).toContain('entryReason: overrides.entryReason ?? desktopWelcomeViewState.entryReason');
    expect(mainSrc).toContain('issue: overrides.issue ?? desktopWelcomeViewState.issue');
  });
});
