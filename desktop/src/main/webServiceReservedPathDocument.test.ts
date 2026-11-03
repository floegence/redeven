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
    expect(html).toContain('id="edit-address"');
    expect(html).toContain('id="copy-address"');
    expect(html).toContain('&lt;script&gt;&amp;x=1#section');
    expect(html).toContain("script-src 'none'");
    expect(html).not.toContain('<script');
    expect(html).not.toContain('id="retry"');
    expect(html).not.toContain('href="http://localhost');
    expect(html).not.toContain('<details');
  });

  it('accepts only exact actions from the current host document', () => {
    const documentURL = buildWebServiceReservedPathDocumentURL('en-US', 'http://localhost:23999/', theme);
    const actions = { editAddress: vi.fn(), copyAddress: vi.fn() };
    for (const intent of ['edit-address', 'copy-address']) {
      const target = `https://redeven.invalid/window-status/${intent}`;
      expect(performWebServiceReservedPathIntent(target, documentURL, documentURL, actions)).toBe(true);
      for (const current of ['', 'http://localhost:23999/', documentURL + '#stale']) {
        expect(performWebServiceReservedPathIntent(target, current, documentURL, actions)).toBe(false);
      }
      expect(performWebServiceReservedPathIntent(target + '?address=other', documentURL, documentURL, actions)).toBe(false);
      expect(performWebServiceReservedPathIntent(target, '', '', actions)).toBe(false);
    }
    expect(actions.editAddress).toHaveBeenCalledOnce();
    expect(actions.copyAddress).toHaveBeenCalledOnce();
  });
});
