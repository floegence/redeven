import { describe, expect, it } from 'vitest';

import { buildWebServiceUnavailableDocumentURL } from './webServiceUnavailableDocument';

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
} as const;

describe('webServiceUnavailableDocument', () => {
  it('builds a polished scriptless unavailable page with a local retry intent', () => {
    const document = decodeDataDocument(buildWebServiceUnavailableDocumentURL(copy, 'http://localhost:3000'));

    expect(document).toContain('This Web Service is not responding');
    expect(document).toContain('<code title="http://localhost:3000">http://localhost:3000</code>');
    expect(document).toContain('href="#retry"');
    expect(document).toContain("script-src 'none'");
    expect(document).not.toContain('<script');
    expect(document).not.toContain('upstream unavailable');
  });

  it('escapes localized copy and the displayed target', () => {
    const document = decodeDataDocument(buildWebServiceUnavailableDocumentURL({
      ...copy,
      title: '<Unavailable>',
      summary: 'A & B',
    }, 'http://localhost:3000/<admin>'));

    expect(document).toContain('&lt;Unavailable&gt;');
    expect(document).toContain('A &amp; B');
    expect(document).toContain('http://localhost:3000/&lt;admin&gt;');
    expect(document).not.toContain('<h1><Unavailable></h1>');
  });
});
