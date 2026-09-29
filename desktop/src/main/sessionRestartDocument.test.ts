import { describe, expect, it } from 'vitest';
import { desktopSemanticPaletteForShellTheme, desktopWindowThemeSnapshotForShellTheme } from './desktopTheme';
import { sessionRestartDocumentURL, SESSION_RESTART_REOPEN_URL, SESSION_RESTART_CENTER_URL } from './sessionRestartDocument';
import type { DesktopThemeSnapshot } from '../shared/desktopTheme';

const theme: DesktopThemeSnapshot = {
  source: 'dark', resolvedTheme: 'dark', shellThemes: { version: 1, light: 'mist', dark: 'forest' },
  activeShellTheme: 'forest', window: desktopWindowThemeSnapshotForShellTheme('forest'),
  semantic: desktopSemanticPaletteForShellTheme('forest'),
};

const html = (stage: 'restarting' | 'restoring' | 'failed', locale: 'en-US' | 'zh-CN' = 'en-US') =>
  decodeURIComponent(sessionRestartDocumentURL({ label: '<Local & Runtime>', stage, locale, theme }).split(',', 2)[1]!);

describe('sessionRestartDocument', () => {
  it('renders one opaque, scriptless status and escapes environment data', () => {
    const content = html('restarting');
    expect(content).toContain("script-src 'none'");
    expect(content).toContain('background: var(--background)');
    expect(content).toContain('&lt;Local &amp; Runtime&gt;');
    expect(content).not.toContain('<Local & Runtime>');
    expect(content).not.toContain(SESSION_RESTART_REOPEN_URL);
  });

  it('offers localized explicit recovery actions only after failure', () => {
    const content = html('failed', 'zh-CN');
    expect(content).toContain('工作区无法重新连接');
    expect(content).toContain(SESSION_RESTART_REOPEN_URL);
    expect(content).toContain(SESSION_RESTART_CENTER_URL);
    expect(content).not.toContain('Technical details');
    expect(html('restoring')).not.toContain(SESSION_RESTART_REOPEN_URL);
  });
});
