export const WEB_SERVICE_PROXY_ERROR_HEADER = 'x-redeven-proxy-error';
export const WEB_SERVICE_PROXY_UPSTREAM_UNAVAILABLE = 'port-forward-upstream-unavailable';

export type WebServiceBrowserResponseDetails = Readonly<{
  statusCode: number;
  resourceType: string;
  responseHeaders?: Record<string, string[]>;
}>;

export function isMarkedWebServiceUpstreamUnavailable(
  details: WebServiceBrowserResponseDetails,
): boolean {
  if (details.statusCode !== 502 || details.resourceType !== 'mainFrame') return false;
  for (const [name, values] of Object.entries(details.responseHeaders ?? {})) {
    if (name.trim().toLowerCase() !== WEB_SERVICE_PROXY_ERROR_HEADER) continue;
    return values.some((value) => value.trim().toLowerCase() === WEB_SERVICE_PROXY_UPSTREAM_UNAVAILABLE);
  }
  return false;
}
