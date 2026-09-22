import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildWebServiceUnavailableDocumentURL, isWebServiceUnavailableRetryIntent, showWebServiceRetryFeedback, WEB_SERVICE_RETRY_INTENT_URL } from './webServiceUnavailableDocument';
import {
  desktopSemanticPaletteForShellTheme,
  desktopWindowThemeSnapshotForShellTheme,
} from './desktopTheme';
import type { DesktopThemeSnapshot } from '../shared/desktopTheme';

const theme: DesktopThemeSnapshot = {
  source: 'dark',
  resolvedTheme: 'dark',
  shellThemes: { version: 1, light: 'mist', dark: 'forest' },
  activeShellTheme: 'forest',
  window: desktopWindowThemeSnapshotForShellTheme('forest'),
  semantic: desktopSemanticPaletteForShellTheme('forest'),
};

function decodeDataDocument(url: string): string {
  const prefix = 'data:text/html;charset=utf-8,';
  expect(url.startsWith(prefix)).toBe(true);
  return decodeURIComponent(url.slice(prefix.length));
}

const copy = {
  locale: 'en-US',
  documentTitle: 'Web Service unavailable',
  eyebrow: 'Connection unavailable',
  title: 'This Web Service is not responding',
  summary: 'No service answered at this address.',
  targetLabel: 'Requested service',
  checksTitle: 'Before trying again',
  serviceCheck: 'Make sure the service is running.',
  portCheck: 'Confirm that the service is listening on this port.',
  retryLabel: 'Try again',
  retryingLabel: 'Trying again...',
} as const;

describe('webServiceUnavailableDocument', () => {
  it('builds a polished scriptless unavailable page with a local retry intent', () => {
    const document = decodeDataDocument(buildWebServiceUnavailableDocumentURL(
      copy,
      'http://localhost:3000',
      theme,
    ));

    expect(document).toContain('This Web Service is not responding');
    expect(document).toContain('<code title="http://localhost:3000">http://localhost:3000</code>');
    expect(document).toContain('id="retry" class="retry floe-window-status__button" href="https://redeven.invalid/window-status/retry"');
    expect(document).toContain('<p class="floe-window-status__label">Trying again...</p>');
    expect(document).not.toContain('animation: spin');
    expect(document).toContain('floe-window-status__content');
    expect(document).toContain('data-floe-progress-shimmer="text"');
    expect(document).toContain('M21 3v5h-5');
    expect(document).toContain('M8 16H3v5');
    expect(document).toContain('data-floe-shell-theme="forest"');
    expect(document).toContain(`--warning: ${theme.semantic.warning}`);
    expect(document).toContain("script-src 'none'");
    expect(document).not.toContain('<script');
    expect(document).not.toContain('upstream unavailable');
  });

  it('offers application reconnection without service addresses or browser instructions', () => {
    const document = decodeDataDocument(buildWebServiceUnavailableDocumentURL(copy, 'http://localhost:3000', theme, 'application'));
    expect(document).not.toContain('<code');
    expect(document).not.toContain('http://localhost:3000');
    expect(document).not.toContain('Make sure the service is running.');
    expect(document).toContain('href="https://redeven.invalid/window-status/retry"');
    expect(document).toContain('class="application"');
  });

  it('escapes localized copy and the displayed target', () => {
    const document = decodeDataDocument(buildWebServiceUnavailableDocumentURL({
      ...copy,
      title: '<Unavailable>',
      summary: 'A & B',
    }, 'http://localhost:3000/<admin>', theme));

    expect(document).toContain('&lt;Unavailable&gt;');
    expect(document).toContain('A &amp; B');
    expect(document).toContain('http://localhost:3000/&lt;admin&gt;');
    expect(document).not.toContain('<h1><Unavailable></h1>');
  });
});


it('accepts retry only from the exact host-owned failure document', () => {
  const documentURL = buildWebServiceUnavailableDocumentURL(copy, 'http://localhost:3000', theme);
  expect(isWebServiceUnavailableRetryIntent(WEB_SERVICE_RETRY_INTENT_URL, documentURL, documentURL)).toBe(true);
  expect(isWebServiceUnavailableRetryIntent(WEB_SERVICE_RETRY_INTENT_URL, 'https://example.test', documentURL)).toBe(false);
  expect(isWebServiceUnavailableRetryIntent(WEB_SERVICE_RETRY_INTENT_URL, documentURL + '#retry', documentURL)).toBe(false);
  expect(isWebServiceUnavailableRetryIntent(WEB_SERVICE_RETRY_INTENT_URL, '', '')).toBe(false);
  expect(isWebServiceUnavailableRetryIntent('about:blank', documentURL, documentURL)).toBe(false);
});


describe('native service retry feedback', () => {
  afterEach(() => vi.useRealTimers());

  it.each(['current', 'navigated', 'replaced', 'closed'] as const)('retries only a current failure after feedback: %s', async (outcome) => {
    vi.useFakeTimers();
    const page = 'data:text/html,owned-document';
    let url = page;
    let current = true;
    let destroyed = false;
    const contents = {
      insertCSS: vi.fn(async () => 'retry-style'),
      removeInsertedCSS: vi.fn(async () => {}),
      getURL: () => url,
      isDestroyed: () => destroyed,
    };
    const result = showWebServiceRetryFeedback(contents, page, () => current);
    expect(contents.insertCSS).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    if (outcome === 'navigated') url = 'https://service.test';
    if (outcome === 'replaced') current = false;
    if (outcome === 'closed') destroyed = true;
    await vi.advanceTimersByTimeAsync(600);
    expect(await result).toBe(outcome === 'current');
    expect(contents.removeInsertedCSS).toHaveBeenCalledTimes(outcome === 'closed' || outcome === 'current' ? 0 : 1);
  });

  it('does not style a replaced failure document', async () => {
    vi.useFakeTimers();
    const contents = { insertCSS: vi.fn(), removeInsertedCSS: vi.fn(), getURL: () => 'data:text/html,new-document', isDestroyed: () => false };
    const result = showWebServiceRetryFeedback(contents, 'data:text/html,old-document', () => true);
    await vi.runAllTimersAsync();
    expect(await result).toBe(false);
    expect(contents.insertCSS).not.toHaveBeenCalled();
  });
});
