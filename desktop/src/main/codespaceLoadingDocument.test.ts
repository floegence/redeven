import { describe, expect, it } from 'vitest';

import { buildCodespaceLoadingDocumentURL } from './codespaceLoadingDocument';
import {
  desktopSemanticPaletteForShellTheme,
  desktopWindowThemeSnapshotForShellTheme,
} from './desktopTheme';
import type { DesktopShellThemePreset, DesktopThemeSnapshot } from '../shared/desktopTheme';

function snapshot(
  resolvedTheme: 'light' | 'dark',
  activeShellTheme: DesktopShellThemePreset,
): DesktopThemeSnapshot {
  return {
    source: resolvedTheme,
    resolvedTheme,
    shellThemes: {
      version: 1,
      light: resolvedTheme === 'light' ? activeShellTheme as never : 'mist',
      dark: resolvedTheme === 'dark' ? activeShellTheme as never : 'forest',
    },
    activeShellTheme,
    window: desktopWindowThemeSnapshotForShellTheme(activeShellTheme),
    semantic: desktopSemanticPaletteForShellTheme(activeShellTheme),
  };
}

function decodeDocument(url: string): string {
  expect(url).toMatch(/^data:text\/html;charset=utf-8,/u);
  return decodeURIComponent(url.slice(url.indexOf(',') + 1));
}

describe('buildCodespaceLoadingDocumentURL', () => {
  it('renders the active dark preset from the versioned semantic palette', () => {
    const html = decodeDocument(buildCodespaceLoadingDocumentURL(
      'codespace-forest',
      snapshot('dark', 'forest'),
    ));

    expect(html).toContain('data-floe-shell-theme="forest"');
    expect(html).toContain('data-theme-palette-version="1"');
    expect(html).toContain('color-scheme: dark');
    expect(html).toContain('--background: #0B1A17');
    expect(html).toContain('--surface: #132621');
    expect(html).toContain('--primary: #71D0B1');
    expect(html).toContain('--error: #FF8A82');
    expect(html).not.toContain('prefers-color-scheme');
  });

  it('uses the selected light palette without a fixed light/dark media fallback', () => {
    const html = decodeDocument(buildCodespaceLoadingDocumentURL(
      'codespace-mist',
      snapshot('light', 'mist'),
    ));

    expect(html).toContain('data-floe-shell-theme="mist"');
    expect(html).toContain('color-scheme: light');
    expect(html).toContain('--background: #EEF3F7');
    expect(html).toContain('--primary: #234E63');
    expect(html).not.toContain('#0e121b');
    expect(html).not.toContain('prefers-color-scheme');
  });

  it('uses semantic error styling and escapes all caller-provided copy', () => {
    const html = decodeDocument(buildCodespaceLoadingDocumentURL(
      '<codespace>',
      snapshot('dark', 'dracula'),
      {
        state: 'error',
        title: '<script>alert("x")</script>',
        detail: 'Retry & review <logs>',
      },
    ));

    expect(html).toContain('--error: #FF8A82');
    expect(html).toContain('color: var(--error)');
    expect(html).toContain('background: var(--error)');
    expect(html).toContain('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
    expect(html).toContain('Retry &amp; review &lt;logs&gt;');
    expect(html).toContain('&lt;codespace&gt;');
    expect(html).not.toContain('<script>alert');
  });

  it('stays local, scriptless, and bridge-free', () => {
    const html = decodeDocument(buildCodespaceLoadingDocumentURL(
      'codespace-safe',
      snapshot('dark', 'abyss'),
    ));

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("script-src 'none'");
    expect(html).not.toContain('<script');
    expect(html).not.toContain('redevenDesktopShell');
    expect(html).not.toContain('preload');
  });
});
