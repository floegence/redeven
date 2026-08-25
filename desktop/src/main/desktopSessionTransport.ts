import type { DesktopSessionTarget } from './desktopTarget';
import { buildLocalUIEnvAppEntryURL, normalizeLocalUIBridgeURL } from './localUIURL';
import type { StartupReport } from './startup';
import {
  DESKTOP_PRIVATE_BRIDGE_TOKEN_HEADER,
  normalizeDesktopPrivateBridgeToken,
} from './desktopPrivateBridge';

export type DesktopSessionTransportKind =
  | 'native_local_bridge'
  | 'placement_bridge'
  | 'gateway_bridge'
  | 'provider_remote'
  | 'external_local_ui';

export type DesktopSessionTransport = Readonly<{
  kind: DesktopSessionTransportKind;
  baseURL: string;
  entryURL: string;
  displayURL: string;
  allowedBaseURL: string;
  proxyPolicy: 'direct' | 'system';
  partition: string;
}>;

export type DesktopRequestHeaders = Record<string, string | string[]>;

export function desktopPrivateBridgeRequestHeaders(
  transport: DesktopSessionTransport,
  startup: StartupReport,
  requestURL: string,
  requestHeaders: DesktopRequestHeaders,
): DesktopRequestHeaders {
  if (transport.kind !== 'native_local_bridge' && transport.kind !== 'placement_bridge') {
    return requestHeaders;
  }
  const token = normalizeDesktopPrivateBridgeToken(startup.local_ui_bridge_token);
  if (!token) {
    return requestHeaders;
  }
  try {
    const request = new URL(requestURL);
    const allowed = new URL(transport.allowedBaseURL);
    if (request.origin !== allowed.origin || request.protocol !== 'http:') {
      return requestHeaders;
    }
  } catch {
    return requestHeaders;
  }
  const normalizedHeaderName = DESKTOP_PRIVATE_BRIDGE_TOKEN_HEADER.toLowerCase();
  const authorizedHeaders = Object.fromEntries(
    Object.entries(requestHeaders).filter(([name]) => name.toLowerCase() !== normalizedHeaderName),
  ) as DesktopRequestHeaders;
  authorizedHeaders[DESKTOP_PRIVATE_BRIDGE_TOKEN_HEADER] = token;
  return authorizedHeaders;
}

export function shouldFailDesktopSessionMainDocument(input: Readonly<{
  lifecycle: 'opening' | 'open' | 'closing';
  resourceType: string;
  statusCode: number;
  webContentsID: number;
  rootWebContentsID: number;
}>): boolean {
  return input.lifecycle === 'opening'
    && input.resourceType === 'mainFrame'
    && input.statusCode >= 400
    && input.webContentsID === input.rootWebContentsID;
}

type DesktopSessionTransportOptions = Readonly<{
  placementBridge?: boolean;
}>;

function rootURL(rawURL: string): string {
  return new URL('/', rawURL).toString();
}

function directPartition(target: DesktopSessionTarget): string {
  return `redeven-direct:${encodeURIComponent(target.session_key)}`;
}

export function requireLocalUIBridgeURL(startup: StartupReport): string {
  if (!startup.local_ui_bridge_url) {
    throw new Error('Desktop startup report is missing the trusted Local UI bridge URL.');
  }
  return normalizeLocalUIBridgeURL(startup.local_ui_bridge_url);
}

function requireLocalUIBridgeToken(startup: StartupReport): string {
  const token = normalizeDesktopPrivateBridgeToken(startup.local_ui_bridge_token);
  if (!token) {
    throw new Error('Desktop startup report is missing private Local UI bridge authorization.');
  }
  return token;
}

export function resolveDesktopSessionTransport(
  target: DesktopSessionTarget,
  startup: StartupReport,
  options: DesktopSessionTransportOptions = {},
): DesktopSessionTransport {
  const displayURL = startup.local_ui_url;
  if (target.kind === 'local_environment' && target.route === 'local_host' && options.placementBridge !== true) {
    const baseURL = requireLocalUIBridgeURL(startup);
    requireLocalUIBridgeToken(startup);
    return {
      kind: 'native_local_bridge',
      baseURL,
      entryURL: buildLocalUIEnvAppEntryURL(baseURL),
      displayURL,
      allowedBaseURL: baseURL,
      proxyPolicy: 'direct',
      partition: directPartition(target),
    };
  }

  if (options.placementBridge === true || target.kind === 'ssh_environment') {
    requireLocalUIBridgeToken(startup);
    const baseURL = rootURL(startup.local_ui_url);
    return {
      kind: 'placement_bridge',
      baseURL,
      entryURL: buildLocalUIEnvAppEntryURL(baseURL),
      displayURL,
      allowedBaseURL: baseURL,
      proxyPolicy: 'direct',
      partition: directPartition(target),
    };
  }

  if (target.kind === 'gateway_environment') {
    return {
      kind: 'gateway_bridge',
      baseURL: rootURL(startup.local_ui_url),
      entryURL: startup.local_ui_url,
      displayURL,
      allowedBaseURL: startup.local_ui_url,
      proxyPolicy: 'direct',
      partition: directPartition(target),
    };
  }

  if (target.kind === 'local_environment') {
    return {
      kind: 'provider_remote',
      baseURL: rootURL(startup.local_ui_url),
      entryURL: startup.local_ui_url,
      displayURL,
      allowedBaseURL: startup.local_ui_url,
      proxyPolicy: 'system',
      partition: '',
    };
  }

  return {
    kind: 'external_local_ui',
    baseURL: rootURL(startup.local_ui_url),
    entryURL: buildLocalUIEnvAppEntryURL(startup.local_ui_url),
    displayURL,
    allowedBaseURL: startup.local_ui_url,
    proxyPolicy: 'system',
    partition: '',
  };
}
