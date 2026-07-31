import { describe, expect, it } from 'vitest';

import { buildWebServiceBrowserDocumentURL } from './webServiceBrowserDocument';

function decodeDataDocument(url: string): string {
  const prefix = 'data:text/html;charset=utf-8,';
  expect(url.startsWith(prefix)).toBe(true);
  return decodeURIComponent(url.slice(prefix.length));
}

describe('webServiceBrowserDocument', () => {
  it('builds a scriptless browser toolbar with an editable address field', () => {
    const document = decodeDataDocument(buildWebServiceBrowserDocumentURL({
      locale: 'en-US',
      title: 'Web Service',
      addressLabel: 'Web Service address',
      addressPlaceholder: 'Enter an address or path',
      backLabel: 'Back',
      forwardLabel: 'Forward',
      reloadLabel: 'Reload',
      stopLabel: 'Stop loading',
      navigateLabel: 'Go to address',
      developerToolsLabel: 'Developer tools (F12)',
      openExternalLabel: 'Open in browser',
      secureRouteLabel: 'Protected route',
    }));

    expect(document).toContain('Content-Security-Policy');
    expect(document).toContain("default-src 'none'");
    expect(document).toContain('id="browser-address"');
    expect(document).toContain('type="text"');
    expect(document).toContain('id="browser-back"');
    expect(document).toContain('id="browser-forward"');
    expect(document).toContain('id="browser-reload"');
    expect(document).toContain('id="browser-open-external"');
    expect(document).toContain('id="browser-devtools"');
    expect(document).toContain('aria-label="Developer tools (F12)"');
    expect(document).toContain('aria-pressed="false"');
    expect(document).toContain('<circle cx="12" cy="12" r="9"/>');
    expect(document).not.toContain('<rect x="5" y="11" width="14" height="9" rx="2"/>');
    expect(document).toContain('aria-label="Open in browser"');
    expect(document).toContain('data-stop-label="Stop loading"');
    expect(document).toContain('.nav-button svg[hidden] { display: none; }');
    expect(document).toContain('class="stop-icon" viewBox="0 0 24 24" aria-hidden="true" hidden');
    expect(document).not.toContain('<script');
  });

  it('escapes localized toolbar copy before embedding it in HTML', () => {
    const document = decodeDataDocument(buildWebServiceBrowserDocumentURL({
      locale: 'en-US',
      title: '<Service>',
      addressLabel: '"Address"',
      addressPlaceholder: '<Paste>',
      backLabel: 'Back',
      forwardLabel: 'Forward',
      reloadLabel: 'Reload',
      stopLabel: 'Stop',
      navigateLabel: 'Go',
      developerToolsLabel: 'Developer tools',
      openExternalLabel: 'Open externally',
      secureRouteLabel: 'A & B',
    }));

    expect(document).toContain('&lt;Service&gt;');
    expect(document).toContain('&quot;Address&quot;');
    expect(document).toContain('A &amp; B');
    expect(document).not.toContain('<title><Service></title>');
  });
});
