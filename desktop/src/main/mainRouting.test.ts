import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readMainSource(): string {
  return fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
}

describe('main routing', () => {
  it('opens the chooser on cold launch instead of auto-connecting immediately', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("await openConnectionCenterWindow({ entryReason: 'app_launch' });");
    expect(mainSrc).not.toContain('await showMainWindow();');
  });

  it('tracks the active session separately and restores it on chooser cancel', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('let currentSessionTarget: DesktopTargetPreferences | null = null;');
    expect(mainSrc).toContain('await returnMainWindowToCurrentTarget()');
    expect(mainSrc).toContain("ipcMain.on(CANCEL_DESKTOP_SETTINGS_CHANNEL, () => {");
    expect(mainSrc).toContain('if (currentSessionTarget) {');
    expect(mainSrc).toContain('void requestQuit();');
  });

  it('routes legacy advanced entrypoints into the chooser-owned flow', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('async function openAdvancedSettingsWindow(): Promise<void> {');
    expect(mainSrc).toContain('advancedSectionOpen: true');
    expect(mainSrc).toContain("if (normalized.kind === 'connection_center') {");
    expect(mainSrc).toContain('await openAdvancedSettingsWindow();');
  });

  it('builds chooser snapshots with active-session context', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('activeSessionTarget: currentSessionTarget');
    expect(mainSrc).toContain('entryReason: options.entryReason');
    expect(mainSrc).toContain('issue: options.issue ?? null');
  });
});
