import { describe, expect, it } from 'vitest';

import { isMarkedWebServiceUpstreamUnavailable, isMarkedWebServiceReservedPath } from './webServiceBrowserProxyFailure';

describe('webServiceBrowserProxyFailure', () => {
  it('distinguishes a marked reserved-path document from ordinary 404s and subresources', () => {
    const response = { statusCode: 404, resourceType: 'mainFrame', responseHeaders: { 'X-Redeven-Proxy-Error': ['port-forward-reserved-path'] } };
    expect(isMarkedWebServiceReservedPath(response)).toBe(true);
    expect(isMarkedWebServiceReservedPath({ ...response, responseHeaders: {} })).toBe(false);
    expect(isMarkedWebServiceReservedPath({ ...response, statusCode: 502 })).toBe(false);
    expect(isMarkedWebServiceReservedPath({ ...response, responseHeaders: { 'x-redeven-proxy-error': ['unknown'] } })).toBe(false);
    for (const resourceType of ['xhr', 'subFrame', 'script', 'image']) {
      expect(isMarkedWebServiceReservedPath({ ...response, resourceType })).toBe(false);
    }
  });
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
