import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readMainSource(): string {
  return fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
}

describe('main routing', () => {
  it('keeps the launcher and settings as singleton utility windows', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("type DesktopUtilityWindowKind = 'launcher' | 'local_environment_settings';");
    expect(mainSrc).toContain('const utilityWindows = new Map<DesktopUtilityWindowKind, BrowserWindow>();');
    expect(mainSrc).toContain("surface: 'connect_environment'");
    expect(mainSrc).toContain("surface: 'local_environment_settings'");
    expect(mainSrc).toContain("return kind === 'launcher' ? 'window:launcher' : 'window:settings';");
  });

  it('tracks environment windows by session key and scopes detached windows per session', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('const sessionsByKey = new Map<DesktopSessionKey, DesktopSessionRecord>();');
    expect(mainSrc).toContain('const sessionKeyByWebContentsID = new Map<number, DesktopSessionKey>();');
    expect(mainSrc).toContain('function sessionWindowStateKey(sessionKey: DesktopSessionKey): string {');
    expect(mainSrc).toContain('function sessionChildWindowStateKey(sessionKey: DesktopSessionKey, childKey: string): string {');
    expect(mainSrc).toContain('function openSessionChildWindow(');
    expect(mainSrc).toContain('if (isAllowedSessionNavigation(sessionKey, nextURL)) {');
  });

  it('routes launcher and shell actions into the multi-window desktop flow', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain("case 'open_local_environment_settings':");
    expect(mainSrc).toContain("case 'focus_environment_window':");
    expect(mainSrc).toContain("case 'close_launcher_or_quit':");
    expect(mainSrc).not.toContain("case 'return_to_current_environment':");
    expect(mainSrc).toContain("if (normalized.kind === 'connection_center') {");
    expect(mainSrc).toContain('await openAdvancedSettingsWindow();');
    expect(mainSrc).toContain("return openUtilityWindow('local_environment_settings', { stealAppFocus: true });");
    expect(mainSrc).toContain("return focusEnvironmentWindow(request.session_key);");
  });

  it('broadcasts launcher snapshots per utility window and scopes Ask Flower handoff by sender ownership', () => {
    const mainSrc = readMainSource();

    expect(mainSrc).toContain('DESKTOP_LAUNCHER_SNAPSHOT_UPDATED_CHANNEL');
    expect(mainSrc).toContain('function emitDesktopWelcomeSnapshot(kind: DesktopUtilityWindowKind): Promise<void>');
    expect(mainSrc).toContain('function broadcastDesktopWelcomeSnapshots(): void {');
    expect(mainSrc).toContain('function senderUtilityWindowKind(webContentsID: number): DesktopUtilityWindowKind {');
    expect(mainSrc).toContain('function handoffAskFlowerToOwningSession(senderWebContentsID: number, payload: DesktopAskFlowerHandoffPayload): Promise<void> {');
    expect(mainSrc).toContain('queueSessionAskFlowerHandoff(sessionKey, payload);');
  });
});
