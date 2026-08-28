import http from 'node:http';

import { DESKTOP_PRIVATE_BRIDGE_TOKEN_HEADER, normalizeDesktopPrivateBridgeToken } from './desktopPrivateBridge';
import {
  isAllowedWebServiceWindowNavigation,
  isDesktopPrivateWebServiceURLForForward,
  isPortForwardURLForForward,
  webServiceBrowserPrivateAppLocation,
} from './navigation';

const WEB_SERVICE_BROWSER_HANDOFF_PATH = '/_redeven_desktop/web-service-browser-handoff';
const WEB_SERVICE_BROWSER_HANDOFF_QUERY = '__redeven_browser_handoff_v1';
const WEB_SERVICE_BROWSER_HANDOFF_TIMEOUT_MS = 5_000;
const WEB_SERVICE_BROWSER_HANDOFF_RESPONSE_LIMIT = 16 * 1024;

export class WebServiceBrowserExternalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebServiceBrowserExternalError';
  }
}

type MintResponse = Readonly<{
  entry_url?: unknown;
  expires_at_unix_ms?: unknown;
}>;

export type WebServiceBrowserExternalRequest = Readonly<{
  currentRouteURL: string;
  pendingExternalURL?: string;
  bridgeBaseURL?: string;
  bridgeToken?: string;
  allowedBaseURL: string;
  forwardID: string;
}>;

type WebServiceBrowserExternalDependencies = Readonly<{
  openURL: (targetURL: string) => Promise<void>;
  timeoutMs?: number;
}>;

function normalizedSearchEntries(url: URL, excludedName = ''): string[] {
  return [...url.searchParams.entries()]
    .filter(([name]) => name !== excludedName)
    .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
    .sort();
}

function sameStringEntries(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function validateHandoffEntryURL(
  rawEntryURL: string,
  bridgeBaseURL: string,
  appLocation: string,
  forwardID: string,
): string {
  let entry: URL;
  let bridge: URL;
  let app: URL;
  try {
    entry = new URL(rawEntryURL);
    bridge = new URL(bridgeBaseURL);
    app = new URL(appLocation, 'http://redeven.invalid');
  } catch {
    throw new WebServiceBrowserExternalError('Runtime returned an invalid browser handoff URL.');
  }
  const expectedHostname = `pf-${forwardID.trim().toLowerCase()}.localhost`;
  const handoffValues = entry.searchParams.getAll(WEB_SERVICE_BROWSER_HANDOFF_QUERY);
  const ticket = handoffValues[0] ?? '';
  const appEntries = normalizedSearchEntries(app);
  const entryEntries = normalizedSearchEntries(entry, WEB_SERVICE_BROWSER_HANDOFF_QUERY);
  if (
    entry.protocol !== 'http:'
    || entry.username
    || entry.password
    || entry.hostname.toLowerCase() !== expectedHostname
    || entry.port !== bridge.port
    || entry.pathname !== app.pathname
    || entry.hash !== app.hash
    || handoffValues.length !== 1
    || !/^[A-Za-z0-9_-]{32,}$/u.test(ticket)
    || !sameStringEntries(entryEntries, appEntries)
  ) {
    throw new WebServiceBrowserExternalError('Runtime returned a browser handoff for a different Web Service.');
  }
  return entry.toString();
}

function requestBrowserHandoff(input: Readonly<{
  bridgeBaseURL: string;
  bridgeToken: string;
  forwardID: string;
  appLocation: string;
  timeoutMs: number;
}>): Promise<string> {
  let bridge: URL;
  try {
    bridge = new URL(input.bridgeBaseURL);
  } catch {
    return Promise.reject(new WebServiceBrowserExternalError('Desktop bridge URL is invalid.'));
  }
  const bridgeToken = normalizeDesktopPrivateBridgeToken(input.bridgeToken);
  const bridgeHostname = bridge.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  const bridgeIPv4Octets = bridgeHostname.split('.');
  const loopbackBridge = bridgeHostname === 'localhost'
    || bridgeHostname === '::1'
    || (bridgeIPv4Octets.length === 4
      && bridgeIPv4Octets[0] === '127'
      && bridgeIPv4Octets.every((octet) => /^(?:0|[1-9][0-9]{0,2})$/u.test(octet) && Number(octet) <= 255));
  if (bridge.protocol !== 'http:' || bridge.username || bridge.password || !loopbackBridge || !bridgeToken) {
    return Promise.reject(new WebServiceBrowserExternalError('Desktop bridge authorization is unavailable.'));
  }
  const endpoint = new URL(WEB_SERVICE_BROWSER_HANDOFF_PATH, bridge);
  const body = Buffer.from(JSON.stringify({
    forward_id: input.forwardID,
    app_path: input.appLocation,
  }), 'utf8');
  return new Promise((resolve, reject) => {
    const req = http.request(endpoint, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': body.length,
        [DESKTOP_PRIVATE_BRIDGE_TOKEN_HEADER]: bridgeToken,
      },
    }, (response) => {
      const chunks: Buffer[] = [];
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > WEB_SERVICE_BROWSER_HANDOFF_RESPONSE_LIMIT) {
          response.destroy(new WebServiceBrowserExternalError('Runtime browser handoff response is too large.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new WebServiceBrowserExternalError(`Runtime browser handoff failed with HTTP ${response.statusCode ?? 0}.`));
          return;
        }
        let payload: MintResponse;
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as MintResponse;
        } catch {
          reject(new WebServiceBrowserExternalError('Runtime browser handoff response is invalid.'));
          return;
        }
        if (
          typeof payload.entry_url !== 'string'
          || typeof payload.expires_at_unix_ms !== 'number'
          || !Number.isFinite(payload.expires_at_unix_ms)
        ) {
          reject(new WebServiceBrowserExternalError('Runtime browser handoff response is incomplete.'));
          return;
        }
        try {
          resolve(validateHandoffEntryURL(payload.entry_url, bridge.toString(), input.appLocation, input.forwardID));
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(Math.max(1, input.timeoutMs), () => {
      req.destroy(new WebServiceBrowserExternalError('Runtime browser handoff timed out.'));
    });
    req.on('error', reject);
    req.end(body);
  });
}

function explicitExternalURL(raw: string): string | null {
  try {
    const target = new URL(raw);
    if ((target.protocol !== 'http:' && target.protocol !== 'https:') || target.username || target.password) return null;
    return target.toString();
  } catch {
    return null;
  }
}

export async function openWebServiceInSystemBrowser(
  request: WebServiceBrowserExternalRequest,
  dependencies: WebServiceBrowserExternalDependencies,
): Promise<void> {
  const pendingExternalURL = explicitExternalURL(request.pendingExternalURL ?? '');
  if (pendingExternalURL) {
    await dependencies.openURL(pendingExternalURL);
    return;
  }

  const appLocation = webServiceBrowserPrivateAppLocation(
    request.currentRouteURL,
    request.bridgeBaseURL ?? '',
    request.forwardID,
  );
  if (appLocation) {
    const entryURL = await requestBrowserHandoff({
      bridgeBaseURL: request.bridgeBaseURL ?? '',
      bridgeToken: request.bridgeToken ?? '',
      forwardID: request.forwardID,
      appLocation,
      timeoutMs: dependencies.timeoutMs ?? WEB_SERVICE_BROWSER_HANDOFF_TIMEOUT_MS,
    });
    await dependencies.openURL(entryURL);
    return;
  }

  if (isDesktopPrivateWebServiceURLForForward(request.currentRouteURL, request.forwardID)) {
    throw new WebServiceBrowserExternalError('Desktop bridge authorization is unavailable for this Web Service.');
  }

  if (
    isAllowedWebServiceWindowNavigation(request.currentRouteURL, request.allowedBaseURL, request.forwardID)
    && isPortForwardURLForForward(request.currentRouteURL, request.forwardID)
  ) {
    await dependencies.openURL(request.currentRouteURL);
    return;
  }
  throw new WebServiceBrowserExternalError('The current Web Service does not have a browser-safe route.');
}
