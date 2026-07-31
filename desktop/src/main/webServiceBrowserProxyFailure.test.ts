import { describe, expect, it } from 'vitest';

import { isMarkedWebServiceUpstreamUnavailable } from './webServiceBrowserProxyFailure';

describe('webServiceBrowserProxyFailure', () => {
  it('recognizes only marked main-document proxy failures', () => {
    expect(isMarkedWebServiceUpstreamUnavailable({
      statusCode: 502,
      resourceType: 'mainFrame',
      responseHeaders: { 'X-Redeven-Proxy-Error': ['port-forward-upstream-unavailable'] },
    })).toBe(true);
    expect(isMarkedWebServiceUpstreamUnavailable({
      statusCode: 502,
      resourceType: 'xhr',
      responseHeaders: { 'x-redeven-proxy-error': ['port-forward-upstream-unavailable'] },
    })).toBe(false);
  });

  it('does not mistake an application-owned 502 for a connection failure', () => {
    expect(isMarkedWebServiceUpstreamUnavailable({
      statusCode: 502,
      resourceType: 'mainFrame',
      responseHeaders: { 'content-type': ['text/html'] },
    })).toBe(false);
    expect(isMarkedWebServiceUpstreamUnavailable({
      statusCode: 503,
      resourceType: 'mainFrame',
      responseHeaders: { 'x-redeven-proxy-error': ['port-forward-upstream-unavailable'] },
    })).toBe(false);
  });
});
