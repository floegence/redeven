import { describe, expect, it, vi } from 'vitest';
import { buildWebServiceReservedPathDocumentURL, performWebServiceReservedPathIntent } from './webServiceReservedPathDocument';
import { desktopSemanticPaletteForShellTheme, desktopWindowThemeSnapshotForShellTheme } from './desktopTheme';
import { createDesktopI18n, REDEVEN_SUPPORTED_LOCALES } from '../shared/i18n';
import type { DesktopThemeSnapshot } from '../shared/desktopTheme';

const theme: DesktopThemeSnapshot = {
  source: 'light', resolvedTheme: 'light', shellThemes: { version: 1, light: 'classic-light', dark: 'classic-dark' },
  activeShellTheme: 'classic-light', window: desktopWindowThemeSnapshotForShellTheme('classic-light'), semantic: desktopSemanticPaletteForShellTheme('classic-light'),
};

describe('reserved-path explanation', () => {
  it.each(REDEVEN_SUPPORTED_LOCALES)('shows localized recovery without retry or direct navigation in %s', locale => {
    const url = buildWebServiceReservedPathDocumentURL(locale, 'http://localhost:23999/_redeven_proxy/env/?q=<script>&x=1#section', theme);
    const html = decodeURIComponent(url.slice(url.indexOf(',') + 1));
    const i18n = createDesktopI18n(locale);
    expect(html).toContain(i18n.t('webServiceBrowser.reservedPathTitle'));
    expect(html).not.toContain('edit-address');
    expect(html).toContain('id="copy-address"');
    expect(html).toContain('&lt;script&gt;&amp;x=1#section');
    expect(html).toContain("script-src 'none'");
    expect(html).not.toContain('<script');
    expect(html).not.toContain('id="retry"');
    expect(html).not.toContain('href="http://localhost');
    const details = html.match(/<details\b[^>]*>[\s\S]*?<\/details>/)?.[0];
    expect(details).toBeDefined();
    expect(details).toContain('<details class="floe-window-status__details">');
    expect(details).toContain(i18n.t('webServiceBrowser.viewDetails'));
    expect(details).toContain(i18n.t('webServiceBrowser.reservedPathSummary'));
    expect(details).toContain('<code>http://localhost:23999/');
    expect(details).toContain('id="copy-address"');
    expect(html.replace(details!, '')).not.toContain('class="floe-window-status__actions"');
    expect(details).not.toContain('<h1');
  });

  it('accepts only the copy action from the current host document', () => {
    const documentURL = buildWebServiceReservedPathDocumentURL('en-US', 'http://localhost:23999/', theme);
    const copyAddress = vi.fn();
    const target = 'https://redeven.invalid/window-status/copy-address';
    expect(performWebServiceReservedPathIntent(target, documentURL, documentURL, copyAddress)).toBe(true);
    for (const current of ['', 'http://localhost:23999/', documentURL + '#stale']) {
      expect(performWebServiceReservedPathIntent(target, current, documentURL, copyAddress)).toBe(false);
    }
    expect(performWebServiceReservedPathIntent(target + '?address=other', documentURL, documentURL, copyAddress)).toBe(false);
    expect(performWebServiceReservedPathIntent(target, '', '', copyAddress)).toBe(false);
    expect(performWebServiceReservedPathIntent('https://redeven.invalid/window-status/edit-address', documentURL, documentURL, copyAddress)).toBe(false);
    expect(copyAddress).toHaveBeenCalledOnce();
  });
});
