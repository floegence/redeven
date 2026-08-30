import { isLoopbackHost, isSupportedLocalHostname } from './localUIURL';

type RemoteSessionFamily =
  | Readonly<{
      kind: 'sandbox';
      region: string;
      sandbox_base_domain: string;
      runtime_base_domain: string;
    }>
  | Readonly<{
      kind: 'runtime';
      region: string;
      sandbox_base_domain: string;
      runtime_base_domain: string;
    }>;

function normalizeHTTPPort(url: URL): string {
  if (url.port) return url.port;
  return url.protocol === 'https:' ? '443' : '80';
}

function splitHostname(hostname: string): string[] {
  return String(hostname ?? '')
    .trim()
    .toLowerCase()
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);
}

function isSupportedSandboxID(id: string): boolean {
  return id.startsWith('env-') || id.startsWith('cs-') || id.startsWith('pf-');
}

function deriveControlPlaneBaseDomainFromSandboxBaseDomain(sandboxBaseDomain: string): string | null {
  const labels = splitHostname(sandboxBaseDomain);
  if (labels.length < 2) {
    return null;
  }
  const [first, ...rest] = labels;
  if (!first.endsWith('-sandbox')) {
    return null;
  }
  const controlPlaneFirst = first.slice(0, -'-sandbox'.length).trim();
  if (controlPlaneFirst === '') {
    return null;
  }
  return [controlPlaneFirst, ...rest].join('.');
}

function deriveRuntimeBaseDomainFromSandboxBaseDomain(sandboxBaseDomain: string): string | null {
  const normalized = splitHostname(sandboxBaseDomain).join('.');
  if (normalized === 'redeven.online') {
    return 'redeven.online';
  }
  const controlPlaneBaseDomain = deriveControlPlaneBaseDomainFromSandboxBaseDomain(sandboxBaseDomain);
  return controlPlaneBaseDomain ? deriveRuntimeIsolationBaseDomain(controlPlaneBaseDomain) : null;
}

function deriveRuntimeIsolationBaseDomain(baseDomain: string): string | null {
  const labels = splitHostname(baseDomain);
  if (labels.length < 2) {
    return null;
  }
  return labels[labels.length - 1] === 'test' ? 'redeven-online.test' : 'redeven.online';
}

function deriveSandboxBaseDomainFromRuntimeIsolationBaseDomain(runtimeBaseDomain: string): string | null {
  const normalized = splitHostname(runtimeBaseDomain).join('.');
  if (normalized === 'redeven-online.test') {
    return 'redeven-sandbox.test';
  }
  if (normalized === 'redeven.online') {
    return 'redeven.online';
  }
  return null;
}

function parseSandboxFamily(hostname: string): RemoteSessionFamily | null {
  const labels = splitHostname(hostname);
  if (labels.length < 4) {
    return null;
  }
  const [sandboxID, region, ...rest] = labels;
  if (!sandboxID || !region) {
    return null;
  }
  if (!isSupportedSandboxID(sandboxID)) {
    return null;
  }
  const sandboxBaseDomain = rest.join('.');
  const runtimeBaseDomain = deriveRuntimeBaseDomainFromSandboxBaseDomain(sandboxBaseDomain);
  if (!runtimeBaseDomain) {
    return null;
  }
  return {
    kind: 'sandbox',
    region,
    sandbox_base_domain: sandboxBaseDomain,
    runtime_base_domain: runtimeBaseDomain,
  };
}

function parseRuntimeFamily(hostname: string): RemoteSessionFamily | null {
  const labels = splitHostname(hostname);
  if (labels.length < 4) {
    return null;
  }
  const [runtimeID, region, ...rest] = labels;
  if (!runtimeID || !region) {
    return null;
  }
  if (!runtimeID.startsWith('rt-') && !runtimeID.startsWith('app-')) {
    return null;
  }
  const runtimeBaseDomain = rest.join('.');
  const sandboxBaseDomain = deriveSandboxBaseDomainFromRuntimeIsolationBaseDomain(runtimeBaseDomain);
  if (!sandboxBaseDomain) {
    return null;
  }
  return {
    kind: 'runtime',
    region,
    sandbox_base_domain: sandboxBaseDomain,
    runtime_base_domain: runtimeBaseDomain,
  };
}

function parseRemoteSessionFamily(hostname: string): RemoteSessionFamily | null {
  return parseSandboxFamily(hostname) ?? parseRuntimeFamily(hostname);
}

function isSandboxHostInFamily(hostname: string, family: RemoteSessionFamily): boolean {
  const labels = splitHostname(hostname);
  if (labels.length < 4) {
    return false;
  }
  const [sandboxID, region, ...rest] = labels;
  if (!sandboxID || region !== family.region) {
    return false;
  }
  if (!isSupportedSandboxID(sandboxID)) {
    return false;
  }
  return rest.join('.') === family.sandbox_base_domain;
}

function isRuntimeHostInFamily(hostname: string, family: RemoteSessionFamily): boolean {
  const labels = splitHostname(hostname);
  if (labels.length < 4) {
    return false;
  }
  const [runtimeID, region, ...rest] = labels;
  if (!runtimeID || region !== family.region) {
    return false;
  }
  if (!runtimeID.startsWith('rt-') && !runtimeID.startsWith('app-')) {
    return false;
  }
  return rest.join('.') === family.runtime_base_domain;
}

function isAllowedRemoteSessionNavigation(candidate: URL, allowed: URL): boolean {
  const family = parseRemoteSessionFamily(allowed.hostname);
  if (!family) {
    return candidate.hostname === allowed.hostname;
  }
  return isSandboxHostInFamily(candidate.hostname, family) || isRuntimeHostInFamily(candidate.hostname, family);
}

export function isAllowedAppNavigation(input: string, allowedBaseURL: string): boolean {
  try {
    const candidate = new URL(input);
    const allowed = new URL(allowedBaseURL);
    if ((candidate.protocol !== 'http:' && candidate.protocol !== 'https:') || (allowed.protocol !== 'http:' && allowed.protocol !== 'https:')) {
      return false;
    }
    if (normalizeHTTPPort(candidate) !== normalizeHTTPPort(allowed)) {
      return false;
    }
    const remoteFamily = parseRemoteSessionFamily(allowed.hostname);
    if (remoteFamily) {
      return isSandboxHostInFamily(candidate.hostname, remoteFamily) || isRuntimeHostInFamily(candidate.hostname, remoteFamily);
    }
    if (!isSupportedLocalHostname(allowed.hostname) || !isSupportedLocalHostname(candidate.hostname)) {
      return false;
    }
    if (isLoopbackHost(allowed.hostname) || isLoopbackHost(candidate.hostname)) {
      return isLoopbackHost(allowed.hostname) && isLoopbackHost(candidate.hostname);
    }
    if (candidate.hostname === allowed.hostname) {
      return true;
    }
    return isAllowedRemoteSessionNavigation(candidate, allowed);
  } catch {
    return false;
  }
}

function compactCodeSpaceID(value: unknown): string {
  return String(value ?? '').trim();
}

function decodePathSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function isCodespaceURLForCodeSpace(input: string, codeSpaceID: string): boolean {
  const expectedID = compactCodeSpaceID(codeSpaceID);
  if (!expectedID) {
    return false;
  }

  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }

    const labels = splitHostname(url.hostname);
    if (labels[0] === `cs-${expectedID.toLowerCase()}`) {
      return true;
    }

    const pathSegments = url.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean);
    return pathSegments[0] === 'cs' && decodePathSegment(pathSegments[1] ?? '') === expectedID;
  } catch {
    return false;
  }
}

export function isAllowedCodespaceWindowNavigation(input: string, allowedBaseURL: string, codeSpaceID: string): boolean {
  return isAllowedAppNavigation(input, allowedBaseURL) && isCodespaceURLForCodeSpace(input, codeSpaceID);
}

export function isPortForwardURLForForward(input: string, forwardID: string): boolean {
  const expectedID = compactCodeSpaceID(forwardID);
  if (!expectedID) return false;
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const labels = splitHostname(url.hostname);
    if (labels[0] === `pf-${expectedID.toLowerCase()}`) return true;
    const pathSegments = url.pathname.split('/').map((part) => part.trim()).filter(Boolean);
    return pathSegments[0] === 'pf' && decodePathSegment(pathSegments[1] ?? '') === expectedID;
  } catch {
    return false;
  }
}

export function isDesktopPrivateWebServiceURLForForward(input: string, forwardID: string): boolean {
  const expectedID = compactCodeSpaceID(forwardID);
  if (!expectedID) return false;
  try {
    const candidate = new URL(input);
    return candidate.protocol === 'http:'
      && !candidate.username
      && !candidate.password
      && candidate.hostname.toLowerCase() === `pf-${expectedID.toLowerCase()}.localhost`;
  } catch {
    return false;
  }
}

export function desktopLoopbackProtectedRouteURL(
  routeInput: string,
  bridgeBaseInput: string,
  forwardID: string,
): string | null {
  const expectedID = compactCodeSpaceID(forwardID);
  if (!expectedID || !isPortForwardURLForForward(routeInput, expectedID)) return null;
  try {
    const routeURL = new URL(routeInput);
    const bridgeBase = new URL(bridgeBaseInput);
    if (bridgeBase.protocol !== 'http:' || !isWebServiceLoopbackHostname(bridgeBase.hostname)) return null;
    const appPath = webServiceRouteAppPath(routeURL, expectedID);
    if (!appPath) return null;
    const protectedURL = new URL(`/pf/${encodeURIComponent(expectedID)}/`, bridgeBase);
    protectedURL.pathname = `${protectedURL.pathname}${appPath.replace(/^\/+/, '')}`;
    protectedURL.search = routeURL.search;
    protectedURL.hash = routeURL.hash;
    return protectedURL.toString();
  } catch {
    return null;
  }
}

export function isAllowedWebServiceWindowNavigation(input: string, allowedBaseURL: string, forwardID: string): boolean {
  try {
    const candidate = new URL(input);
    const allowed = new URL(allowedBaseURL);
    const localDesktopRoute = isDesktopPrivateWebServiceURLForForward(candidate.toString(), forwardID)
      && allowed.protocol === 'http:'
      && isWebServiceLoopbackHostname(allowed.hostname)
      && normalizeHTTPPort(candidate) === normalizeHTTPPort(allowed);
    if (localDesktopRoute) {
      return true;
    }
  } catch {
    return false;
  }
  return isAllowedAppNavigation(input, allowedBaseURL) && isPortForwardURLForForward(input, forwardID);
}

function webServiceRouteRoot(routeURL: URL, forwardID: string): URL | null {
  const expectedID = compactCodeSpaceID(forwardID);
  if (!expectedID || !isPortForwardURLForForward(routeURL.toString(), expectedID)) return null;
  const labels = splitHostname(routeURL.hostname);
  if (labels[0] === `pf-${expectedID.toLowerCase()}`) return new URL('/', routeURL);
  return new URL(`/pf/${encodeURIComponent(expectedID)}/`, routeURL);
}

function isWebServiceLoopbackHostname(hostname: string): boolean {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/^\[/u, '').replace(/\]$/u, '');
  if (host === 'localhost' || host === '::1') return true;
  const octets = host.split('.');
  return octets.length === 4
    && octets[0] === '127'
    && octets.every((octet) => /^(?:0|[1-9][0-9]{0,2})$/u.test(octet) && Number(octet) <= 255);
}

function protocolFamily(protocol: string): 'http' | 'https' | null {
  switch (protocol) {
    case 'http:':
    case 'ws:':
      return 'http';
    case 'https:':
    case 'wss:':
      return 'https';
    default:
      return null;
  }
}

function exactOrigin(input: URL): string {
  const family = protocolFamily(input.protocol);
  const protocol = family === 'https' ? 'https:' : 'http:';
  return `${protocol}//${input.host}`;
}

export function isDesktopLoopbackWebServiceURL(input: string, loopbackOriginInput: string): boolean {
  try {
    const candidate = new URL(input);
    const loopbackOrigin = new URL(loopbackOriginInput);
    const candidateFamily = protocolFamily(candidate.protocol);
    return Boolean(candidateFamily)
      && loopbackOrigin.protocol === 'http:'
      && loopbackOrigin.hostname === '127.0.0.1'
      && exactOrigin(candidate) === loopbackOrigin.origin;
  } catch {
    return false;
  }
}

export function routeDesktopLoopbackTargetRequest(
  input: string,
  targetInput: string,
  loopbackOriginInput: string,
): string | null {
  try {
    const candidate = new URL(input);
    const target = new URL(targetInput);
    const loopback = new URL(loopbackOriginInput);
    const candidateFamily = protocolFamily(candidate.protocol);
    const targetFamily = protocolFamily(target.protocol);
    if (!candidateFamily || candidateFamily !== targetFamily || targetFamily !== 'http') return null;
    if (
      !isWebServiceLoopbackHostname(candidate.hostname)
      || !isWebServiceLoopbackHostname(target.hostname)
      || normalizeHTTPPort(candidate) !== normalizeHTTPPort(target)
      || loopback.protocol !== 'http:'
      || loopback.hostname !== '127.0.0.1'
    ) return null;
    loopback.protocol = candidate.protocol === 'ws:' ? 'ws:' : 'http:';
    loopback.pathname = candidate.pathname;
    loopback.search = candidate.search;
    loopback.hash = candidate.hash;
    return loopback.toString();
  } catch {
    return null;
  }
}

export function desktopLoopbackBrowserDisplayURL(
  localInput: string,
  targetInput: string,
  loopbackOriginInput: string,
): string | null {
  try {
    const localURL = new URL(localInput);
    const targetURL = new URL(targetInput);
    if (!isDesktopLoopbackWebServiceURL(localURL.toString(), loopbackOriginInput)) return null;
    if (localURL.pathname === '/_redeven_boot/' || localURL.pathname === '/_redeven_boot') {
      targetURL.pathname = '/';
      targetURL.search = '';
      targetURL.hash = '';
      return targetURL.toString();
    }
    targetURL.pathname = localURL.pathname;
    targetURL.search = localURL.search;
    targetURL.hash = localURL.hash;
    return targetURL.toString();
  } catch {
    return null;
  }
}

export function resolveDesktopLoopbackBrowserAddress(
  input: string,
  currentLocalURL: string,
  targetInput: string,
  loopbackOriginInput: string,
): string | null {
  const address = String(input ?? '').trim();
  if (!address) return null;
  try {
    const targetURL = new URL(targetInput);
    const currentDisplay = desktopLoopbackBrowserDisplayURL(currentLocalURL, targetURL.toString(), loopbackOriginInput);
    if (!currentDisplay) return null;
    let displayCandidate: URL;
    const expandedAddress = expandWebServicePortShorthand(address);
    if (/^https?:\/\//iu.test(expandedAddress)) displayCandidate = new URL(expandedAddress);
    else if (looksLikeWebServiceAuthority(expandedAddress)) displayCandidate = new URL(`${targetURL.protocol}//${expandedAddress}`);
    else if (/^[a-z][a-z0-9+.-]*:/iu.test(expandedAddress)) return null;
    else if (expandedAddress.startsWith('?') || expandedAddress.startsWith('#')) displayCandidate = new URL(expandedAddress, currentDisplay);
    else displayCandidate = new URL(expandedAddress.replace(/^\/+/, ''), targetURL.origin + '/');
    if (displayCandidate.origin !== targetURL.origin || displayCandidate.username || displayCandidate.password) return null;
    const loopback = new URL(loopbackOriginInput);
    loopback.pathname = displayCandidate.pathname;
    loopback.search = displayCandidate.search;
    loopback.hash = displayCandidate.hash;
    return loopback.toString();
  } catch {
    return null;
  }
}

export function routeWebServiceTargetRequest(
  input: string,
  routeInput: string,
  targetInput: string,
  forwardID: string,
): string | null {
  try {
    const candidate = new URL(input);
    const routeURL = new URL(routeInput);
    const targetURL = new URL(targetInput);
    const expectedHost = `pf-${compactCodeSpaceID(forwardID).toLowerCase()}.localhost`;
    if (routeURL.protocol !== 'http:' || routeURL.hostname.toLowerCase() !== expectedHost) return null;
    if (candidate.username || candidate.password) return null;
    const candidateFamily = protocolFamily(candidate.protocol);
    const targetFamily = protocolFamily(targetURL.protocol);
    if (!candidateFamily || candidateFamily !== targetFamily) return null;
    if (!isWebServiceLoopbackHostname(candidate.hostname) || !isWebServiceLoopbackHostname(targetURL.hostname)) return null;
    if (normalizeHTTPPort(candidate) !== normalizeHTTPPort(targetURL)) return null;

    const routed = new URL(routeURL.origin);
    routed.protocol = candidate.protocol === 'ws:' || candidate.protocol === 'wss:' ? 'ws:' : 'http:';
    routed.pathname = candidate.pathname;
    routed.search = candidate.search;
    routed.hash = candidate.hash;
    return routed.toString();
  } catch {
    return null;
  }
}

function webServiceRouteAppPath(routeURL: URL, forwardID: string): string | null {
  const routeRoot = webServiceRouteRoot(routeURL, forwardID);
  if (!routeRoot) return null;
  if (routeRoot.pathname === '/') {
    if (routeURL.pathname === '/_redeven_boot/' || routeURL.pathname === '/_redeven_boot') return '/';
    return routeURL.pathname || '/';
  }
  const rootWithoutTrailingSlash = routeRoot.pathname.replace(/\/$/u, '');
  if (routeURL.pathname === rootWithoutTrailingSlash) return '/';
  if (!routeURL.pathname.startsWith(routeRoot.pathname)) return null;
  return `/${routeURL.pathname.slice(routeRoot.pathname.length)}`;
}

export function webServiceBrowserDisplayURL(
  routeInput: string,
  targetInput: string,
  forwardID: string,
): string | null {
  try {
    const routeURL = new URL(routeInput);
    const targetURL = new URL(targetInput);
    const appPath = webServiceRouteAppPath(routeURL, forwardID);
    if (!appPath) return null;
    const displayURL = new URL(appPath, targetURL.origin);
    const isRemoteBoot = appPath === '/'
      && (routeURL.pathname === '/_redeven_boot/' || routeURL.pathname === '/_redeven_boot');
    if (!isRemoteBoot) {
      displayURL.search = routeURL.search;
      displayURL.hash = routeURL.hash;
    }
    return displayURL.toString();
  } catch {
    return null;
  }
}

export function webServiceBrowserPrivateAppLocation(
  routeInput: string,
  bridgeBaseInput: string,
  forwardID: string,
): string | null {
  try {
    const routeURL = new URL(routeInput);
    const bridgeBase = new URL(bridgeBaseInput);
    if (
      !isDesktopPrivateWebServiceURLForForward(routeURL.toString(), forwardID)
      || bridgeBase.protocol !== 'http:'
      || !isWebServiceLoopbackHostname(bridgeBase.hostname)
      || normalizeHTTPPort(routeURL) !== normalizeHTTPPort(bridgeBase)
    ) return null;
    const appPath = webServiceRouteAppPath(routeURL, forwardID);
    if (!appPath) return null;
    if (appPath === '/' && (routeURL.pathname === '/_redeven_boot/' || routeURL.pathname === '/_redeven_boot')) {
      return '/';
    }
    return `${appPath}${routeURL.search}${routeURL.hash}`;
  } catch {
    return null;
  }
}

function looksLikeWebServiceAuthority(address: string): boolean {
  const authority = address.split(/[/?#]/u, 1)[0]?.trim() ?? '';
  if (!authority) return false;
  const hostname = authority.startsWith('[')
    ? authority.slice(0, authority.indexOf(']') + 1)
    : authority.replace(/:\d+$/u, '');
  return hostname.toLowerCase() === 'localhost'
    || hostname.startsWith('[')
    || /^\d{1,3}(?:\.\d{1,3}){3}$/u.test(hostname)
    || hostname.includes('.');
}

function expandWebServicePortShorthand(address: string): string {
  const portMatch = address.match(/^(\d{1,5})([/?#].*)?$/u);
  if (portMatch) return `localhost:${portMatch[1]}${portMatch[2] ?? ''}`;
  return address.startsWith(':') ? `localhost${address}` : address;
}

export function resolveWebServiceBrowserAddress(
  input: string,
  currentRouteURL: string,
  targetInput: string,
  allowedBaseURL: string,
  forwardID: string,
): string | null {
  const address = String(input ?? '').trim();
  if (!address) return null;

  try {
    const currentRoute = new URL(currentRouteURL);
    const targetURL = new URL(targetInput);
    const routeRoot = webServiceRouteRoot(currentRoute, forwardID);
    const currentDisplay = webServiceBrowserDisplayURL(currentRoute.toString(), targetURL.toString(), forwardID);
    if (!routeRoot || !currentDisplay) return null;

    let displayCandidate: URL;
    const expandedAddress = expandWebServicePortShorthand(address);
    if (/^https?:\/\//iu.test(expandedAddress)) {
      displayCandidate = new URL(expandedAddress);
    } else if (looksLikeWebServiceAuthority(expandedAddress)) {
      displayCandidate = new URL(`${targetURL.protocol}//${expandedAddress}`);
    } else if (/^[a-z][a-z0-9+.-]*:/iu.test(expandedAddress)) {
      return null;
    } else if (expandedAddress.startsWith('?') || expandedAddress.startsWith('#')) {
      displayCandidate = new URL(expandedAddress, currentDisplay);
    } else {
      displayCandidate = new URL(expandedAddress.replace(/^\/+/, ''), targetURL.origin + '/');
    }
    if (displayCandidate.origin !== targetURL.origin || displayCandidate.username || displayCandidate.password) {
      return null;
    }

    const routeCandidate = new URL(routeRoot);
    routeCandidate.pathname += displayCandidate.pathname.replace(/^\/+/, '');
    routeCandidate.search = displayCandidate.search;
    routeCandidate.hash = displayCandidate.hash;
    return isAllowedWebServiceWindowNavigation(routeCandidate.toString(), allowedBaseURL, forwardID)
      ? routeCandidate.toString()
      : null;
  } catch {
    return null;
  }
}
